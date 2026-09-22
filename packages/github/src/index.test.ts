import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createIssue,
  isGithubDryRun,
  openPullRequest,
  parseGithubSlugFromRemote,
  reviewRecentCommits,
  type ExecFn,
} from "./index.js";

describe("github client", () => {
  it("parses remote slugs", () => {
    assert.equal(parseGithubSlugFromRemote("git@github.com:acme/app.git"), "acme/app");
    assert.equal(parseGithubSlugFromRemote("https://github.com/acme/app.git"), "acme/app");
  });

  it("dry-runs issue and PR by default", async () => {
    assert.equal(isGithubDryRun({} as NodeJS.ProcessEnv), true);
    const exec: ExecFn = async () => ({
      code: 0,
      stdout: "git@github.com:acme/demo.git\n",
      stderr: "",
    });
    const issue = await createIssue("/tmp", { title: "Bug" }, { exec, live: false });
    assert.equal(issue.dryRun, true);
    assert.equal(issue.repo, "acme/demo");

    const pr = await openPullRequest(
      "/tmp",
      { title: "Fix bug", head: "fix", base: "main" },
      { exec, live: false },
    );
    assert.equal(pr.dryRun, true);
    assert.match(pr.head, /fix/);
  });

  it("summarizes commits from git log", async () => {
    const exec: ExecFn = async (argv) => {
      if (argv[0] === "git" && argv[1] === "remote") {
        return { code: 0, stdout: "https://github.com/acme/demo.git\n", stderr: "" };
      }
      if (argv[0] === "git" && argv[1] === "log") {
        return { code: 0, stdout: "abc1234 Fix login\n", stderr: "" };
      }
      if (argv[0] === "git" && argv[1] === "diff") {
        return { code: 0, stdout: " README.md | 2 +-\n", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "unexpected" };
    };
    const review = await reviewRecentCommits("/tmp", 3, exec);
    assert.equal(review.commits[0]?.subject, "Fix login");
  });
});
