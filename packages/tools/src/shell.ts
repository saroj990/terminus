import type { ToolSpec } from "@lca/agent-core";
import { isAllowedShellArgv, isForbiddenShellCommand } from "@lca/policy";
import { spawn } from "node:child_process";
import path from "node:path";

const TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 8_192;

/**
 * Constrained subprocess runner: argv only (no /bin/sh), allowlisted binaries,
 * cwd = workspace, timeout, truncated output, stripped env.
 */
export function createRunShellTool(): ToolSpec {
  return {
    name: "run_shell",
    description:
      "Run an allowlisted program in the workspace (argv array, not a shell string). Allowed: ls, pwd, node, pnpm, npm, git status|diff|log|rev-parse. No pipes, redirection, or network tools.",
    sideEffect: "exec",
    inputSchema: {
      type: "object",
      properties: {
        argv: {
          type: "array",
          items: { type: "string" },
          description: "Program and arguments, e.g. [\"ls\", \"-1\"] or [\"pnpm\", \"test\"]",
        },
      },
      required: ["argv"],
      additionalProperties: false,
    },
    maxObservationTokens: 800,
    async execute(input, ctx) {
      const raw = input.argv;
      if (!Array.isArray(raw) || raw.length === 0 || raw.some((a) => typeof a !== "string")) {
        return {
          ok: false,
          error: "argv must be a non-empty string array",
          summary: "run_shell rejected: invalid argv",
        };
      }
      const argv = raw.map((a) => a.trim()).filter((a) => a.length > 0);
      if (argv.some((a) => a.includes("\0"))) {
        return {
          ok: false,
          error: "NUL byte in argv",
          summary: "run_shell rejected: invalid argv",
        };
      }

      const joined = argv.join(" ");
      if (isForbiddenShellCommand(joined) || !isAllowedShellArgv(argv)) {
        return {
          ok: false,
          error: `Command not allowed: ${joined}`,
          summary: `run_shell denied: ${joined}`,
        };
      }

      const exe = argv[0] as string;
      const args = argv.slice(1);
      const cwd = path.resolve(ctx.workspaceRoot);

      try {
        const { stdout, stderr, code } = await spawnCapture(exe, args, cwd, ctx.signal);
        const ok = code === 0;
        return {
          ok,
          data: { argv, code, stdout, stderr },
          summary: ok
            ? `ran ${joined} (exit 0)`
            : `ran ${joined} (exit ${code})`,
          error: ok ? undefined : `exit ${code}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: message,
          summary: `run_shell failed: ${message}`,
        };
      }
    },
  };
}

function spawnCapture(
  exe: string,
  args: string[],
  cwd: string,
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
      reject(new Error(`Timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

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
