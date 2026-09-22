---
name: add-agent-tool
description: >-
  Adds a ToolSpec to the Local Coding Agent (packages/tools), registers it,
  sets sideEffect/policy, and adds unit plus eval coverage. Use when the user
  asks to add a tool, new ToolSpec, Phase 2 file/shell tools, or extend
  createPhase1Tools / createPhase2Tools.
disable-model-invocation: true
---

# Add agent tool

## Do not

- Change `runAgentLoop` unless a **contract** is broken (new field on `ToolSpec` / `Observation`).
- Call `execute` without going through the loop (policy must run).
- Dump full file/HTTP bodies into `summary`; keep observations small.

## Steps

1. **Implement** in `packages/tools/src/<name>.ts`
   - Export `createXTool(): ToolSpec`
   - Set `sideEffect`: `read` | `write` | `exec` | `external` | `destructive`
   - `execute` always returns `{ ok, summary, data?, error? }`
   - For paths: `assertPathInsideWorkspace` from `@lca/policy`
   - For shell: `isForbiddenShellCommand` + allowlist

2. **Register**
   - Phase 1: `createPhase1Tools()` in `packages/tools/src/index.ts`
   - Phase 2+: add `createPhase2Tools()` (or extend the registry) and wire it in `apps/cli/src/main.ts`
   - Re-export the factory from `index.ts`

3. **Heuristic routing** (if CI must work without a real LLM)
   - Extend `createHeuristicLlm()` in `packages/llm/src/index.ts` only when the new tool needs deterministic evals
   - Keep regex/routing narrow; do not steal calculator/weather cases

4. **Tests**
   - Unit: `packages/tools/src/index.test.ts` (or a dedicated `*.test.ts` listed in `package.json` test script)
   - Eval: add a case in `evals/src/cases.ts` (`expectTools`, `expectStatus`, answer checks)
   - Safety: at least one deny/escape case for file or shell tools

5. **Verify**
   - `pnpm --filter @lca/tools test`
   - `pnpm eval`
   - Smoke: `pnpm agent -- "<goal that should call the new tool>"`

## Side-effect cheat sheet

| Tool kind | `sideEffect` | Policy today |
|---|---|---|
| Read file / search | `read` | allow + path jail |
| Edit file | `write` | allow (path jail) |
| Lint / test command | `exec` | allow if not forbidden |
| HTTP / GitHub | `external` | allow |
| Delete / force-push / prod deploy | `destructive` | **ask** |

## Example shape

```ts
export function createReadFileTool(): ToolSpec {
  return {
    name: "read_file",
    description: "Read a UTF-8 file under the workspace root.",
    sideEffect: "read",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      // jail path, cap bytes, return { ok, summary, data }
    },
  };
}
```
