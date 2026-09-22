#!/usr/bin/env node
/**
 * =============================================================================
 * apps/cli/src/main.ts — Composition root (the "wiring" file)
 * =============================================================================
 *
 * WHAT IS THIS FILE?
 * ------------------
 * This is the entrypoint you run with:
 *   pnpm agent -- "What is (12 + 8) * 3?"
 *
 * It does NOT implement calculator/weather logic itself.
 * It does NOT implement the Think→Act→Observe loop itself.
 *
 * Instead it ASSEMBLES the pieces:
 *   1. Read config / user goal
 *   2. Create an AgentRun (one attempt at the goal)
 *   3. Plug in: LLM + tools + policy + logging
 *   4. Call runAgentLoop(...)
 *   5. Print the final answer
 *
 * In architecture terms this is a "composition root": the place where
 * dependencies are created and connected. Keeping this thin makes the
 * agent runtime (@lca/agent-core) reusable from a web API later.
 *
 * MENTAL MODEL OF ONE REQUEST
 * ---------------------------
 *   User types a goal
 *        ↓
 *   createAgentRun(goal)          → empty run record (id, status, steps[])
 *        ↓
 *   runAgentLoop(run, deps)       → Think → Act → Observe (may repeat)
 *        ↓
 *   result.finalAnswer            → printed to the terminal
 *
 * RELATED DOCS
 * ------------
 *   docs/PHASE_0_1_CORE_CONCEPTS.md  — concepts behind this wiring
 *   packages/agent-core/src/loop.ts  — the actual agent loop
 */

// ---------------------------------------------------------------------------
// Imports — each package is one concern in the platform
// ---------------------------------------------------------------------------

/**
 * createAgentRun:
 *   Factory that builds an AgentRun object:
 *   { id, goal, status: "pending", steps: [], createdAt, ... }
 *
 * runAgentLoop:
 *   The core agent runtime. Given a run + (llm, tools, policy), it:
 *     Think  → ask the LLM what to do (maybe request tool calls)
 *     Act    → check policy, then execute tools
 *     Observe→ feed tool results back into the conversation
 *   until the LLM returns a plain-text final answer (or fails / needs approval).
 */
import { createAgentRun, runAgentLoop } from "@lca/agent-core";

/**
 * createLlmFromEnv:
 *   Picks which "brain" to use based on LCA_PROVIDER in .env:
 *     - "heuristic" (default): rule-based router, no API key, great for learning/CI
 *     - "ollama": local model via OpenAI-compatible HTTP API
 *     - "openai": hosted OpenAI (or compatible) API
 *
 *   All of them implement the same LlmClient interface, so the loop
 *   does not care which one you chose.
 */
import { createLlmFromEnv } from "@lca/llm";

/**
 * createLogger:
 *   Structured JSON logger. Each line is a machine-readable event, e.g.:
 *   {"level":"info","message":"agent_step","fields":{...}}
 *
 *   Why not just console.log strings?
 *   Later you will grep/filter logs by runId, ship them to a dashboard,
 *   and redact secrets — structured logs make that possible.
 */
import { createLogger } from "@lca/logger";

/**
 * createDefaultPolicy:
 *   Safety gate that runs BEFORE every tool execution.
 *   Returns one of:
 *     - allow  → run the tool
 *     - deny   → block and tell the agent why
 *     - ask    → pause the run (human-in-the-loop stub for later UI)
 *
 *   Phase 1 tools (calculator, weather) are low-risk and usually "allow".
 *   Destructive actions (future: delete files, force-push, prod deploy) → "ask".
 */
import { createDefaultPolicy } from "@lca/policy";

/**
 * createDefaultTools:
 *   Phase 1: calculator, get_weather
 *   Phase 2: read_file, list_dir, search_files, run_shell (jailed / allowlisted)
 *   Phase 3: index_codebase, search_codebase
 *   Phase 4: remember, recall (plus extraSystem from .lca/memory.json)
 *
 *   Each tool is a ToolSpec: { name, description, sideEffect, inputSchema, execute }.
 *   The LLM sees name/description/schema; your runtime calls execute().
 */
import { createDefaultTools } from "@lca/tools";
import { formatMemoryPrompt, loadMemory } from "@lca/memory";

/**
 * loadEnvFile:
 *   Tiny helper that reads a root `.env` file into process.env
 *   WITHOUT overriding variables already set in your shell.
 *   (So `LCA_PROVIDER=ollama pnpm agent ...` still wins over .env.)
 */
import { loadEnvFile, resolveWorkspaceRoot } from "./env.js";

// ---------------------------------------------------------------------------
// main() — one user goal → one agent run → printed answer
// ---------------------------------------------------------------------------

