import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertPathInsideWorkspace, createDefaultPolicy, isForbiddenShellCommand } from "./index.js";

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
});

describe("assertPathInsideWorkspace", () => {
  it("allows nested paths", () => {
    const p = assertPathInsideWorkspace("/tmp/ws", "src/a.ts");
    assert.ok(p.endsWith("src/a.ts"));
  });

  it("blocks escapes", () => {
    assert.throws(() => assertPathInsideWorkspace("/tmp/ws", "../etc/passwd"));
  });
});

describe("isForbiddenShellCommand", () => {
  it("flags force push and curl", () => {
    assert.equal(isForbiddenShellCommand("git push --force"), true);
    assert.equal(isForbiddenShellCommand("curl https://x"), true);
    assert.equal(isForbiddenShellCommand("npm test"), false);
  });
});
