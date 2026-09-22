/**
 * =============================================================================
 * packages/agent-core/src/loop.ts — the agent runtime heart
 * =============================================================================
 *
 * WHAT THIS FILE IS
 * -----------------
 * This is the Think → Act → Observe loop. Everything else in the monorepo
 * plugs into this function:
 *
 *   CLI / future API
 *        ↓
 *   runAgentLoop(run, { llm, tools, policy, onStep }, options)
 *        ↓
 *   updated AgentRun (status, steps, finalAnswer)
 *
 * It does NOT know about calculators, weather APIs, OpenAI, or Ollama.
 * Those arrive through dependencies (deps). That separation is intentional:
 * add a new tool without rewriting the loop.
 *
 * THE LOOP IN ONE PICTURE
 * -----------------------
 *   messages = [system, user(goal)]
 *
 *   repeat up to maxSteps:
 *     THINK   → llm.complete(messages, tools)
 *               ├─ no toolCalls?  → finalAnswer, status=succeeded, STOP
 *               └─ toolCalls?     → continue
 *     ACT     → for each tool call:
 *               policy.evaluate → allow | deny | ask
 *               allow  → tool.execute(...)
 *               deny   → record error observation (do not execute)
 *               ask    → status=awaiting_approval, STOP (checkpoint; resume with approval)
 *     OBSERVE → append role:"tool" messages with JSON results
 *               record AgentStep, call onStep callback
 *
 *   if we exit the for-loop without succeeding → failed (maxSteps)
 *
 * SHORT-TERM MEMORY
 * -----------------
 * The `messages` array is the conversation scratchpad for THIS run only.
 * Long-term prefs/tasks come from `options.extraSystem` (Phase 4 memory file).
 */

import type {
  AgentMessage,
  AgentRun,
  AgentStep,
  LlmClient,
  Observation,
  ToolCallRequest,
  ToolSpec,
} from "./types.js";
import { createToolCallId, nowIso } from "./types.js";
import type { PolicyEngine } from "./policy-port.js";

/**
 * Optional knobs for one loop execution.
 *
 * maxSteps      — safety cap so a confused model cannot tool-call forever (default 8)
 * workspaceRoot — project root passed into tools/policy (path jail in later phases)
 * signal        — AbortSignal so callers can cancel mid-run (Ctrl+C / HTTP cancel)
 */
export interface AgentLoopOptions {
  maxSteps?: number;
  workspaceRoot?: string;
  signal?: AbortSignal;
  /** Long-term memory / session facts appended to the system prompt */
  extraSystem?: string;
  /** Resume conversation (HITL / crash-resume). */
  messages?: AgentMessage[];
  /** Resolve a paused `ask` verdict, then continue Think→Act→Observe. */
  approval?: "approve" | "deny";
}

/**
 * Required collaborators injected by the composition root (e.g. apps/cli).
 *
 * llm     — "brain" that returns text and/or tool_calls (heuristic or real model)
 * tools   — capabilities the brain may request by name
 * policy  — guardrail consulted BEFORE every execute
 * onStep  — optional hook after each completed step (logging, UI streaming, metrics)
 */
export interface AgentLoopDeps {
  llm: LlmClient;
  tools: ToolSpec[];
  policy: PolicyEngine;
  onStep?: (step: AgentStep, run: AgentRun) => void;
  onCheckpoint?: (payload: { run: AgentRun; messages: AgentMessage[] }) => void;
}

/**
 * Fixed system instructions for the model.
 * This is prompt engineering: it biases the LLM toward tools for facts/math
 * and toward honesty about tool results (never invent observations).
 */
const SYSTEM_PROMPT = `You are a careful tool-using assistant.
- Prefer tools over guessing for math and external facts.
- Call at most the tools you need.
- After observations, give a concise final answer.
- Never invent tool results.
- Use remember/recall for long-term preferences and previous tasks. Never store secrets.`;

/**
 * Run one AgentRun to completion (or until approval / cancel / failure).
 *
 * @param run     - Mutable run record created by createAgentRun(goal). We update
 *                  status, steps, finalAnswer, error, updatedAt in place and also
 *                  return the same object for convenience.
 * @param deps    - llm + tools + policy (+ optional onStep)
 * @param options - maxSteps, workspaceRoot, abort signal
 * @returns       - The same AgentRun, now filled with the outcome
 */
