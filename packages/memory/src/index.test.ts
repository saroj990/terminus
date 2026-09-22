import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  formatMemoryPrompt,
  looksLikeSecret,
  queryMemory,
  upsertMemory,
} from "./index.js";

describe("memory store", () => {
  it("persists prefs and rejects secrets", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lca-mem-"));
    upsertMemory(root, { kind: "preference", key: "package_manager", value: "pnpm" });
    const hit = queryMemory(root, "pnpm");
    assert.equal(hit[0]?.value, "pnpm");
    assert.match(formatMemoryPrompt(hit), /pnpm/);

    assert.throws(() =>
      upsertMemory(root, { kind: "preference", key: "openai_api_key", value: "sk-abc" }),
    );
    assert.equal(looksLikeSecret("sk-live-123"), true);
  });
});
