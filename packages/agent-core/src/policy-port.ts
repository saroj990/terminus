import type { PolicyDecision, SideEffectClass } from "./types.js";

export interface PolicyEvalInput {
  toolName: string;
  sideEffect: SideEffectClass;
  args: Record<string, unknown>;
  workspaceRoot: string;
}

export interface PolicyEngine {
  evaluateToolCall(input: PolicyEvalInput): PolicyDecision;
}
