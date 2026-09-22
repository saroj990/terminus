import type { ToolSpec } from "@lca/agent-core";
import { queryMemory, upsertMemory, type MemoryKind } from "@lca/memory";

export function createRememberTool(): ToolSpec {
  return {
    name: "remember",
    description:
      "Store a typed long-term fact: kind preference (coding style, package manager) or task (what we did). Never store secrets or API keys.",
    sideEffect: "write",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["preference", "task"] },
        key: { type: "string", description: "Short label, e.g. package_manager" },
        value: { type: "string", description: "Fact to remember" },
      },
      required: ["kind", "key", "value"],
      additionalProperties: false,
    },
    maxObservationTokens: 200,
    async execute(input, ctx) {
      try {
        const kind = input.kind === "task" ? "task" : "preference";
        const rec = upsertMemory(ctx.workspaceRoot, {
          kind: kind as MemoryKind,
          key: String(input.key ?? ""),
          value: String(input.value ?? ""),
        });
        return {
          ok: true,
          data: rec,
          summary: `Remembered [${rec.kind}] ${rec.key}: ${rec.value}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, summary: `remember failed: ${message}` };
      }
    },
  };
}

export function createRecallTool(): ToolSpec {
  return {
    name: "recall",
    description:
      "Recall stored preferences and previous tasks. Use when asked what the user prefers or what we did before.",
    sideEffect: "read",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional filter substring" },
      },
      additionalProperties: false,
    },
    maxObservationTokens: 800,
    async execute(input, ctx) {
      const query = typeof input.query === "string" ? input.query : undefined;
      const records = queryMemory(ctx.workspaceRoot, query);
      return {
        ok: true,
        data: { records },
        summary:
          records.length === 0
            ? "No stored memory yet"
            : records.map((r) => `[${r.kind}] ${r.key}: ${r.value}`).join("; "),
      };
    },
  };
}
