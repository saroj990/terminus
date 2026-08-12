# Local Coding Agent

Production-oriented **Coding & Deployment AI Agent** platform, built phase-by-phase from [AI_Agent_Engineering_Roadmap.md](./AI_Agent_Engineering_Roadmap.md).

## Principles

- One agent runtime + tool platform — lessons become tools/evals, not throwaway apps
- Policy before every side effect
- Context budgets and observation summaries (not raw dumps)
- Eval harness from day one

## Monorepo

```text
apps/cli              # Phase 0/1 runner
packages/agent-core   # AgentRun, ToolSpec, Think→Act→Observe loop
packages/policy       # allow / deny / ask + path jail helpers
packages/logger       # structured JSON logs with secret redaction
packages/tools        # calculator, weather (Phase 1)
packages/llm          # heuristic + OpenAI-compatible (Ollama/OpenAI)
evals/                # Phase 1 golden cases
```

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm build
pnpm test
pnpm eval

# Heuristic provider (default — no API key)
pnpm agent -- "What is (12 + 8) * 3?"
pnpm agent -- "What is the weather in London?"

# Optional: Ollama
# LCA_PROVIDER=ollama OLLAMA_MODEL=llama3.2 pnpm agent -- "Calculate 15 * 4"
```

## Phase docs

- [Phase 0–1 core concepts](./docs/PHASE_0_1_CORE_CONCEPTS.md) — how the runtime works (start here to learn)
- [Phase 0–1 checklist](./docs/PHASE_0_1_CHECKLIST.md) — scope, guardrails, exit criteria
