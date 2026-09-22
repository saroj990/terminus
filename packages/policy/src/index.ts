import type { PolicyDecision, PolicyEngine, PolicyEvalInput, SideEffectClass } from "@lca/agent-core";
import fs from "node:fs";
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

const SENSITIVE_BASENAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "credentials.json",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
]);

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

      if (
        (input.toolName === "read_file" ||
          input.toolName === "list_dir" ||
          input.toolName === "search_files") &&
        typeof input.args.path === "string"
      ) {
        try {
          const resolved = assertPathInsideWorkspace(input.workspaceRoot, input.args.path);
          if (isSensitiveWorkspacePath(resolved)) {
            return {
              verdict: "deny",
              reason: `Refused sensitive path: ${path.basename(resolved)}`,
              ruleId: "deny_sensitive_path",
            };
          }
        } catch (err) {
          return {
            verdict: "deny",
            reason: err instanceof Error ? err.message : String(err),
            ruleId: "deny_path_escape",
          };
        }
      }

      if (input.toolName === "run_shell") {
        const argv = input.args.argv;
        if (!Array.isArray(argv) || !isAllowedShellArgv(argv.map(String))) {
          return {
            verdict: "deny",
            reason: "Command not allowed",
            ruleId: "deny_shell_allowlist",
          };
        }
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

function realExisting(p: string): string {
  return fs.existsSync(p) ? fs.realpathSync.native(p) : path.resolve(p);
}

/**
 * Resolve a user path and ensure it stays under workspaceRoot.
 * Blocks `..` escapes, absolute targets outside the root, NUL bytes,
 * and symlink jumps that resolve outside the workspace.
 */
export function assertPathInsideWorkspace(workspaceRoot: string, userPath: string): string {
  if (typeof userPath !== "string" || userPath.length === 0) {
    throw new Error("Path is required");
  }
  if (userPath.includes("\0")) {
    throw new Error("Path escape blocked: NUL byte in path");
  }

  const root = realExisting(path.resolve(workspaceRoot));
  const resolved = path.resolve(root, userPath);
  const candidate = realExisting(resolved);
  const rel = path.relative(root, candidate);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escape blocked: '${userPath}' is outside workspace`);
  }
  return candidate;
}

/** True for env files, keys, credential dumps, and anything under `.git/`. */
export function isSensitiveWorkspacePath(resolvedPath: string): boolean {
  const base = path.basename(resolvedPath).toLowerCase();
  if (SENSITIVE_BASENAMES.has(base)) return true;
  if (base.endsWith(".pem") || base.endsWith(".key")) return true;
  const parts = resolvedPath.split(path.sep);
  if (parts.includes(".git")) return true;
  return false;
}

const FORBIDDEN_SHELL = [
  /\bsudo\b/i,
  /\brm\s+-rf\b/i,
  /\bmkfs\b/i,
  /\bdd\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bssh\b/i,
  /\bnc\b/i,
  /\bnmap\b/i,
  /\bchmod\s+777\b/i,
  /git\s+push\s+.*--force/i,
  /git\s+push\s+-f\b/i,
  /git\s+reset\s+--hard/i,
  /\beval\b/i,
  /\bexec\b/i,
  /[;&|`$]/,
  /\n/,
];

export function isForbiddenShellCommand(command: string): boolean {
  return FORBIDDEN_SHELL.some((re) => re.test(command));
}

/** First argv token (basename) allowed for run_shell. */
export const SHELL_ALLOWLIST = new Set(["ls", "pwd", "node", "pnpm", "npm", "git"]);

export function isAllowedShellArgv(argv: string[]): boolean {
  if (!argv.length) return false;
  const exe = path.basename(argv[0] ?? "");
  if (!SHELL_ALLOWLIST.has(exe)) return false;
  if (exe === "git") {
    const sub = argv[1] ?? "";
    const gitOk = new Set(["status", "diff", "log", "rev-parse"]);
    if (!gitOk.has(sub)) return false;
  }
  const joined = argv.join(" ");
  if (isForbiddenShellCommand(joined)) return false;
  return true;
}
