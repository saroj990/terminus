/**
 * Phase 5 graph: plan → execute → retry, wrapping runAgentLoop (not a second runtime).
 */

import { runAgentLoop, type AgentLoopDeps, type AgentLoopOptions } from "./loop.js";
import {
  saveCheckpoint,
  type GraphState,
  type RunCheckpoint,
} from "./checkpoint.js";
import type { AgentMessage, AgentRun } from "./types.js";
import { nowIso } from "./types.js";

export function planGoal(goal: string): string[] {
  const cleaned = goal.replace(/^[Pp]lan\s+(and\s+)?then\s+/i, "").trim();
  const parts = cleaned
    .split(/\s+then\s+/i)
    .map((s) => s.replace(/[.]+$/g, "").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [goal.trim()];
}

export function formatPlanPrompt(plan: string[]): string {
  if (!plan.length) return "";
  const lines = plan.map((step, i) => `${i + 1}. ${step}`);
  return `Planned steps:\n${lines.join("\n")}\nFollow this plan. If a tool fails, retry once.`;
}

export interface OrchestratorOptions extends AgentLoopOptions {
  maxRetries?: number;
  checkpoint?: RunCheckpoint;
  approval?: "approve" | "deny";
}

export async function runOrchestrated(
  run: AgentRun,
  deps: AgentLoopDeps,
  options: OrchestratorOptions = {},
): Promise<AgentRun> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const maxRetries = options.maxRetries ?? 1;
  const plan = options.checkpoint?.graph.plan ?? planGoal(run.goal);
  run.metadata = { ...run.metadata, plan };

  const extraSystem = [options.extraSystem, formatPlanPrompt(plan)].filter(Boolean).join("\n\n");
  let attempt = options.checkpoint?.graph.attempt ?? 0;
  let messages = options.checkpoint?.messages;
  let approval = options.approval;

  const persist = (node: GraphState["node"], msgs: AgentMessage[]) => {
    const graph: GraphState = { node, plan, attempt, maxRetries };
    saveCheckpoint(workspaceRoot, { version: 1, run, messages: msgs, graph });
  };

  while (attempt <= maxRetries) {
    const captured: { messages: AgentMessage[] } = { messages: messages ?? [] };
    const result = await runAgentLoop(
      run,
      {
        ...deps,
        onCheckpoint: (payload) => {
          captured.messages = payload.messages;
          deps.onCheckpoint?.(payload);
        },
      },
      {
        ...options,
        extraSystem,
        messages: approval ? messages : undefined,
        approval,
      },
    );
    approval = undefined;
    messages = captured.messages;

    if (result.status === "awaiting_approval") {
      persist("awaiting_approval", messages);
      return result;
    }
    if (result.status === "succeeded" || result.status === "cancelled") {
      persist(result.status === "succeeded" ? "succeeded" : "failed", messages);
      return result;
    }

    attempt += 1;
    if (attempt > maxRetries) {
      persist("failed", messages);
      return result;
    }

    run.status = "pending";
    run.error = undefined;
    run.updatedAt = nowIso();
    messages = undefined;
    persist("retry", []);
  }

  persist("failed", messages ?? []);
  return run;
}
