# Local Coding Agent

Production-oriented **Coding & Deployment AI Agent** platform, built phase-by-phase from the local roadmap in `docs/` (gitignored).

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
packages/tools        # calculator, weather, files, shell, RAG, memory, GitHub
packages/github       # gh/git helpers, dry-run by default
packages/rag          # chunk + hashed embeddings + cosine retrieval
packages/memory       # typed prefs/tasks in .lca/memory.json (no secrets)
packages/llm          # heuristic + OpenAI-compatible (Ollama/OpenAI)
evals/                # Phase 1–6 golden cases
fixtures/repos        # tiny-node fixture
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
pnpm agent -- "List the project files"
pnpm agent -- "Read the file README.md"
pnpm agent -- "Remember that I prefer pnpm as the package manager"
pnpm agent -- "What package manager do I prefer?"
pnpm agent -- "Confirm the action demo"
pnpm agent -- --approve
pnpm agent -- "Create a GitHub issue titled Bug in login"
pnpm agent -- "Review recent commits"

# Optional: Ollama
# LCA_PROVIDER=ollama OLLAMA_MODEL=llama3.2 pnpm agent -- "Calculate 15 * 4"
```

## Local docs (not committed)

Planning notes live under `docs/` and are gitignored. Open them locally:

- `docs/AI_Agent_Engineering_Roadmap.md`
- `docs/PHASE_0_1_CORE_CONCEPTS.md`
- `docs/PHASE_0_1_CHECKLIST.md`
- `docs/GITHUB_ISSUES.md`

## Git hygiene

- Copy env template: `cp .env.example .env` (never commit `.env`)
- Ignored by default: `node_modules/`, `dist/`, `.env`, logs, coverage, secrets — see [`.gitignore`](./.gitignore)
