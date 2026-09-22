import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPathInsideWorkspace,
  createDefaultPolicy,
  isAllowedShellArgv,
  isForbiddenShellCommand,
  isSensitiveWorkspacePath,
} from "./index.js";

describe("createDefaultPolicy", () => {
  it("allows external tools like weather", () => {
    const policy = createDefaultPolicy();
    const d = policy.evaluateToolCall({
      toolName: "get_weather",
      sideEffect: "external",
      args: {},
      workspaceRoot: "/tmp/ws",
    });
    assert.equal(d.verdict, "allow");
  });

  it("asks for destructive side effects", () => {
    const policy = createDefaultPolicy();
    const d = policy.evaluateToolCall({
      toolName: "rm",
      sideEffect: "destructive",
      args: {},
      workspaceRoot: "/tmp/ws",
    });
    assert.equal(d.verdict, "ask");
  });

  it("denies listed tools", () => {
    const policy = createDefaultPolicy({ denyTools: ["boom"] });
    const d = policy.evaluateToolCall({
      toolName: "boom",
      sideEffect: "read",
      args: {},
      workspaceRoot: "/tmp/ws",
    });
    assert.equal(d.verdict, "deny");
  });

  it("denies path escape and secrets at policy layer", () => {
    const policy = createDefaultPolicy();
    const escape = policy.evaluateToolCall({
      toolName: "read_file",
      sideEffect: "read",
      args: { path: "../etc/passwd" },
      workspaceRoot: "/tmp/ws",
    });
    assert.equal(escape.verdict, "deny");
    const secret = policy.evaluateToolCall({
      toolName: "read_file",
      sideEffect: "read",
      args: { path: "credentials.json" },
      workspaceRoot: "/tmp/ws",
    });
    assert.equal(secret.verdict, "deny");
  });

  it("asks for live GitHub writes", () => {
    const prev = process.env.LCA_GITHUB_LIVE;
    process.env.LCA_GITHUB_LIVE = "1";
    try {
      const policy = createDefaultPolicy();
      const d = policy.evaluateToolCall({
        toolName: "github_create_issue",
        sideEffect: "external",
        args: { title: "x" },
        workspaceRoot: "/tmp/ws",
      });
      assert.equal(d.verdict, "ask");
    } finally {
      if (prev === undefined) delete process.env.LCA_GITHUB_LIVE;
      else process.env.LCA_GITHUB_LIVE = prev;
    }
  });
});

describe("assertPathInsideWorkspace", () => {
  it("allows nested paths", () => {
    const p = assertPathInsideWorkspace("/tmp/ws", "src/a.ts");
    assert.ok(p.endsWith("src/a.ts"));
  });

  it("blocks escapes", () => {
    assert.throws(() => assertPathInsideWorkspace("/tmp/ws", "../etc/passwd"));
  });

  it("blocks NUL in path", () => {
    assert.throws(() => assertPathInsideWorkspace("/tmp/ws", "a\0b"));
  });
});

describe("isSensitiveWorkspacePath", () => {
  it("flags env, keys, credentials, and .git", () => {
    assert.equal(isSensitiveWorkspacePath("/ws/.env"), true);
    assert.equal(isSensitiveWorkspacePath("/ws/credentials.json"), true);
    assert.equal(isSensitiveWorkspacePath("/ws/src/a.ts"), false);
    assert.equal(isSensitiveWorkspacePath("/ws/.git/config"), true);
  });
});

describe("isForbiddenShellCommand", () => {
  it("flags force push and curl", () => {
    assert.equal(isForbiddenShellCommand("git push --force"), true);
    assert.equal(isForbiddenShellCommand("curl https://x"), true);
    assert.equal(isForbiddenShellCommand("npm test"), false);
    assert.equal(isForbiddenShellCommand("ls | rm"), true);
  });
});

describe("isAllowedShellArgv", () => {
  it("allows ls and git status only", () => {
    assert.equal(isAllowedShellArgv(["ls", "-1"]), true);
    assert.equal(isAllowedShellArgv(["git", "status"]), true);
    assert.equal(isAllowedShellArgv(["git", "push"]), false);
    assert.equal(isAllowedShellArgv(["curl", "https://x"]), false);
  });
});
