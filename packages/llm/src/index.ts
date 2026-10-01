/**
 * =============================================================================
 * @lca/llm — LLM adapters ("the brain")
 * =============================================================================
 *
 * WHAT THIS PACKAGE IS
 * --------------------
 * The agent loop (`runAgentLoop`) does not talk to OpenAI/Ollama directly.
 * It only depends on a tiny interface from @lca/agent-core:
 *
 *   LlmClient {
 *     complete({ messages, tools, signal }) → LlmResponse
 *   }
 *
 *   LlmResponse {
 *     content?: string           // final prose answer (optional)
 *     toolCalls?: [...]          // "please run these tools"
 *     finishReason?: "stop" | "tool_calls" | ...
 *   }
 *
 * THIS FILE provides three ways to implement that interface:
 *   1) createHeuristicLlm()         — fake brain with regex rules (default, offline)
 *   2) createOpenAiCompatibleLlm()  — real HTTP chat completions (Ollama OR OpenAI)
 *   3) createLlmFromEnv()           — pick (1) or (2) from .env / process.env
 *
 * WHY A FAKE "HEURISTIC" LLM?
 * ---------------------------
 * - No API key, no network, deterministic → perfect for CI evals and learning
 * - Teaches the SAME shape as a real model: return tool_calls, then a final answer
 * - Lets you understand the agent loop before debugging model flakiness
 *
 * HOW THE AGENT LOOP USES THIS
 * ----------------------------
 *   Step A: complete(messages, tools) → maybe toolCalls
 *   Step B: runtime executes tools → appends role:"tool" messages
 *   Step C: complete(messages, tools) again → usually final content (stop)
 */

import type { AgentMessage, LlmClient, LlmResponse, ToolSpec } from "@lca/agent-core";
import { createToolCallId } from "@lca/agent-core";

// =============================================================================
// 1) Heuristic LLM — rule-based router that *looks like* a tool-calling model
// =============================================================================

/**
 * Create a deterministic LlmClient for demos, tests, and offline development.
 *
 * Behavior overview:
 *   - If the latest message is already a tool result → turn it into a final answer
 *   - Else if the user asks about weather → request get_weather
 *   - Else if the user asks math → request calculator
 *   - Else → short help text (no tools)
 *
 * Important: this is NOT machine learning. It is intentional scaffolding so the
 * rest of the platform (loop, policy, tools, evals) can be built and tested.
 */
