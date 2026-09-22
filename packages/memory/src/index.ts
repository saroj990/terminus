/**
 * Phase 4 memory: typed facts that persist across AgentRuns.
 * Short-term chat still lives in the loop's messages[]; this is long-term + session file.
 * Never store secrets. Cap record count. File: <workspace>/.lca/memory.json
 */

import fs from "node:fs";
import path from "node:path";

export type MemoryKind = "preference" | "task";

export interface MemoryRecord {
  kind: MemoryKind;
  key: string;
  value: string;
  updatedAt: string;
}

const MAX_RECORDS = 100;
const MAX_VALUE = 500;

const SECRET_RE = /api[_-]?key|token|password|secret|authorization|sk-[a-z0-9]/i;

export function looksLikeSecret(text: string): boolean {
  return SECRET_RE.test(text);
}

export function memoryFilePath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), ".lca", "memory.json");
}

export function loadMemory(workspaceRoot: string): MemoryRecord[] {
  const file = memoryFilePath(workspaceRoot);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord);
  } catch {
    return [];
  }
}

export function saveMemory(workspaceRoot: string, records: MemoryRecord[]): void {
  const dir = path.dirname(memoryFilePath(workspaceRoot));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(memoryFilePath(workspaceRoot), JSON.stringify(records, null, 2), "utf8");
}

export function upsertMemory(
  workspaceRoot: string,
  input: { kind: MemoryKind; key: string; value: string },
): MemoryRecord {
  const key = input.key.trim().slice(0, 80);
  const value = input.value.trim().slice(0, MAX_VALUE);
  if (!key || !value) throw new Error("key and value are required");
  if (looksLikeSecret(key) || looksLikeSecret(value)) {
    throw new Error("Refused to store secret-like memory");
  }
  const records = loadMemory(workspaceRoot);
  const next: MemoryRecord = {
    kind: input.kind,
    key,
    value,
    updatedAt: new Date().toISOString(),
  };
  const idx = records.findIndex((r) => r.kind === next.kind && r.key === next.key);
  if (idx >= 0) records[idx] = next;
  else records.push(next);
  const trimmed = records.slice(-MAX_RECORDS);
  saveMemory(workspaceRoot, trimmed);
  return next;
}

export function queryMemory(workspaceRoot: string, query?: string): MemoryRecord[] {
  const records = loadMemory(workspaceRoot);
  const q = query?.trim().toLowerCase();
  if (!q) return records;
  return records.filter(
    (r) =>
      r.key.toLowerCase().includes(q) ||
      r.value.toLowerCase().includes(q) ||
      r.kind.toLowerCase().includes(q),
  );
}

/** Compact block to inject into the system prompt (session context). */
export function formatMemoryPrompt(records: MemoryRecord[]): string {
  if (!records.length) return "";
  const lines = records.map((r) => `- [${r.kind}] ${r.key}: ${r.value}`);
  return `Known user/project memory:\n${lines.join("\n")}`;
}

function isRecord(x: unknown): x is MemoryRecord {
  if (!x || typeof x !== "object") return false;
  const r = x as MemoryRecord;
  return (
    (r.kind === "preference" || r.kind === "task") &&
    typeof r.key === "string" &&
    typeof r.value === "string"
  );
}
