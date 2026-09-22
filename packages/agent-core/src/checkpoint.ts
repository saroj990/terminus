/**
 * Disk checkpoints for crash-resume and HITL (Phase 5).
 * File: <workspace>/.lca/runs/<runId>.json plus LATEST pointer.
 */

import fs from "node:fs";
import path from "node:path";
import type { AgentMessage, AgentRun } from "./types.js";

export type GraphNode =
  | "plan"
  | "execute"
  | "retry"
  | "awaiting_approval"
  | "succeeded"
  | "failed";

export interface GraphState {
  node: GraphNode;
  plan: string[];
  attempt: number;
  maxRetries: number;
}

export interface RunCheckpoint {
  version: 1;
  run: AgentRun;
  messages: AgentMessage[];
  graph: GraphState;
}

export function runsDir(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), ".lca", "runs");
}

export function checkpointPath(workspaceRoot: string, runId: string): string {
  return path.join(runsDir(workspaceRoot), `${runId}.json`);
}

export function latestPointerPath(workspaceRoot: string): string {
  return path.join(runsDir(workspaceRoot), "LATEST");
}

export function saveCheckpoint(workspaceRoot: string, cp: RunCheckpoint): void {
  const dir = runsDir(workspaceRoot);
  fs.mkdirSync(dir, { recursive: true });
  const file = checkpointPath(workspaceRoot, cp.run.id);
  fs.writeFileSync(file, JSON.stringify(cp, null, 2), "utf8");
  fs.writeFileSync(latestPointerPath(workspaceRoot), cp.run.id, "utf8");
}

export function loadCheckpoint(workspaceRoot: string, runId: string): RunCheckpoint | undefined {
  const file = checkpointPath(workspaceRoot, runId);
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as RunCheckpoint;
    if (parsed?.version !== 1 || !parsed.run?.id) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function loadLatestCheckpoint(workspaceRoot: string): RunCheckpoint | undefined {
  const pointer = latestPointerPath(workspaceRoot);
  if (!fs.existsSync(pointer)) return undefined;
  const id = fs.readFileSync(pointer, "utf8").trim();
  if (!id) return undefined;
  return loadCheckpoint(workspaceRoot, id);
}
