import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAgentRun, runAgentLoop, type LlmClient, type ToolSpec } from "./index.js";
import type { PolicyEngine } from "./policy-port.js";

describe("runAgentLoop", () => {
  it("executes a tool then returns final answer", async () => {
    let turn = 0;
    const llm: LlmClient = {
      async complete() {
        turn += 1;
        if (turn === 1) {
          return {
            finishReason: "tool_calls",
            toolCalls: [{ id: "c1", name: "echo", arguments: { text: "hi" } }],
          };
        }
        return { content: "done: hi", finishReason: "stop" };
      },
    };

    const tools: ToolSpec[] = [
      {
        name: "echo",
        description: "echo",
        sideEffect: "read",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
        async execute(input) {
          return { ok: true, summary: String(input.text), data: input };
        },
      },
    ];

    const policy: PolicyEngine = {
      evaluateToolCall: () => ({ verdict: "allow", reason: "test" }),
    };

    const run = createAgentRun("say hi");
    const result = await runAgentLoop(run, { llm, tools, policy });
    assert.equal(result.status, "succeeded");
    assert.equal(result.finalAnswer, "done: hi");
    assert.equal(result.steps[0]?.observations[0]?.ok, true);
  });

  it("respects policy deny", async () => {
    const llm: LlmClient = {
      async complete({ messages }) {
        const last = messages[messages.length - 1];
        if (last?.role === "tool") {
          return { content: "blocked", finishReason: "stop" };
        }
        return {
          finishReason: "tool_calls",
          toolCalls: [{ id: "c1", name: "boom", arguments: {} }],
        };
      },
    };

    const tools: ToolSpec[] = [
      {
        name: "boom",
        description: "boom",
        sideEffect: "destructive",
        inputSchema: { type: "object" },
        async execute() {
          return { ok: true, summary: "should not run" };
        },
      },
    ];

    const policy: PolicyEngine = {
      evaluateToolCall: () => ({
        verdict: "deny",
        reason: "nope",
        ruleId: "test",
      }),
    };

    const run = createAgentRun("explode");
    const result = await runAgentLoop(run, { llm, tools, policy });
    assert.equal(result.status, "succeeded");
    assert.equal(result.steps[0]?.observations[0]?.ok, false);
    assert.equal(result.steps[0]?.observations[0]?.policy.verdict, "deny");
  });

  it("injects extraSystem into the system prompt", async () => {
    let seen = "";
    const llm: LlmClient = {
      async complete({ messages }) {
        seen = messages[0]?.content ?? "";
        return { content: "ok", finishReason: "stop" };
      },
    };
    const policy: PolicyEngine = {
      evaluateToolCall: () => ({ verdict: "allow", reason: "test" }),
    };
    const run = createAgentRun("hi");
    await runAgentLoop(
      run,
      { llm, tools: [], policy },
      { extraSystem: "Known user/project memory:\n- [preference] package_manager: pnpm" },
    );
    assert.match(seen, /package_manager: pnpm/);
  });
});
