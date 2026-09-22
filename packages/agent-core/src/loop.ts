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
 *               ask    → status=awaiting_approval, STOP (HITL stub)
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
  const messages: AgentMessage[] = [
    { role: "system", content: system },
    { role: "user", content: run.goal },
  ];

  try {
    // ---- Main loop: each iteration is one Think → Act → Observe cycle --------
    for (let i = 0; i < maxSteps; i++) {
      // Cooperative cancellation (e.g. user hit Ctrl+C if wired to AbortController).
      if (options.signal?.aborted) {
        run.status = "cancelled";
        run.error = "Aborted";
        run.updatedAt = nowIso();
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

        // ---- Human approval required (HITL stub) -----------------------------
        // Used for sideEffect "destructive" today. We stop the whole run so a
        // future UI can ask the user; we do not silently continue.
        if (decision.verdict === "ask") {
          run.status = "awaiting_approval";
          run.updatedAt = nowIso();
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
          return run; // paused — caller decides next action later
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
      run.updatedAt = nowIso();

      // Loop continues → next THINK will see the new tool messages.
    }

    // ============================ maxSteps exhausted =========================
    // Model kept requesting tools (or never produced a final text answer).
    run.status = "failed";
    run.error = `Exceeded maxSteps=${maxSteps}`;
    run.updatedAt = nowIso();
    return run;
  } catch (err) {
    /**
     * Unexpected failure outside the per-tool try/catch
     * (e.g. llm.complete threw because the API was down).
     */
    run.status = "failed";
    run.error = err instanceof Error ? err.message : String(err);
    run.updatedAt = nowIso();
    return run;
  }
}
