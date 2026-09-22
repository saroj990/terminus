import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createRunWorkspaceTestsTool } from "./coding.js";

describe("run_workspace_tests", () => {
  it("runs npm test in a tiny package", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lca-coding-"));
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ scripts: { test: "node -e \"process.exit(0)\"" } }),
    );
    const tool = createRunWorkspaceTestsTool();
    const result = await tool.execute({}, { runId: "t", workspaceRoot: root });
    assert.equal(result.ok, true, result.summary);
  });
});