export async function runAgentLoop(
  run: AgentRun,
  deps: AgentLoopDeps,
  options: AgentLoopOptions = {},
): Promise<AgentRun> {
  // ---- Setup ----------------------------------------------------------------

  /** Hard stop against infinite tool loops (model bugs, ambiguous goals, etc.). */
  const maxSteps = options.maxSteps ?? 8;

  /** Filesystem root tools should stay inside; defaults to process CWD. */
  const workspaceRoot = options.workspaceRoot ?? process.cwd();

  /**
   * Fast name → ToolSpec lookup.
   * The LLM only returns a string name; we resolve it to the real execute().
   */
  const toolMap = new Map(deps.tools.map((t) => [t.name, t]));

  // Mark the run as actively processing (was "pending" from createAgentRun).
  run.status = "running";
  run.updatedAt = nowIso();

  /**
   * Conversation buffer sent to the LLM every THINK.
   * Starts with system rules + the user's goal; grows with assistant/tool turns.
   */
  const system = options.extraSystem
    ? `${SYSTEM_PROMPT}\n\n${options.extraSystem}`
    : SYSTEM_PROMPT;
  const messages: AgentMessage[] = options.messages?.length
    ? options.messages
    : [
        { role: "system", content: system },
        { role: "user", content: run.goal },
      ];

  const persist = (): void => {
    run.updatedAt = nowIso();
    deps.onCheckpoint?.({ run, messages });
  };

  const actCtx: ActContext = {
    run,
    deps,
    options,
    workspaceRoot,
    toolMap,
    messages,
  };

  try {
    if (options.approval) {
      const pausedAgain = await resolveHitl(actCtx, options.approval);
      persist();
      if (pausedAgain) return run;
    }

    // ---- Main loop: each iteration is one Think → Act → Observe cycle --------
    for (let i = run.steps.length; i < maxSteps; i++) {
      // Cooperative cancellation (e.g. user hit Ctrl+C if wired to AbortController).
      if (options.signal?.aborted) {
        run.status = "cancelled";
        run.error = "Aborted";
        persist();
        return run;
      }

      const startedAt = nowIso();

      // ============================ THINK =====================================
      // Ask the brain what to do next, given the full message history + tool list.
      const llmResponse = await deps.llm.complete({
        messages,
        tools: deps.tools,
        signal: options.signal,
      });

      /**
       * Normalize provider tool calls into our ToolCallRequest shape.
       * Guarantee an id even if the model omitted one (needed to link observations).
       */
      const toolCalls: ToolCallRequest[] = (llmResponse.toolCalls ?? []).map((tc) => ({
        id: tc.id || createToolCallId(),
        name: tc.name,
        arguments: tc.arguments ?? {},
      }));

      /**
       * NO TOOL CALLS → the model is done.
       * Treat content as the final user-facing answer and end successfully.
       * (This is the usual Step 1 after calculator/weather already ran.)
       */
      if (!toolCalls.length) {
        run.finalAnswer = llmResponse.content?.trim() || "No response.";
        run.status = "succeeded";
        run.updatedAt = nowIso();
        const step: AgentStep = {
          index: i,
          thought: llmResponse.content,
          toolCalls: [],
          observations: [],
          startedAt,
          finishedAt: nowIso(),
        };
        run.steps.push(step);
        deps.onStep?.(step, run); // notify logger/UI
        persist();
        return run;
      }

      /**
       * The assistant requested tools. Record that assistant turn in messages
       * (including toolCalls) so OpenAI-compatible providers accept the next
       * request that includes matching role:"tool" results.
       */
      messages.push({
        role: "assistant",
        content: llmResponse.content ?? "",
        toolCalls,
      });

      // ============================ ACT (+ OBSERVE per tool) ==================
      const observations: Observation[] = [];

      for (const call of toolCalls) {
        const tool = toolMap.get(call.name);

        /**
         * POLICY CHECK (always, before execute).
         * Unknown tools are treated as "destructive" for sideEffect so a missing
         * ToolSpec cannot slip through as a harmless read.
         */
        const decision = deps.policy.evaluateToolCall({
          toolName: call.name,
          sideEffect: tool?.sideEffect ?? "destructive",
          args: call.arguments,
          workspaceRoot,
        });

        // ---- Unknown tool name (model hallucinated a tool) -------------------
        if (!tool) {
          const obs: Observation = {
            toolCallId: call.id,
            toolName: call.name,
            ok: false,
            summary: `Unknown tool: ${call.name}`,
            error: `Unknown tool: ${call.name}`,
            durationMs: 0,
            // Force a deny on the observation even if policy said allow —
            // there is nothing safe to execute.
            policy:
              decision.verdict === "allow"
                ? { verdict: "deny", reason: "Unknown tool", ruleId: "unknown_tool" }
                : decision,
          };
          observations.push(obs);
          // Feed the failure back so the next THINK can recover / apologize.
          messages.push({
            role: "tool",
            content: JSON.stringify({ ok: false, error: obs.error }),
            toolCallId: call.id,
            name: call.name,
          });
          continue;
        }

        // ---- Explicit deny ---------------------------------------------------
        if (decision.verdict === "deny") {
          const obs: Observation = {
            toolCallId: call.id,
            toolName: call.name,
            ok: false,
            summary: `Policy denied: ${decision.reason}`,
            error: decision.reason,
            durationMs: 0,
            policy: decision,
          };
          observations.push(obs);
          messages.push({
            role: "tool",
            content: JSON.stringify({
              ok: false,
              error: decision.reason,
              policy: decision,
            }),
            toolCallId: call.id,
            name: call.name,
          });
          continue; // do not call tool.execute
        }

        // ---- Human approval required — pause, checkpoint, do not execute ----
        if (decision.verdict === "ask") {
          run.status = "awaiting_approval";
          run.metadata = { ...run.metadata, pausedCallIndex: toolCalls.indexOf(call) };
          const obs: Observation = {
            toolCallId: call.id,
            toolName: call.name,
            ok: false,
            summary: `Awaiting approval: ${decision.reason}`,
            error: "awaiting_approval",
            durationMs: 0,
            policy: decision,
          };
          observations.push(obs);
          const step: AgentStep = {
            index: i,
            thought: llmResponse.content,
            toolCalls,
            observations,
            startedAt,
            finishedAt: nowIso(),
          };
          run.steps.push(step);
          deps.onStep?.(step, run);
          persist();
          return run;
        }

        // ---- allow → execute the tool ----------------------------------------
        const t0 = Date.now();
        try {
          const result = await tool.execute(call.arguments, {
            runId: run.id,
            workspaceRoot,
            signal: options.signal,
          });

          /** Successful or soft-failed tool result (execute returned normally). */
          const obs: Observation = {
            toolCallId: call.id,
            toolName: call.name,
            ok: result.ok,
            summary: result.summary,
            data: result.data,
            error: result.error,
            durationMs: Date.now() - t0,
            policy: decision,
          };
          observations.push(obs);

          /**
           * OBSERVE: append a tool message the LLM will read on the next THINK.
           * Keep payload structured (ok/summary/data/error) so models and the
           * heuristic formatter can both consume it.
           */
          messages.push({
            role: "tool",
            content: JSON.stringify({
              ok: result.ok,
              summary: result.summary,
              data: result.data,
              error: result.error,
            }),
            toolCallId: call.id,
            name: call.name,
          });
        } catch (err) {
          /**
           * Hard failure: execute threw (bug, network crash, unexpected exception).
           * Convert to an observation instead of crashing the whole process so
           * the model can still produce a useful final answer.
           */
          const message = err instanceof Error ? err.message : String(err);
          const obs: Observation = {
            toolCallId: call.id,
            toolName: call.name,
            ok: false,
            summary: `Tool threw: ${message}`,
            error: message,
            durationMs: Date.now() - t0,
            policy: decision,
          };
          observations.push(obs);
          messages.push({
            role: "tool",
            content: JSON.stringify({ ok: false, error: message }),
            toolCallId: call.id,
            name: call.name,
          });
        }
      }

      // ---- End of step: persist audit trail + notify listeners --------------
      const step: AgentStep = {
        index: i,
        thought: llmResponse.content,
        toolCalls,
        observations,
        startedAt,
        finishedAt: nowIso(),
      };
      run.steps.push(step);
      deps.onStep?.(step, run);
      persist();

      // Loop continues → next THINK will see the new tool messages.
    }

    // ============================ maxSteps exhausted =========================
    // Model kept requesting tools (or never produced a final text answer).
    run.status = "failed";
    run.error = `Exceeded maxSteps=${maxSteps}`;
    persist();
    return run;
  } catch (err) {
    /**
     * Unexpected failure outside the per-tool try/catch
     * (e.g. llm.complete threw because the API was down).
     */
    run.status = "failed";
    run.error = err instanceof Error ? err.message : String(err);
    persist();
    return run;
  }
}

