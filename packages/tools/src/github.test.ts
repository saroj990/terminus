import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createGithubCreateIssueTool,
  createGithubOpenPrTool,
  createGithubReviewCommitsTool,
} from "./github.js";
import type { ExecFn } from "@lca/github";

const mockExec: ExecFn = async (argv) => {
  if (argv[0] === "git" && argv[1] === "remote") {
    return { code: 0, stdout: "https://github.com/acme/app.git\n", stderr: "" };
  }
  if (argv[0] === "git" && argv[1] === "log") {
    return { code: 0, stdout: "deadbeef Add github tools\n", stderr: "" };
  }
  if (argv[0] === "git" && argv[1] === "diff") {
    return { code: 0, stdout: " 1 file changed\n", stderr: "" };
  }
  return { code: 1, stdout: "", stderr: "unexpected" };
};

describe("github tools", () => {
  it("dry-runs issue creation", async () => {
    const tool = createGithubCreateIssueTool({ exec: mockExec });
    const result = await tool.execute(
      { title: "Bug in login" },
      { runId: "t", workspaceRoot: "/tmp" },
    );
    assert.equal(result.ok, true);
    assert.match(result.summary, /DRY RUN/i);
    assert.match(result.summary, /Bug in login/);
  });

  it("reviews commits read-only", async () => {
    const tool = createGithubReviewCommitsTool({ exec: mockExec });
    const result = await tool.execute({ limit: 3 }, { runId: "t", workspaceRoot: "/tmp" });
    assert.equal(result.ok, true);
    assert.match(result.summary, /deadbeef/);
  });

  it("dry-runs open pr", async () => {
    const tool = createGithubOpenPrTool({ exec: mockExec });
    const result = await tool.execute(
      { title: "Fix login", head: "fix-login" },
      { runId: "t", workspaceRoot: "/tmp" },
    );
    assert.equal(result.ok, true);
    assert.match(result.summary, /DRY RUN/i);
  });
});
