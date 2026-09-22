import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createConfirmActionTool } from "./confirm.js";

describe("confirm_action", () => {
  it("writes a marker file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lca-hitl-"));
    const tool = createConfirmActionTool();
    const result = await tool.execute(
      { action: "demo" },
      { runId: "t", workspaceRoot: root },
    );
    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(path.join(root, ".lca", "hitl-marker.json")), true);
  });
});
