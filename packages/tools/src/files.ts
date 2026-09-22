import type { ToolSpec } from "@lca/agent-core";
import {
  assertPathInsideWorkspace,
  isSensitiveWorkspacePath,
} from "@lca/policy";
import fs from "node:fs";
import path from "node:path";

const MAX_READ_BYTES = 32_768;
const MAX_LIST_ENTRIES = 50;
const MAX_SEARCH_HITS = 20;
const MAX_SEARCH_FILE_BYTES = 64_768;
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", ".git", ".lca", "coverage"]);

function fail(message: string) {
  return { ok: false as const, error: message, summary: message };
}

function resolveSafe(workspaceRoot: string, userPath: string): string {
  return assertPathInsideWorkspace(workspaceRoot, userPath);
}

function denyIfSensitive(resolved: string): string | undefined {
  if (isSensitiveWorkspacePath(resolved)) {
    return `Refused sensitive path: ${path.basename(resolved)}`;
  }
  return undefined;
}

export function createReadFileTool(): ToolSpec {
  return {
    name: "read_file",
    description:
      "Read a UTF-8 text file under the workspace root. Paths cannot escape the workspace. Secret files (.env, keys, credentials) are blocked.",
    sideEffect: "read",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path under the workspace" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    maxObservationTokens: 2000,
    async execute(input, ctx) {
      try {
        const userPath = String(input.path ?? "");
        const resolved = resolveSafe(ctx.workspaceRoot, userPath);
        const sensitive = denyIfSensitive(resolved);
        if (sensitive) return fail(sensitive);

        const stat = fs.statSync(resolved);
        if (!stat.isFile()) return fail(`Not a file: ${userPath}`);
        if (stat.size > MAX_READ_BYTES) {
          return fail(`File too large (${stat.size} bytes; max ${MAX_READ_BYTES})`);
        }

        const buf = fs.readFileSync(resolved);
        if (buf.includes(0)) return fail("Refused binary file");
        const content = buf.toString("utf8");
        const rel = path.relative(ctx.workspaceRoot, resolved);
        const preview = content.slice(0, 240);
        return {
          ok: true,
          data: { path: rel, bytes: buf.length, content },
          summary: `Read ${rel} (${buf.length} bytes): ${preview}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail(message);
      }
    },
  };
}

export function createListDirTool(): ToolSpec {
  return {
    name: "list_dir",
    description:
      "List files and directories under a workspace folder (non-recursive). Skips node_modules, dist, and .git. Paths cannot escape the workspace.",
    sideEffect: "read",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative directory, default '.'",
        },
      },
      additionalProperties: false,
    },
    maxObservationTokens: 800,
    async execute(input, ctx) {
      try {
        const userPath = String(input.path ?? ".");
        const resolved = resolveSafe(ctx.workspaceRoot, userPath);
        const sensitive = denyIfSensitive(resolved);
        if (sensitive) return fail(sensitive);

        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) return fail(`Not a directory: ${userPath}`);

        const names = fs.readdirSync(resolved).filter((n) => {
          if (SKIP_DIR_NAMES.has(n)) return false;
          const full = path.join(resolved, n);
          return !isSensitiveWorkspacePath(full);
        });
        const truncated = names.length > MAX_LIST_ENTRIES;
        const slice = names.slice(0, MAX_LIST_ENTRIES);
        const entries = slice.map((name) => {
          const full = path.join(resolved, name);
          let type: "file" | "dir" | "other" = "other";
          try {
            const s = fs.lstatSync(full);
            if (s.isSymbolicLink()) type = "other";
            else if (s.isDirectory()) type = "dir";
            else if (s.isFile()) type = "file";
          } catch {
            type = "other";
          }
          return { name, type };
        });

        const rel = path.relative(ctx.workspaceRoot, resolved) || ".";
        const namesPreview = entries.map((e) => e.name).join(", ");
        return {
          ok: true,
          data: { path: rel, entries, truncated },
          summary: `Listed ${entries.length} entries in ${rel}: ${namesPreview}${truncated ? " (truncated)" : ""}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail(message);
      }
    },
  };
}

export function createSearchFilesTool(): ToolSpec {
  return {
    name: "search_files",
    description:
      "Search workspace text files for a literal substring. Skips node_modules, dist, .git, binaries, and secret files. Max hits capped.",
    sideEffect: "read",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Literal substring to find" },
        path: { type: "string", description: "Relative start directory, default '.'" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    maxObservationTokens: 1200,
    async execute(input, ctx) {
      try {
        const query = String(input.query ?? "");
        if (!query || query.length > 200) {
          return fail("query must be 1–200 characters");
        }
        const userPath = String(input.path ?? ".");
        const start = resolveSafe(ctx.workspaceRoot, userPath);
        const sensitive = denyIfSensitive(start);
        if (sensitive) return fail(sensitive);

        const hits: Array<{ path: string; line: number }> = [];
        walk(start, ctx.workspaceRoot, (file) => {
          if (hits.length >= MAX_SEARCH_HITS) return;
          if (isSensitiveWorkspacePath(file)) return;
          let stat: fs.Stats;
          try {
            stat = fs.statSync(file);
          } catch {
            return;
          }
          if (!stat.isFile() || stat.size > MAX_SEARCH_FILE_BYTES) return;
          const buf = fs.readFileSync(file);
          if (buf.includes(0)) return;
          const text = buf.toString("utf8");
          const lines = text.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (hits.length >= MAX_SEARCH_HITS) break;
            if (lines[i]?.includes(query)) {
              hits.push({
                path: path.relative(ctx.workspaceRoot, file),
                line: i + 1,
              });
            }
          }
        });

        const hitsPreview = hits.map((h) => `${h.path}:${h.line}`).join(", ");
        return {
          ok: true,
          data: { query, hits, hitCount: hits.length },
          summary:
            hits.length === 0
              ? `No matches for '${query}'`
              : `Found ${hits.length} match(es) for '${query}' in ${hitsPreview}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return fail(message);
      }
    },
  };
}

function walk(dir: string, root: string, onFile: (file: string) => void): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = path.join(dir, name);
    let rel: string;
    try {
      const jailed = assertPathInsideWorkspace(root, path.relative(root, full));
      rel = jailed;
    } catch {
      continue;
    }
    let st: fs.Stats;
    try {
      st = fs.lstatSync(rel);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(rel, root, onFile);
    else if (st.isFile()) onFile(rel);
  }
}
