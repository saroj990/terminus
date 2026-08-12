/**
 * Core contracts for the Local Coding Agent platform.
 * These types are the stable spine — tools, policy, RAG, and UI all depend on them.
 */

export type SideEffectClass =
  | "read"
  | "write"
  | "exec"
  | "external"
  | "destructive";

export type RunStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled";

export type PolicyVerdict = "allow" | "deny" | "ask";

export interface JsonSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export interface ToolSpec {
  name: string;
  description: string;
  sideEffect: SideEffectClass;
  inputSchema: JsonSchema;
  /** Soft token budget for observation returned to the model */
  maxObservationTokens?: number;
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  runId: string;
  workspaceRoot: string;
  signal?: AbortSignal;
}

export interface ToolResult {
  ok: boolean;
  /** Structured payload for the agent loop */
  data?: unknown;
  /** Human-readable summary (prefer over dumping raw data into context) */
  summary: string;
  error?: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Observation {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  summary: string;
  data?: unknown;
  error?: string;
  durationMs: number;
  policy: PolicyDecision;
}

export interface PolicyDecision {
  verdict: PolicyVerdict;
  reason: string;
  ruleId?: string;
}

export interface AgentStep {
  index: number;
  thought?: string;
  toolCalls: ToolCallRequest[];
  observations: Observation[];
  startedAt: string;
  finishedAt?: string;
}

export interface AgentRun {
  id: string;
  goal: string;
  status: RunStatus;
  steps: AgentStep[];
  finalAnswer?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
  /** Present on assistant turns that requested tools */
  toolCalls?: LlmToolCall[];
}

export interface LlmResponse {
  content?: string;
  toolCalls?: LlmToolCall[];
  finishReason?: "stop" | "tool_calls" | "length" | "error";
}

export interface LlmClient {
  complete(input: {
    messages: AgentMessage[];
    tools: ToolSpec[];
    signal?: AbortSignal;
  }): Promise<LlmResponse>;
}

export interface ContextBudget {
  plannerMaxTokens: number;
  retrievalMaxTokens: number;
  openFilesMaxTokens: number;
  observationMaxTokens: number;
  totalPromptCeiling: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  plannerMaxTokens: 2000,
  retrievalMaxTokens: 6000,
  openFilesMaxTokens: 12000,
  observationMaxTokens: 4000,
  totalPromptCeiling: 24000,
};

export function createRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createToolCallId(): string {
  return `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createAgentRun(goal: string, metadata?: Record<string, unknown>): AgentRun {
  const ts = nowIso();
  return {
    id: createRunId(),
    goal,
    status: "pending",
    steps: [],
    createdAt: ts,
    updatedAt: ts,
    metadata,
  };
}
