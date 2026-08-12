import type { PolicyDecision, PolicyEngine, PolicyEvalInput, SideEffectClass } from "@lca/agent-core";
import path from "node:path";

export interface DefaultPolicyOptions {
  /** Tools that are always denied */
  denyTools?: string[];
  /** Side effects that require human approval */
  askSideEffects?: SideEffectClass[];
  /** Side effects that are auto-allowed when tool is known */
  allowSideEffects?: SideEffectClass[];
}

const DEFAULT_ASK: SideEffectClass[] = ["destructive"];
const DEFAULT_ALLOW: SideEffectClass[] = ["read", "write", "exec", "external"];

/**
 * Phase 0/1 policy: allow read/external tools used by demos;
 * deny unknown + destructive; ask for destructive class.
 * Path-jail helpers are exported for Phase 2 terminal/file tools.
 */
export function createDefaultPolicy(options: DefaultPolicyOptions = {}): PolicyEngine {
  const denyTools = new Set(options.denyTools ?? []);
  const askSideEffects = new Set(options.askSideEffects ?? DEFAULT_ASK);
  const allowSideEffects = new Set(options.allowSideEffects ?? DEFAULT_ALLOW);

  return {
    evaluateToolCall(input: PolicyEvalInput): PolicyDecision {
      if (denyTools.has(input.toolName)) {
        return {
          verdict: "deny",
          reason: `Tool '${input.toolName}' is on the deny list`,
          ruleId: "deny_tool_list",
        };
      }

      if (askSideEffects.has(input.sideEffect)) {
        return {
          verdict: "ask",
          reason: `Side-effect '${input.sideEffect}' requires human approval`,
          ruleId: "ask_side_effect",
        };
      }

      if (allowSideEffects.has(input.sideEffect)) {
        return {
          verdict: "allow",
          reason: `Side-effect '${input.sideEffect}' is allowed`,
          ruleId: "allow_side_effect",
        };
      }

      return {
        verdict: "deny",
        reason: `Side-effect '${input.sideEffect}' is not permitted`,
        ruleId: "deny_unknown_side_effect",
      };
    },
  };
}

/** Resolve a user path and ensure it stays under workspaceRoot. */
export function assertPathInsideWorkspace(workspaceRoot: string, userPath: string): string {
  const root = path.resolve(workspaceRoot);
  const resolved = path.resolve(root, userPath);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escape blocked: '${userPath}' is outside workspace`);
  }
  return resolved;
}

const FORBIDDEN_SHELL = [
  /\bsudo\b/i,
  /\brm\s+-rf\s+\/\b/i,
  /\bmkfs\b/i,
  /\bdd\b.*\bif=/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bssh\b/i,
  /git\s+push\s+.*--force/i,
  /git\s+push\s+-f\b/i,
];

export function isForbiddenShellCommand(command: string): boolean {
  return FORBIDDEN_SHELL.some((re) => re.test(command));
}
