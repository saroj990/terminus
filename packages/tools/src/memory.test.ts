import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createRecallTool, createRememberTool } from "./memory.js";

describe("memory tools", () => {
  it("stores a preference and recalls it", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lca-mem-tool-"));
    const ctx = { runId: "t", workspaceRoot: root };
    const remember = createRememberTool();
    const stored = await remember.execute(
      { kind: "preference", key: "package_manager", value: "pnpm" },
      ctx,
    );
    assert.equal(stored.ok, true);

    const recall = createRecallTool();
    const found = await recall.execute({ query: "pnpm" }, ctx);
    assert.equal(found.ok, true);
    assert.match(found.summary, /pnpm/);
  });

  it("refuses secret-like values", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lca-mem-secret-"));
    const remember = createRememberTool();
    const result = await remember.execute(
      { kind: "preference", key: "openai_api_key", value: "sk-abc" },
      { runId: "t", workspaceRoot: root },
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /secret/i);
  });
});