export function createHeuristicLlm(): LlmClient {
  return {
    /**
     * `complete` is the only method the agent loop calls.
     *
     * Inputs:
     *   messages — conversation so far (system, user, assistant, tool)
     *   tools    — ToolSpec list the runtime registered (calculator, weather, ...)
     *
     * Output must be an LlmResponse. Two common shapes:
     *   { finishReason: "tool_calls", toolCalls: [...] }  // ask runtime to act
     *   { finishReason: "stop", content: "..." }          // done; final answer
     */
    async complete({ messages, tools }): Promise<LlmResponse> {
      /**
       * TURN 2+ AFTER A TOOL RAN
       * ------------------------
       * The agent loop appends messages like:
       *   { role: "tool", content: '{"ok":true,"summary":"2+2 = 4","data":{"result":4}}' }
       *
       * When we see that, we should NOT call more tools — we should answer the user.
       * Real models do this by "reading" the tool JSON; we format it with helpers below.
       */
      const lastTool = [...messages].reverse().find((m) => m.role === "tool");
      if (lastTool) {
        return {
          content: formatFinalFromTool(lastTool.content),
          finishReason: "stop",
        };
      }

      // Find the user's original goal text (ignore system prompt).
      const user = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

      /**
       * Only request tools that were actually registered.
       * Example: if Phase 1 tools were removed, we must not emit get_weather.
       */
      const toolNames = new Set(tools.map((t) => t.name));

      /**
       * WEATHER ROUTING (pattern 1)
       * ---------------------------
       * Try to pull a city out of phrases like:
       *   "weather in London"
       *   "weather for Tokyo"
       *   "what's the weather in Mumbai?"
       *
       * Regex groups (1)/(2)/(3) are alternative capture positions for the city name.
       */
      const weatherMatch = user.match(
        /weather\s+(?:in|for|at)\s+([A-Za-z][A-Za-z\s]+)|(?:in|for)\s+([A-Za-z][A-Za-z\s]+)\b.*weather|weather.*\b([A-Za-z][A-Za-z\s]+)\b/i,
      );
      if (weatherMatch && toolNames.has("get_weather")) {
        const location = (weatherMatch[1] || weatherMatch[2] || weatherMatch[3] || "London")
          .trim()
          .replace(/[?.!]+$/, ""); // strip trailing punctuation from the city

        /**
         * Returning toolCalls tells the agent loop:
         *   "please run get_weather({ location }) and show me the observation"
         *
         * content is empty because we are not answering yet — we are acting.
         * finishReason "tool_calls" mirrors what real OpenAI-style APIs return.
         */
        return {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: createToolCallId(), // unique id so observations can be matched later
              name: "get_weather",
              arguments: { location },
            },
          ],
        };
      }

      /**
       * WEATHER ROUTING (pattern 2 — fallback)
       * --------------------------------------
       * If the message merely contains the word "weather", try to spot a known city.
       * If none found, default to London so demos still work.
       */
      if (/\bweather\b/i.test(user) && toolNames.has("get_weather")) {
        const city = user.match(
          /\b(London|Paris|Tokyo|Mumbai|Delhi|Bangalore|Bengaluru|Sydney|New York|San Francisco)\b/i,
        );
        return {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: createToolCallId(),
              name: "get_weather",
              arguments: { location: city?.[1] ?? "London" },
            },
          ],
        };
      }

      /**
       * MATH ROUTING
       * ------------
       * Look for arithmetic cues: operators between numbers, "calculate", "(12+8)*3", etc.
       * If matched, extract an expression string for the calculator tool.
       */
      const mathHint =
        /[\d)]\s*[+\-*/]\s*[\d(]|what\s+is\s+.+\d|calculate|compute|\(.*\d+.*\)/i.test(
          user,
        ) && !/\bread(?:\s+the)?\s+file\b/i.test(user);
      if (mathHint && toolNames.has("calculator")) {
        const expression = extractExpression(user);
        return {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [
            {
              id: createToolCallId(),
              name: "calculator",
              arguments: { expression },
            },
          ],
        };
      }

      const hitlCall = routeHitl(user, toolNames);
      if (hitlCall) return hitlCall;

      const codingCall = routeCoding(user, toolNames);
      if (codingCall) return codingCall;

      const githubCall = routeGithub(user, toolNames);
      if (githubCall) return githubCall;

      const deployCall = routeDeploy(user, toolNames);
      if (deployCall) return deployCall;

      const memoryCall = routeMemory(user, toolNames);
      if (memoryCall) return memoryCall;

      const fileCall = routeFileAndShell(user, toolNames);
      if (fileCall) return fileCall;

      /**
       * NO TOOL NEEDED
       * --------------
       * Chitchat / unclear goals: answer directly without tool_calls.
       * Evals use this path for cases like "Hello, who are you?".
       */
      return {
        content:
          "I can help with arithmetic, weather, files, codebase search, shell, memory, GitHub (dry-run by default), deploy staging (dry-run), or confirm_action (needs approval).",
        finishReason: "stop",
      };
    },
  };
}

