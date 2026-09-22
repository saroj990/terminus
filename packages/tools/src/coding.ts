import type { ToolSpec } from "@lca/agent-core";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const TEST_TIMEOUT_MS = 60_000;
const LINT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 12_288;

function spawnCapture(
  exe: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd,
      shell: false,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME ?? "",
        LANG: process.env.LANG ?? "C",
      },
      signal,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outBytes = 0;
    const onChunk = (chunks: Buffer[], buf: Buffer) => {
      outBytes += buf.length;
      if (outBytes <= MAX_OUTPUT_BYTES) chunks.push(buf);
    };
    child.stdout?.on("data", (b: Buffer) => onChunk(out, b));
    child.stderr?.on("data", (b: Buffer) => onChunk(err, b));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(out).toString("utf8").slice(0, MAX_OUTPUT_BYTES),
        stderr: Buffer.concat(err).toString("utf8").slice(0, MAX_OUTPUT_BYTES),
        code: code ?? 1,
      });
    });
  });
}

function hasScript(workspaceRoot: string, name: string): boolean {
  const pkg = path.join(workspaceRoot, "package.json");
  if (!fs.existsSync(pkg)) return false;
  try {
    const scripts = (JSON.parse(fs.readFileSync(pkg, "utf8")) as { scripts?: Record<string, string> })
      .scripts;
    return Boolean(scripts?.[name]);
  } catch {
    return false;
  }
}

export function createRunWorkspaceTestsTool(): ToolSpec {
  return {
    name: "run_workspace_tests",
    description:
      "Run the workspace test script (pnpm test, or npm test). Use after code changes to validate.",
    sideEffect: "exec",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    maxObservationTokens: 1200,
    async execute(_input, ctx) {
      const cwd = path.resolve(ctx.workspaceRoot);
      const usePnpm = fs.existsSync(path.join(cwd, "pnpm-lock.yaml"));
      const argv = usePnpm ? ["pnpm", "test"] : ["npm", "test"];
      if (!hasScript(cwd, "test")) {
        return {
          ok: false,
          error: "No test script in package.json",
          summary: "run_workspace_tests: missing test script",
        };
      }
      try {
        const { stdout, stderr, code } = await spawnCapture(
          argv[0] as string,
          argv.slice(1),
          cwd,
          TEST_TIMEOUT_MS,
          ctx.signal,
        );
        const ok = code === 0;
        const tail = (stdout || stderr).trim().slice(-400);
        return {
          ok,
          data: { code, stdout, stderr },
          summary: ok ? `Tests passed (exit 0). ${tail}` : `Tests failed (exit ${code}). ${tail}`,
          error: ok ? undefined : `exit ${code}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, summary: `run_workspace_tests failed: ${message}` };
      }
    },
  };
}

export function createRunWorkspaceLintTool(): ToolSpec {
  return {
    name: "run_workspace_lint",
    description:
      "Run workspace lint/typecheck (pnpm run typecheck, or lint, or npm equivalent). Read-only on repo except tool cache.",
    sideEffect: "exec",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    maxObservationTokens: 1200,
    async execute(_input, ctx) {
      const cwd = path.resolve(ctx.workspaceRoot);
      const usePnpm = fs.existsSync(path.join(cwd, "pnpm-lock.yaml"));
      const script = hasScript(cwd, "typecheck")
        ? "typecheck"
        : hasScript(cwd, "lint")
          ? "lint"
          : undefined;
      if (!script) {
        return {
          ok: false,
          error: "No typecheck or lint script in package.json",
          summary: "run_workspace_lint: no typecheck/lint script",
        };
      }
      const argv = usePnpm ? ["pnpm", "run", script] : ["npm", "run", script];
      try {
        const { stdout, stderr, code } = await spawnCapture(
          argv[0] as string,
          argv.slice(1),
          cwd,
          LINT_TIMEOUT_MS,
          ctx.signal,
        );
        const ok = code === 0;
        const tail = (stdout || stderr).trim().slice(-400);
        return {
          ok,
          data: { script, code, stdout, stderr },
          summary: ok
            ? `${script} passed (exit 0). ${tail}`
            : `${script} failed (exit ${code}). ${tail}`,
          error: ok ? undefined : `exit ${code}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, summary: `run_workspace_lint failed: ${message}` };
      }
    },
  };
}