async function main() {
  // Load KEY=value pairs from .env into process.env (if the file exists).
  // Examples: LCA_PROVIDER, OLLAMA_MODEL, OPENAI_API_KEY, WEATHER_LAT, ...
  loadEnvFile();
  const workspaceRoot = resolveWorkspaceRoot();

  /**
   * process.argv is Node's list of CLI arguments.
   * Example for:  pnpm agent -- "What is 2+2?"
   *
   *   argv[0] = path to node
   *   argv[1] = path to this script (main.ts)
   *   argv[2..] = everything after that, often including a literal "--"
   *               that package managers use to separate flags from your text
   *
   * We:
   *   1. drop argv[0] and argv[1] via .slice(2)
   *   2. remove any standalone "--" tokens
   *   3. join the rest into one goal string
   */
  const goal = process.argv
    .slice(2)
    .filter((a) => a !== "--")
    .join(" ")
    .trim();

  // No goal → show usage and exit with a non-zero code (signals failure to shells/CI).
  if (!goal) {
    console.error('Usage: pnpm agent -- "What is (12 + 8) * 3?"');
    process.exit(1);
  }

  /**
   * Base logger tagged with app: "cli".
   * Every log line from this process can be filtered by that field later.
   */
  const logger = createLogger({ fields: { app: "cli" } });

  /**
   * Create the run record UP FRONT (before the loop).
   *
   * Why metadata.provider?
   *   So when you inspect logs or save run history later, you know whether
   *   this answer came from the heuristic router or a real model.
   *
   * `?? "heuristic"` means: if LCA_PROVIDER is missing/undefined, use heuristic.
   */
  const run = createAgentRun(goal, {
    provider: process.env.LCA_PROVIDER ?? "heuristic",
  });

  /**
   * Child logger that ALWAYS includes this run's id.
   * That lets you correlate every step/finish event for one request:
   *   grep run_abc123 logs.jsonl
   */
  const log = logger.child({ runId: run.id });

  // First breadcrumb: we accepted a goal and are about to start the loop.
  log.info("agent_run_started", { goal, workspaceRoot });

  /**
   * ============================================================
   * THE IMPORTANT CALL — hand control to the agent runtime
   * ============================================================
   *
   * Arguments:
   *   1) run
   *        Mutable AgentRun object. The loop updates status, steps, finalAnswer.
   *
   *   2) deps (dependency bag)
   *        llm     — how to "think" (produce text and/or tool_calls)
   *        tools   — what the agent is allowed to request
   *        policy  — gate before each tool execute
   *        onStep  — optional callback after each Think→Act→Observe cycle
   *                  (we use it only for logging; a UI could stream steps live)
   *
   *   3) options
   *        workspaceRoot — filesystem root tools should treat as the project.
   *        (Phase 1 barely uses this; Phase 2 file/shell tools will.)
   *
   * Return value:
   *   The same run object, now filled in (status, steps, finalAnswer, error...).
   *
   * NOTE: `await` pauses here until the whole multi-step loop finishes.
   */
  const result = await runAgentLoop(
    run,
    {
      // Brain: heuristic rules OR Ollama/OpenAI, chosen from env.
      llm: createLlmFromEnv(),

      // Hands: Phase 1 tools the model can call by name.
      tools: createDefaultTools(),

      // Guardrails: allow / deny / ask before any tool runs.
      policy: createDefaultPolicy(),

      /**
       * onStep fires once per loop iteration.
       * A "step" usually looks like:
       *   - toolCalls: [{ name: "calculator", arguments: { expression: "2+2" } }]
       *   - observations: [{ ok: true, summary: "2+2 = 4", policy: "allow", ... }]
       *
       * Or, on the last step:
       *   - toolCalls: []
       *   - thought / final text answer from the LLM
       *
       * We log a compact summary (not the full raw payloads) to keep terminals readable.
       */
      onStep: (step) => {
        log.info("agent_step", {
          index: step.index,
          // Which tools were requested in this step (may be empty on the final answer step).
          tools: step.toolCalls.map((t) => t.name),
          // What each tool returned + whether policy allowed it.
          observations: step.observations.map((o) => ({
            tool: o.toolName,
            ok: o.ok,
            summary: o.summary,
            policy: o.policy.verdict, // "allow" | "deny" | "ask"
          })),
        });
      },
    },
    {
      workspaceRoot,
      extraSystem: formatMemoryPrompt(loadMemory(workspaceRoot)),
    },
  );

  // Closing breadcrumb: outcome of the whole run (success, failure, approval needed, ...).
  log.info("agent_run_finished", {
    status: result.status, // e.g. "succeeded" | "failed" | "awaiting_approval"
    steps: result.steps.length,
    finalAnswer: result.finalAnswer,
    error: result.error,
  });

  // Human-friendly output (logs above are for machines; this is for you).
  if (result.finalAnswer) {
    console.log("\nAnswer:", result.finalAnswer);
  }

  /**
   * Treat anything other than "succeeded" as a process failure.
   * Examples:
   *   - failed            → loop error / max steps
   *   - awaiting_approval → policy said "ask" (HITL not implemented in CLI yet)
   *   - cancelled         → abort signal
   */
  if (result.status !== "succeeded") {
    console.error(
      `\nRun status: ${result.status}${result.error ? ` — ${result.error}` : ""}`,
    );
    process.exit(1);
  }
}

/**
 * Kick off main().
 *
 * `.catch(...)` handles unexpected thrown errors (bugs, network crashes the
 * heuristic path shouldn't hit, etc.) so the process still exits with code 1
 * instead of hanging or printing an unhandled-rejection warning.
 */
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