interface ActContext {
  run: AgentRun;
  deps: AgentLoopDeps;
  options: AgentLoopOptions;
  workspaceRoot: string;
  toolMap: Map<string, ToolSpec>;
  messages: AgentMessage[];
}

async function resolveHitl(ctx: ActContext, approval: "approve" | "deny"): Promise<boolean> {
  const { run, messages } = ctx;
  const step = run.steps[run.steps.length - 1];
  const callIndex = Number(run.metadata?.pausedCallIndex ?? -1);
  const call = step?.toolCalls[callIndex];
  if (!step || !call) {
    run.status = "failed";
    run.error = "No paused tool call to approve";
    return false;
  }

  const pending = step.observations.find((o) => o.toolCallId === call.id);
  if (approval === "deny") {
    const obs: Observation = {
      toolCallId: call.id,
      toolName: call.name,
      ok: false,
      summary: "User denied this action",
      error: "denied",
      durationMs: 0,
      policy: pending?.policy ?? { verdict: "ask", reason: "denied" },
    };
    replaceObs(step, obs);
    messages.push({
      role: "tool",
      content: JSON.stringify({ ok: false, error: "User denied this action" }),
      toolCallId: call.id,
      name: call.name,
    });
  } else {
    const executed = await executeAllowed(ctx, call, pending);
    replaceObs(step, executed);
    messages.push({
      role: "tool",
      content: JSON.stringify({
        ok: executed.ok,
        summary: executed.summary,
        data: executed.data,
        error: executed.error,
      }),
      toolCallId: call.id,
      name: call.name,
    });
  }

  for (let j = callIndex + 1; j < step.toolCalls.length; j++) {
    const next = step.toolCalls[j];
    if (!next) continue;
    const outcome = await processRemainingCall(ctx, next, j);
    if (outcome === "pause") return true;
  }

  if (run.metadata && "pausedCallIndex" in run.metadata) {
    delete run.metadata.pausedCallIndex;
  }
  run.status = "running";
  run.error = undefined;
  return false;
}

