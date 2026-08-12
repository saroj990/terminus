# Phase 0–1 Core Concepts

How this codebase turns “chat with an LLM” into a **tool-using agent runtime**.
Read this to understand the design; use [PHASE_0_1_CHECKLIST.md](./PHASE_0_1_CHECKLIST.md) for delivery status.

---

## 1. Big picture

An agent is not “the model.” The model decides *what to try*; **your runtime** decides *what is allowed*, *how tools run*, and *what gets remembered*.

```text
User goal
   ↓
CLI creates AgentRun
   ↓
┌─────────────────────────────────────────────┐
│  runAgentLoop  (Think → Act → Observe)      │
│                                             │
│  LLM (heuristic / Ollama / OpenAI)          │
│       ↓ tool_calls?                         │
│  PolicyEngine  → allow | deny | ask         │
│       ↓                                     │
│  ToolSpec.execute → Observation             │
│       ↓ feed back into messages             │
│  …until final text answer or max steps      │
└─────────────────────────────────────────────┘
   ↓
Final answer + audit trail (steps, logs)
```

| Package | Role |
|---|---|
| `@lca/agent-core` | Contracts + agent loop |
| `@lca/llm` | Model adapters (`LlmClient`) |
| `@lca/tools` | Calculator + weather |
| `@lca/policy` | Allow / deny / ask |
| `@lca/logger` | Structured, redacted logs |
| `@lca/cli` | Wires everything for one goal |
| `evals` | Golden tasks that prove routing + answers |

---

## 2. LLM fundamentals (what Phase 1 teaches)

### Tokens & context

LLMs consume **tokens** (pieces of text), not “files.” Everything you send—system prompt, user goal, tool schemas, tool results—competes for a limited **context window**.

That is why tools return:

- `summary` — short text for the next model turn
- `data` — structured payload for code / UI / evals

Dumping raw API JSON into the prompt burns tokens and confuses later steps. `ContextBudget` in `agent-core` is the planned ceiling for later phases (RAG, open files); Phase 1 stays small by design.

### Prompt engineering

The loop uses a fixed **system prompt**: prefer tools for math/facts, don’t invent tool results, answer briefly after observations. The **user message** is just the goal. Tool *descriptions* and *JSON schemas* are also prompts—they teach the model *when* and *how* to call a tool.

### Temperature

Real providers are configured with `temperature: 0` in the OpenAI-compatible client for more deterministic tool calling. The **heuristic** provider ignores temperature entirely (pure rules).

### Function (tool) calling

Instead of only generating prose, the model can return structured **tool calls**:

```json
{ "name": "calculator", "arguments": { "expression": "(12+8)*3" } }
```

Your runtime executes that call and returns an **observation**. The model never “runs” the calculator itself—it only *requests* it.

### Structured outputs

Two layers of structure:

1. **Tool arguments** — validated by charset / schema conventions (`expression`, `location`)
2. **Tool results** — always `{ ok, summary, data?, error? }`

Evals assert on both tool names and numeric / substring answers.

---

## 3. The agent loop (Think → Act → Observe)

Implemented in `packages/agent-core/src/loop.ts` as `runAgentLoop`.

| Phase | What happens |
|---|---|
| **Think** | `llm.complete({ messages, tools })` → text and/or `toolCalls` |
| **Act** | For each call: policy check → `tool.execute(...)` |
| **Observe** | Append a `tool` message with JSON result; record `Observation` on the step |
| **Stop** | No tool calls → `finalAnswer`; or `maxSteps` / abort / `ask` |

Important properties:

- **Messages accumulate** — the model sees prior tool results on the next think step.
- **Policy is mandatory** — even a correct model call can be denied.
- **Unknown tools fail closed** — no execute path.
- **`ask` pauses the run** — status `awaiting_approval` (HITL stub for later UI).

A successful calculator run looks like:

```text
Step 0  Think → tool_calls: calculator("(12+8)*3")
        Act   → policy allow → execute → 60
        Observe → { ok: true, summary: "(12+8)*3 = 60", data: { result: 60 } }
Step 1  Think → no tools → "The answer is 60."
```

---

## 4. Core contracts (the stable spine)

These types should change rarely. New phases add packages that *depend* on them.

### `AgentRun`

One attempt to achieve a **goal**. Holds `id`, `status`, `steps[]`, `finalAnswer`, timestamps. This is your audit unit (logs, future dashboard, resume).

### `AgentStep`

One loop iteration: optional thought, tool calls, observations, timing.

### `ToolSpec`

How the runtime learns about a capability:

| Field | Meaning |
|---|---|
| `name` | Stable id the model must use |
| `description` | Natural-language “when to use me” |
| `sideEffect` | Risk class for policy |
| `inputSchema` | JSON Schema for arguments |
| `execute` | Actual implementation |

**Design rule:** add capability by shipping a new `ToolSpec`, not by forking the loop.

### `SideEffectClass`

