import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  createAgentRun,
  runOrchestrated,
  type LlmClient,
  type ToolSpec,
} from "./index.js";
import type { PolicyEngine } from "./policy-port.js";

describe("runOrchestrated", () => {
  it("retries once when the first execute throws", async () => {
    let n = 0;
    const llm: LlmClient = {
      async complete() {
        n += 1;
        if (n === 1) throw new Error("transient");
        return { content: "recovered", finishReason: "stop" };
      },
    };
    const policy: PolicyEngine = {
      evaluateToolCall: () => ({ verdict: "allow", reason: "test" }),
    };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lca-orch-"));
    const run = createAgentRun("say hi");
    const result = await runOrchestrated(run, { llm, tools: [], policy }, { workspaceRoot: root });
    assert.equal(result.status, "succeeded");
    assert.equal(result.finalAnswer, "recovered");
    assert.equal(n, 2);
    assert.equal(fs.existsSync(path.join(root, ".lca", "runs", "LATEST")), true);
  });
});