function replaceObs(step: AgentStep, obs: Observation): void {
  const idx = step.observations.findIndex((o) => o.toolCallId === obs.toolCallId);
  if (idx >= 0) step.observations[idx] = obs;
  else step.observations.push(obs);
}

async function processRemainingCall(
  ctx: ActContext,
  call: ToolCallRequest,
  callIndex: number,
): Promise<"pause" | "ok"> {
  const tool = ctx.toolMap.get(call.name);
  const decision = ctx.deps.policy.evaluateToolCall({
    toolName: call.name,
    sideEffect: tool?.sideEffect ?? "destructive",
    args: call.arguments,
    workspaceRoot: ctx.workspaceRoot,
  });

  if (decision.verdict === "ask") {
    ctx.run.status = "awaiting_approval";
    ctx.run.metadata = { ...ctx.run.metadata, pausedCallIndex: callIndex };
    const obs: Observation = {
      toolCallId: call.id,
      toolName: call.name,
      ok: false,
      summary: `Awaiting approval: ${decision.reason}`,
      error: "awaiting_approval",
      durationMs: 0,
      policy: decision,
    };
    const step = ctx.run.steps[ctx.run.steps.length - 1];
    if (step) step.observations.push(obs);
    return "pause";
  }

  if (!tool || decision.verdict === "deny") {
    const obs: Observation = {
      toolCallId: call.id,
      toolName: call.name,
      ok: false,
      summary: !tool ? `Unknown tool: ${call.name}` : `Policy denied: ${decision.reason}`,
      error: !tool ? `Unknown tool: ${call.name}` : decision.reason,
      durationMs: 0,
      policy: decision,
    };
    ctx.run.steps[ctx.run.steps.length - 1]?.observations.push(obs);
    ctx.messages.push({
      role: "tool",
      content: JSON.stringify({ ok: false, error: obs.error }),
      toolCallId: call.id,
      name: call.name,
    });
    return "ok";
  }

  const obs = await executeAllowed(ctx, call, { policy: decision } as Observation);
  ctx.run.steps[ctx.run.steps.length - 1]?.observations.push(obs);
  ctx.messages.push({
    role: "tool",
    content: JSON.stringify({
      ok: obs.ok,
      summary: obs.summary,
      data: obs.data,
      error: obs.error,
    }),
    toolCallId: call.id,
    name: call.name,
  });
  return "ok";
}

async function executeAllowed(
  ctx: ActContext,
  call: ToolCallRequest,
  pending: Observation | undefined,
): Promise<Observation> {
  const tool = ctx.toolMap.get(call.name);
  const policy = pending?.policy ?? {
    verdict: "allow" as const,
    reason: "HITL approved",
    ruleId: "hitl_approve",
  };
  if (!tool) {
    return {
      toolCallId: call.id,
      toolName: call.name,
      ok: false,
      summary: `Unknown tool: ${call.name}`,
      error: `Unknown tool: ${call.name}`,
      durationMs: 0,
      policy,
    };
  }
  const t0 = Date.now();
  try {
    const result = await tool.execute(call.arguments, {
      runId: ctx.run.id,
      workspaceRoot: ctx.workspaceRoot,
      signal: ctx.options.signal,
    });
    return {
      toolCallId: call.id,
      toolName: call.name,
      ok: result.ok,
      summary: result.summary,
      data: result.data,
      error: result.error,
      durationMs: Date.now() - t0,
      policy: { ...policy, verdict: "allow", reason: "HITL approved", ruleId: "hitl_approve" },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      toolCallId: call.id,
      toolName: call.name,
      ok: false,
      summary: `Tool threw: ${message}`,
      error: message,
      durationMs: Date.now() - t0,
      policy,
    };
  }
}