function routeCoding(user: string, toolNames: Set<string>): LlmResponse | undefined {
  const call = (name: string, args: Record<string, unknown>): LlmResponse => ({
    content: "",
    finishReason: "tool_calls",
    toolCalls: [{ id: createToolCallId(), name, arguments: args }],
  });

  if (toolNames.has("run_workspace_tests") && /\brun\b.*\btests?\b/i.test(user)) {
    return call("run_workspace_tests", {});
  }
  if (toolNames.has("run_workspace_lint") && /\brun\b.*\b(lint|typecheck)\b/i.test(user)) {
    return call("run_workspace_lint", {});
  }

  if (toolNames.has("write_file") && /\b(write|create|update)\b.*\bfile\b/i.test(user)) {
    const rich = user.match(
      /write(?:\s+the)?\s+file\s+(\S+)\s+with\s+content\s+(.+?)[?.!]*$/i,
    );
    if (rich?.[1] && rich[2]) {
      return call("write_file", {
        path: rich[1].replace(/^["']|["']$/g, ""),
        content: rich[2].trim(),
      });
    }
    const pathOnly = user.match(/file\s+(\S+)/i)?.[1]?.replace(/^["']|["']$/g, "");
    if (pathOnly) {
      return call("write_file", { path: pathOnly, content: "" });
    }
  }
  return undefined;
}

function routeDeploy(user: string, toolNames: Set<string>): LlmResponse | undefined {
  const call = (name: string, args: Record<string, unknown>): LlmResponse => ({
    content: "",
    finishReason: "tool_calls",
    toolCalls: [{ id: createToolCallId(), name, arguments: args }],
  });

  if (
    toolNames.has("deploy_docker_build") &&
    /\b(build|create)\b.*\bdocker\b/i.test(user)
  ) {
    return call("deploy_docker_build", {});
  }
  if (toolNames.has("deploy_staging") && /\bdeploy\b.*\bstaging\b/i.test(user)) {
    return call("deploy_staging", {});
  }
  if (
    toolNames.has("deploy_check_health") &&
    /\b(check|verify)\b.*\b(health|staging)\b/i.test(user)
  ) {
    return call("deploy_check_health", {});
  }
  if (
    toolNames.has("deploy_propose_rollback") &&
    /\b(propose|plan)\b.*\brollback\b/i.test(user)
  ) {
    const reason =
      user.match(/because\s+(.+?)[?.!]*$/i)?.[1]?.trim() ?? "health check failed";
    const rev = user.match(/revision\s+(\S+)/i)?.[1];
    return call("deploy_propose_rollback", {
      reason,
      ...(rev ? { previousRevision: rev } : {}),
    });
  }
  return undefined;
}

function routeGithub(user: string, toolNames: Set<string>): LlmResponse | undefined {
  const call = (name: string, args: Record<string, unknown>): LlmResponse => ({
    content: "",
    finishReason: "tool_calls",
    toolCalls: [{ id: createToolCallId(), name, arguments: args }],
  });

  if (toolNames.has("github_review_commits") && /\b(review|summarize)\b.*\bcommit/i.test(user)) {
    return call("github_review_commits", { limit: 5 });
  }
  if (toolNames.has("github_create_issue") && /\b(create|open)\b.*\bissue/i.test(user)) {
    const title =
      user.match(/issue(?:\s+title)?\s+['"]?([^'".\n]+)/i)?.[1]?.trim() ??
      user.match(/titled\s+['"]?([^'".\n]+)/i)?.[1]?.trim() ??
      "Untitled issue";
    return call("github_create_issue", { title });
  }
  if (toolNames.has("github_open_pr") && /\b(open|create)\b.*\bpull request/i.test(user)) {
    const title =
      user.match(/pull request\s+['"]?([^'".\n]+)/i)?.[1]?.trim() ??
      user.match(/titled\s+['"]?([^'".\n]+)/i)?.[1]?.trim() ??
      "Untitled PR";
    return call("github_open_pr", { title });
  }
  return undefined;
}

function routeHitl(user: string, toolNames: Set<string>): LlmResponse | undefined {
  if (!toolNames.has("confirm_action")) return undefined;
  if (!/\bconfirm\b/i.test(user)) return undefined;
  const named = user.match(/action\s+([\w.-]+)/i)?.[1] ?? "demo";
  return {
    content: "",
    finishReason: "tool_calls",
    toolCalls: [
      {
        id: createToolCallId(),
        name: "confirm_action",
        arguments: { action: named },
      },
    ],
  };
}

function routeMemory(user: string, toolNames: Set<string>): LlmResponse | undefined {
  const call = (name: string, args: Record<string, unknown>): LlmResponse => ({
    content: "",
    finishReason: "tool_calls",
    toolCalls: [{ id: createToolCallId(), name, arguments: args }],
  });

  if (toolNames.has("remember") && /\bremember\b/i.test(user)) {
    const prefer = user.match(
      /prefer\s+(\S+?)(?:\s+as(?:\s+the)?\s+(.+?))?[?.!]*$/i,
    );
    if (prefer?.[1]) {
      const value = prefer[1].replace(/[?.!,]+$/, "");
      const key = (prefer[2] ?? "preference")
        .trim()
        .replace(/[?.!]+$/, "")
        .replace(/\s+/g, "_");
      return call("remember", { kind: "preference", key, value });
    }
    const isPat = user.match(
      /remember(?:\s+that)?\s+(?:my\s+)?(.+?)\s+is\s+(.+?)[?.!]*$/i,
    );
    if (isPat?.[1] && isPat[2]) {
      return call("remember", {
        kind: "preference",
        key: isPat[1].trim().replace(/\s+/g, "_"),
        value: isPat[2].trim(),
      });
    }
    return call("remember", { kind: "task", key: "note", value: user.trim() });
  }

  if (
    toolNames.has("recall") &&
    (/\brecall\b/i.test(user) ||
      /what\s+(do\s+i|did\s+we|package\s+manager)\b/i.test(user) ||
      /package\s+manager\s+do\s+i\s+prefer/i.test(user))
  ) {
    const query = /package\s+manager/i.test(user) ? "package" : undefined;
    return call("recall", query ? { query } : {});
  }

  return undefined;
}

function routeFileAndShell(
  user: string,
  toolNames: Set<string>,
): LlmResponse | undefined {
  const call = (name: string, args: Record<string, unknown>): LlmResponse => ({
    content: "",
    finishReason: "tool_calls",
    toolCalls: [{ id: createToolCallId(), name, arguments: args }],
  });

  if (toolNames.has("search_codebase")) {
    const semantic =
      /\bwhere\s+is\b/i.test(user) ||
      /what does this (project|repo|codebase|code)\b/i.test(user) ||
      /\b(semantic search|search codebase|documentation assistant)\b/i.test(user);
    if (semantic) {
      return call("search_codebase", { query: user });
    }
  }

  if (toolNames.has("run_shell") && /\b(curl|wget|sudo|rm\s+-rf)\b/i.test(user)) {
    const exe = user.match(/\b(curl|wget|sudo)\b/i)?.[1]?.toLowerCase() ?? "curl";
    return call("run_shell", { argv: [exe, "https://example.invalid"] });
  }

  if (toolNames.has("run_shell") && /\brun\s+(pwd|ls)\b/i.test(user)) {
    const cmd = user.match(/\brun\s+(pwd|ls)\b/i)?.[1] ?? "pwd";
    return call("run_shell", { argv: cmd === "ls" ? ["ls", "-1"] : ["pwd"] });
  }

  if (toolNames.has("read_file")) {
    const readMatch = user.match(/read(?:\s+the)?\s+file\s+(.+?)[?.!]*$/i);
    if (readMatch?.[1]) {
      return call("read_file", { path: readMatch[1].trim().replace(/^["']|["']$/g, "") });
    }
  }

  if (toolNames.has("search_files")) {
    const searchMatch = user.match(/search(?:\s+files)?(?:\s+for)?\s+['"]?([\w.-]+)['"]?/i);
    if (/\bsearch\b/i.test(user) && searchMatch?.[1]) {
      return call("search_files", { query: searchMatch[1], path: "." });
    }
  }

  if (
    toolNames.has("list_dir") &&
    /\b(list|summarize|ls)\b/i.test(user) &&
    /\b(project|files|dir|directory|repo|workspace)\b/i.test(user)
  ) {
    return call("list_dir", { path: "." });
  }

  return undefined;
}

/**
 * Pull a math expression out of messy natural language.
 *
 * Examples:
 *   "What is (12 + 8) * 3?"  →  "(12+8)*3"
 *   "Calculate 100 / 4"      →  "100 / 4"
 *
 * Strategy (first match wins):
 *   1) parenthetical expression, optionally with a trailing operator+number
 *   2) text after "what is" / "calculate" / "compute"
 *   3) first run of digits and arithmetic characters
 */
function extractExpression(user: string): string {
  const paren = user.match(/\(([^)]+)\)/);
  if (paren?.[0] && /[+\-*/]/.test(paren[0])) {
    // Prefer full parenthetical expressions including outer ops: (12 + 8) * 3
    const extended = user.match(/\([^)]+\)(?:\s*[+\-*/]\s*\d+(?:\.\d+)?)*/);
    if (extended?.[0]) return extended[0].replace(/\s+/g, "");
  }

  const afterIs = user.match(/(?:what\s+is|calculate|compute)\s+(.+?)[?.!]*$/i);
  if (afterIs?.[1] && /[0-9+\-*/()]/.test(afterIs[1])) {
    return afterIs[1].trim().replace(/[?.!]+$/, "");
  }

  const raw = user.match(/[0-9+\-*/().\s]+/);
  return (raw?.[0] ?? user).trim();
}

/**
 * Convert a tool observation JSON string into a short final answer for the user.
 *
 * The agent loop stores tool results as JSON in message.content, roughly:
 *   { ok, summary, data, error }
 *
 * Heuristic brain responsibilities after a tool:
 *   - calculator → "The answer is 60."
 *   - weather    → reuse the tool's summary ("London: 18°C, ...")
 *   - failure    → surface the error clearly
 */
function formatFinalFromTool(content: string): string {
  try {
    const parsed = JSON.parse(content) as {
      ok?: boolean;
      summary?: string;
      data?: { result?: number; temperatureC?: number; location?: string };
      error?: string;
    };
    if (!parsed.ok) return `Tool failed: ${parsed.error ?? parsed.summary ?? "unknown error"}`;
    if (typeof parsed.data?.result === "number") {
      return `The answer is ${parsed.data.result}.`;
    }
    if (parsed.summary) return parsed.summary;
    return content;
  } catch {
    // If content wasn't JSON, just echo it — better than crashing the run.
    return content;
  }
}

// =============================================================================
// 2) OpenAI-compatible client — real models (OpenAI cloud OR local Ollama)
// =============================================================================

/**
 * Create an LlmClient that calls an OpenAI-style Chat Completions HTTP API.
 *
 * Why one function for both OpenAI and Ollama?
 *   Ollama exposes a compatible endpoint at http://127.0.0.1:11434/v1
 *   so the request/response shape is the same; only baseUrl/model/apiKey differ.
 *
 * Options:
 *   apiKey     — Bearer token (OpenAI requires a real key; Ollama often accepts any string)
 *   baseUrl    — e.g. https://api.openai.com/v1  or  http://127.0.0.1:11434/v1
 *   model      — e.g. gpt-4o-mini  or  llama3.2
 *   fetchImpl  — inject a fake fetch in tests (optional)
 */
export function createOpenAiCompatibleLlm(options: {
  apiKey?: string;
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
}): LlmClient {
  // Allow tests to pass a mock fetch; otherwise use the global Node/browser fetch.
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async complete({ messages, tools, signal }): Promise<LlmResponse> {
      /**
       * Request body fields (OpenAI Chat Completions):
       *   model        — which weights to use
       *   messages     — conversation in provider format (see toOpenAiMessages)
       *   tools        — function schemas the model may call
       *   tool_choice  — "auto" lets the model decide when to call tools
       *   temperature  — 0 = more deterministic (better for tool routing demos)
       */
      const body = {
        model: options.model,
        messages: toOpenAiMessages(messages),
        tools: tools.map(toOpenAiTool),
        tool_choice: "auto" as const,
        temperature: 0,
      };

      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      // Many gateways expect Authorization even for local Ollama; harmless if unused.
      if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;

      /**
       * POST /chat/completions
       * `signal` lets the agent loop cancel a hung request (AbortController).
       * strip trailing slash on baseUrl so we don't produce "//chat/completions".
       */
      const res = await fetchImpl(`${options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        // Include a short body snippet — enough to debug, not a huge dump.
        const text = await res.text();
        throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 400)}`);
      }

      /**
       * Typical successful shape (simplified):
       * {
       *   choices: [{
       *     message: {
       *       content: "..." | null,
       *       tool_calls: [{ id, function: { name, arguments: "<json string>" } }]
       *     }
       *   }]
       * }
       */
      const json = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
          finish_reason?: string;
        }>;
      };

      const choice = json.choices?.[0];
      const message = choice?.message;

      // Normalize provider tool_calls → our LlmToolCall shape used by the loop.
      const toolCalls = (message?.tool_calls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        // Providers send arguments as a JSON *string*; we parse to an object.
        arguments: safeParseArgs(tc.function.arguments),
      }));

      return {
        content: message?.content ?? undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        finishReason: toolCalls.length ? "tool_calls" : "stop",
      };
    },
  };
}

/**
 * Parse tool argument JSON safely.
 * Models sometimes return invalid JSON; never throw into the agent loop for that —
 * fall back to {} so policy/tools can still fail gracefully with clear errors.
 */
function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Convert our ToolSpec → OpenAI "tools" entry.
 *
 * The model never sees your TypeScript `execute` function.
 * It only sees name + description + JSON Schema parameters — that is the prompt
 * that teaches *when* and *how* to call the tool.
 */
function toOpenAiTool(tool: ToolSpec) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

/**
 * Convert our AgentMessage[] → provider chat messages.
 *
 * Special cases matter for multi-step tool use:
 *   - role "tool" must include tool_call_id (links result to the earlier request)
 *   - assistant turns that requested tools must replay tool_calls on the next request,
 *     otherwise many providers reject the conversation as invalid
 */
function toOpenAiMessages(messages: AgentMessage[]) {
  return messages.map((m) => {
    if (m.role === "tool") {
      return {
        role: "tool",
        content: m.content,
        tool_call_id: m.toolCallId ?? "unknown",
        name: m.name,
      };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            // Wire format requires arguments as a stringified JSON object.
            arguments: JSON.stringify(tc.arguments ?? {}),
          },
        })),
      };
    }
    // system | user | plain assistant text
    return { role: m.role, content: m.content };
  });
}

// =============================================================================
// 3) Factory from environment — what the CLI calls
// =============================================================================

/**
 * Supported values for LCA_PROVIDER in `.env` or the shell.
 *   heuristic — offline rules (default)
 *   ollama    — local OpenAI-compatible server
 *   openai    — hosted API
 */
export type ProviderName = "heuristic" | "ollama" | "openai";

/**
 * Read process.env (or a test double) and return the right LlmClient.
 *
 * This is the single switch the CLI uses:
 *   llm: createLlmFromEnv()
 *
 * Defaults favor learning/CI: missing LCA_PROVIDER → heuristic (no network).
 */
export function createLlmFromEnv(env: NodeJS.ProcessEnv = process.env): LlmClient {
  const provider = (env.LCA_PROVIDER ?? "heuristic") as ProviderName;

  if (provider === "heuristic") return createHeuristicLlm();

  if (provider === "ollama") {
    return createOpenAiCompatibleLlm({
      // Ollama's OpenAI-compatible base path
      baseUrl: env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1",
      model: env.OLLAMA_MODEL ?? "llama3.2",
      // Ollama often ignores the key; a placeholder keeps the header path consistent
      apiKey: env.OLLAMA_API_KEY ?? "ollama",
    });
  }

  if (provider === "openai") {
    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required when LCA_PROVIDER=openai");
    }
    return createOpenAiCompatibleLlm({
      baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      model: env.OPENAI_MODEL ?? "gpt-4o-mini",
      apiKey: env.OPENAI_API_KEY,
    });
  }

  // Typos like LCA_PROVIDER=ollamma should fail loudly, not silently fall through.
  throw new Error(`Unknown LCA_PROVIDER='${provider}'`);
}
