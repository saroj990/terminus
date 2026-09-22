import type { ToolSpec } from "@lca/agent-core";
import { assertPathInsideWorkspace, isSensitiveWorkspacePath } from "@lca/policy";
import { indexWorkspace, searchChunks, type Chunk } from "@lca/rag";

const cache = new Map<string, Chunk[]>();

export function createIndexCodebaseTool(): ToolSpec {
  return {
    name: "index_codebase",
    description:
      "Build a semantic index of text files under the workspace (skips secrets, .git, node_modules). Call before search_codebase if the repo changed.",
    sideEffect: "read",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative folder to index, default '.'" },
      },
      additionalProperties: false,
    },
    maxObservationTokens: 400,
    async execute(input, ctx) {
      try {
        const rel = String(input.path ?? ".");
        const start = assertPathInsideWorkspace(ctx.workspaceRoot, rel);
        if (isSensitiveWorkspacePath(start)) {
          return { ok: false, error: "Refused sensitive path", summary: "index_codebase refused" };
        }
        const chunks = indexWorkspace(ctx.workspaceRoot);
        cache.set(ctx.workspaceRoot, chunks);
        return {
          ok: true,
          data: { chunkCount: chunks.length, root: rel },
          summary: `Indexed ${chunks.length} chunks under ${rel}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, summary: `index_codebase failed: ${message}` };
      }
    },
  };
}

export function createSearchCodebaseTool(): ToolSpec {
  return {
    name: "search_codebase",
    description:
      "Semantic search over the workspace index (meaning, not exact substring). Use for 'where is X' or 'what does this project do'. Indexes lazily if needed.",
    sideEffect: "read",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language question" },
        k: { type: "number", description: "Max hits, default 5" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    maxObservationTokens: 1200,
    async execute(input, ctx) {
      try {
        const query = String(input.query ?? "").trim();
        if (!query || query.length > 500) {
          return { ok: false, error: "query required (max 500 chars)", summary: "search_codebase rejected query" };
        }
        let chunks = cache.get(ctx.workspaceRoot);
        if (!chunks) {
          chunks = indexWorkspace(ctx.workspaceRoot);
          cache.set(ctx.workspaceRoot, chunks);
        }
        const k = Math.min(8, Math.max(1, Number(input.k) || 5));
        const hits = searchChunks(chunks, query, k);
        const preview = hits.map((h) => `${h.path}:${h.startLine}`).join(", ");
        return {
          ok: true,
          data: { query, hits },
          summary:
            hits.length === 0
              ? `No semantic hits for '${query}'`
              : `Top hits: ${preview}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, summary: `search_codebase failed: ${message}` };
      }
    },
  };
}
