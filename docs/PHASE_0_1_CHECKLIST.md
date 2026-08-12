# Phase 0 + Phase 1 Checklist

Senior-architect delivery plan for the first two weeks of the roadmap, mapped onto the shared platform spine.

---

## Context scope

| Layer | In scope now | Out of scope |
|---|---|---|
| Session | Single user goal + step log | Multi-turn memory, prefs |
| Tools | `calculator`, `get_weather` | File/shell/git |
| Repo | Workspace root as metadata only | Indexing / RAG |
| Secrets | Env-based provider keys; log redaction | Vault / KMS |
| Network | Open-Meteo for weather; optional LLM API | Arbitrary browsing |

**Prompt budget (enforced later in coding agent):** keep tool observations small; calculator/weather already return `summary` + compact `data`.

---

## Guardrails (active)

- Every tool call passes `PolicyEngine` (`allow` | `deny` | `ask`)
- Phase 1 tools are `read` / `external` → auto-allow
- `destructive` → `ask` (HITL stub; run pauses at `awaiting_approval`)
- Calculator rejects non-arithmetic input (no identifiers / code exec beyond validated charset)
- Weather uses fixed geocode allowlist (or explicit lat/lon)
- Logger redacts `*key*`, `*token*`, `*secret*`, `sk-...`

---

## Expectations

### Phase 0 — Runtime spine

- [x] Monorepo workspaces (`apps/*`, `packages/*`, `evals`)
- [x] Contracts: `AgentRun`, `ToolSpec`, `Observation`, `PolicyDecision`, `ContextBudget`
- [x] `runAgentLoop` (Think → Act → Observe) with max-steps + abort
- [x] Structured logger
- [x] Default policy + path-jail helpers (for Phase 2)
- [x] CLI entrypoint that records run id + steps

### Phase 1 — Tool calling lessons (on the spine)

- [x] Lesson 1: Calculator tool + agent routing
- [x] Lesson 2: Weather tool (Open-Meteo) + decide-when-to-use via heuristic/LLM
- [x] Structured tool results (`ok`, `summary`, `data`)
- [x] Provider switch: `heuristic` | `ollama` | `openai`

---

## Testing

| Layer | Command | What it covers |
|---|---|---|
| Unit | `pnpm test` | Expression safety, weather mock, policy, heuristic routing |
| Eval | `pnpm eval` | Golden goals → tool sequence → answer checks |
| Manual | `pnpm agent -- "..."` | End-to-end smoke |

### Eval cases (Phase 1)

- `calc_basic`, `calc_divide` — routing + numeric correctness
- `weather_london`, `weather_tokyo` — routing + mocked API
- `no_tool_chitchat` — do not call tools
- `safety_unknown_tool_policy_ready` — happy path still succeeds under policy

**Merge bar:** `pnpm build && pnpm test && pnpm eval` green on heuristic provider (no network required for evals).

---

## How to run with a real model

1. Install/start Ollama and pull a tool-capable model (`llama3.2` or similar)
2. Set in `.env`:
   ```bash
   LCA_PROVIDER=ollama
   OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
   OLLAMA_MODEL=llama3.2
   ```
3. `pnpm agent -- "What is 19 * 3?"`

---

## Exit criteria → Phase 2

Proceed to File + Terminal agents when:

1. Contracts are stable (no breaking renames without ADR)
2. Policy denies/asks are covered by unit tests
3. Phase 1 evals pass
4. You can add a new tool by implementing `ToolSpec` only (no loop changes)

## Next (Phase 2 preview)

- `read_file`, `list_dir`, `search_files` behind path jail
- `run_shell` with allowlist + `isForbiddenShellCommand`
- Fixture repo under `fixtures/repos/tiny-node`
- Eval cases for summarize-project + denied `rm -rf /`
