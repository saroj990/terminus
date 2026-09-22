import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { cosine, embed, indexWorkspace, searchChunks } from "./index.js";

describe("embed", () => {
  it("ranks a related query above an unrelated one", () => {
    const doc = embed("function greet(name) { return hello }");
    const near = cosine(doc, embed("where is greet defined"));
    const far = cosine(doc, embed("kubernetes rollback docker"));
    assert.ok(near > far, `near=${near} far=${far}`);
  });
});

describe("indexWorkspace", () => {
  it("indexes tiny files and retrieves greet", () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "lca-rag-")));
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "index.js"), "export function greet(name) {\n  return name;\n}\n");
    fs.writeFileSync(path.join(root, "README.md"), "# demo\nFixture for greet.\n");
    fs.writeFileSync(path.join(root, "credentials.json"), "{\"token\":\"x\"}");

    const chunks = indexWorkspace(root);
    assert.ok(chunks.some((c) => c.path.includes("index.js")));
    assert.ok(!chunks.some((c) => c.path.includes("credentials")));

    const hits = searchChunks(chunks, "where is greet defined", 3);
    assert.ok(
      hits.some((h) => h.path.includes("index.js")),
      JSON.stringify(hits),
    );
  });
});
