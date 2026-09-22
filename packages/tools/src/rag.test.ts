import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createSearchCodebaseTool } from "./rag.js";

describe("search_codebase", () => {
  it("returns greet from src and skips credentials", async () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "lca-ragtool-")));
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(
      path.join(root, "src", "index.js"),
      "export function greet(name) { return name; }\n",
    );
    fs.writeFileSync(path.join(root, "credentials.json"), "{\"token\":\"nope\"}");

    const tool = createSearchCodebaseTool();
    const result = await tool.execute(
      { query: "where is greet defined" },
      { runId: "t", workspaceRoot: root },
    );
    assert.equal(result.ok, true);
    const hits = (result.data as { hits: Array<{ path: string }> }).hits;
    assert.ok(hits.some((h) => h.path.includes("index.js")));
    assert.ok(!hits.some((h) => h.path.includes("credentials")));
  });
});