| Class | Examples (roadmap) | Phase 0–1 default |
|---|---|---|
| `read` | calculator, read file | allow |
| `write` | edit file | allow (later: may ask for bulk) |
| `exec` | shell / tests | allow + allowlist later |
| `external` | weather, GitHub API | allow |
| `destructive` | delete, force-push, prod deploy | **ask** |

### `PolicyDecision`

`allow` | `deny` | `ask` + `reason` + optional `ruleId`. Every `Observation` stores the decision that applied—so you can debug “why didn’t this run?”

### `Observation`

What the agent *saw* after an act: success flag, summary, data, duration, policy. This is the bridge between tools and the next think step.

### `LlmClient`

Tiny port:

```ts
complete({ messages, tools, signal }) → { content?, toolCalls?, finishReason? }
```

Swap heuristic ↔ Ollama ↔ OpenAI without touching the loop.

---

## 5. Providers: heuristic vs real LLMs

### Heuristic (`LCA_PROVIDER=heuristic`)

A deterministic router in `@lca/llm`:

- Math-like text → `calculator`
- Weather-like text → `get_weather`
- After a tool message → format a final answer from the observation
- Otherwise → short help text (no tools)

**Why it exists:** CI and learning without API keys or flaky models. Evals run entirely on this path (weather API mocked).

### Ollama / OpenAI

Same OpenAI-compatible `/chat/completions` shape. Tools are sent as `tools: [{ type: "function", function: { name, description, parameters } }]`. Assistant turns that requested tools are replayed with `tool_calls` so multi-step chats stay valid.

---

## 6. Phase 1 tools in practice

### Calculator (`read`)

- Accepts an arithmetic `expression`
- Rejects letters / identifiers (blocks `process.exit` style injection)
- Returns `data.result` for evals and a short `summary` for the model

**Concept:** the model is bad at precise arithmetic; tools fix that.

### Weather (`external`)

- Resolves city → lat/lon via a small allowlist (or explicit coordinates)
- Calls Open-Meteo
- Summarizes temperature / wind

**Concept:** the model decides *whether* to call the tool; the tool owns I/O and formatting. “Decide when to use the tool” is the hard part—evals cover weather vs chitchat vs math.

---

## 7. Policy & safety (already wired)

```text
tool call requested
      ↓
deny list?     → deny
destructive?   → ask (pause)
allowed class? → allow
else           → deny
```

Also prepared for Phase 2 (not used by calc/weather yet):

- `assertPathInsideWorkspace` — path jail
- `isForbiddenShellCommand` — block `curl`, `sudo`, force-push, etc.

Logger redacts secrets in field names / `sk-...` patterns so run logs stay shareable.

---

## 8. How a CLI request is wired

`apps/cli/src/main.ts` is the composition root:

1. Load `.env`
2. `createAgentRun(goal)`
3. `runAgentLoop(run, { llm, tools, policy, onStep })`
4. Log each step; print `finalAnswer`

Nothing domain-specific lives in the loop—only in tools and policy. That is what makes Phase 2+ additive.

---

## 9. Testing philosophy

| Kind | Purpose |
|---|---|
| **Unit** | Pure functions (math safety, path jail, routing regexes) |
| **Loop tests** | Policy deny / tool then answer without a real model |
| **Evals** | Golden *goals* → expected tools + answer shape |

Evals are the merge bar for agent quality. Unit tests alone cannot catch “model called weather for a math question.”

---

## 10. Mental model cheat sheet

| Concept | In this repo |
|---|---|
| LLM | `LlmClient` implementation |
| Tool / function call | `ToolSpec` + `ToolCallRequest` |
| Agent | `runAgentLoop` over an `AgentRun` |
| Memory (short-term) | Accumulating `messages[]` inside one run |
| Guardrail | `PolicyEngine` + tool-level validation |
| Observation | Tool result fed back to the model |
| Structured output | Tool args schema + `{ ok, summary, data }` |
| Context window | Why summaries exist; `ContextBudget` for later |

---

## 11. What Phase 0–1 deliberately does *not* do

- Multi-turn conversation memory across runs
- Repo indexing / RAG
- File or shell tools
- Real human approval UI (only status `awaiting_approval`)
- NestJS / React dashboard

Those arrive later **on the same contracts**.

---

## 12. Suggested reading order in code

1. `packages/agent-core/src/types.ts` — vocabulary  
2. `packages/agent-core/src/loop.ts` — control flow  
3. `packages/tools/src/calculator.ts` — simplest tool  
4. `packages/tools/src/weather.ts` — external I/O tool  
5. `packages/llm/src/index.ts` — heuristic vs API  
6. `packages/policy/src/index.ts` — guardrails  
7. `apps/cli/src/main.ts` — wiring  
8. `evals/src/cases.ts` — what “correct” means  

When you can add a third tool with only a new `ToolSpec` + eval cases, Phase 0–1 concepts have landed.
