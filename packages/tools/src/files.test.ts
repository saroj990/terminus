import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { createListDirTool, createReadFileTool, createSearchFilesTool } from "./files.js";
import { createRunShellTool } from "./shell.js";

function ctx(root: string) {
  return { runId: "t", workspaceRoot: fs.realpathSync.native(root) };
}

describe("file tools security", () => {
  it("reads a workspace file and blocks escape + secrets", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lca-files-"));
    fs.writeFileSync(path.join(root, "ok.txt"), "hello-agent");
    fs.writeFileSync(path.join(root, "credentials.json"), "{\"token\":\"x\"}");

    const read = createReadFileTool();
    const ok = await read.execute({ path: "ok.txt" }, ctx(root));
    assert.equal(ok.ok, true);
    assert.match(String((ok.data as { content?: string }).content), /hello-agent/);

    const escape = await read.execute({ path: "../etc/passwd" }, ctx(root));
    assert.equal(escape.ok, false);
    assert.match(String(escape.error), /Path escape/);

    const secret = await read.execute({ path: "credentials.json" }, ctx(root));
    assert.equal(secret.ok, false);
    assert.match(String(secret.error), /sensitive/i);
  });

  it("lists and searches without leaving the workspace", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lca-list-"));
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "app.js"), "function greet() {}");

    const list = createListDirTool();
    const listed = await list.execute({ path: "." }, ctx(root));
    assert.equal(listed.ok, true, listed.error);
    const names = ((listed.data as { entries?: Array<{ name: string }> })?.entries ?? []).map(
      (e) => e.name,
    );
    assert.ok(names.includes("src"), `entries=${JSON.stringify(names)} summary=${listed.summary}`);

    const search = createSearchFilesTool();
    const found = await search.execute({ query: "greet" }, ctx(root));
    assert.equal(found.ok, true);
    assert.ok((found.data as { hitCount: number }).hitCount >= 1);
  });
});

describe("run_shell security", () => {
  it("runs pwd and denies curl", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lca-sh-"));
    const sh = createRunShellTool();
    const pwd = await sh.execute({ argv: ["pwd"] }, ctx(root));
    assert.equal(pwd.ok, true, pwd.error);
    const out = String((pwd.data as { stdout?: string }).stdout);
    const real = fs.realpathSync.native(root);
    assert.ok(out.includes(real) || out.includes(root), out);

    const curl = await sh.execute({ argv: ["curl", "https://x"] }, ctx(root));
    assert.equal(curl.ok, false);
    assert.match(String(curl.error), /not allowed/i);
  });
});
