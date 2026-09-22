import type { ToolSpec } from "@lca/agent-core";
import {
  createIssue,
  openPullRequest,
  reviewRecentCommits,
  type ExecFn,
} from "@lca/github";

export function createGithubCreateIssueTool(options?: { exec?: ExecFn }): ToolSpec {
  return {
    name: "github_create_issue",
    description:
      "Create a GitHub issue (dry-run by default). Set LCA_GITHUB_LIVE=1 and approve to create for real.",
    sideEffect: "external",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["title"],
      additionalProperties: false,
    },
    maxObservationTokens: 400,
    async execute(input, ctx) {
      try {
        const result = await createIssue(ctx.workspaceRoot, {
          title: String(input.title ?? ""),
          body: typeof input.body === "string" ? input.body : "",
        }, { exec: options?.exec });
        if (result.dryRun) {
          return {
            ok: true,
            data: result,
            summary: `DRY RUN: would create issue '${result.title}' in ${result.repo}`,
          };
        }
        return {
          ok: true,
          data: result,
          summary: `Created issue: ${result.url ?? result.title}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, summary: `github_create_issue failed: ${message}` };
      }
    },
  };
}

export function createGithubOpenPrTool(options?: { exec?: ExecFn }): ToolSpec {
  return {
    name: "github_open_pr",
    description:
      "Open a GitHub pull request (dry-run by default). Live mode requires LCA_GITHUB_LIVE=1 and approval.",
    sideEffect: "external",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        head: { type: "string", description: "Branch name or HEAD" },
        base: { type: "string", description: "Target branch, default master" },
      },
      required: ["title"],
      additionalProperties: false,
    },
    maxObservationTokens: 400,
    async execute(input, ctx) {
      try {
        const result = await openPullRequest(
          ctx.workspaceRoot,
          {
            title: String(input.title ?? ""),
            body: typeof input.body === "string" ? input.body : "",
            head: typeof input.head === "string" ? input.head : undefined,
            base: typeof input.base === "string" ? input.base : undefined,
          },
          { exec: options?.exec },
        );
        if (result.dryRun) {
          return {
            ok: true,
            data: result,
            summary: `DRY RUN: would open PR '${result.title}' (${result.head} → ${result.base}) on ${result.repo}`,
          };
        }
        return {
          ok: true,
          data: result,
          summary: `Opened PR: ${result.url ?? result.title}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, summary: `github_open_pr failed: ${message}` };
      }
    },
  };
}

export function createGithubReviewCommitsTool(options?: { exec?: ExecFn }): ToolSpec {
  return {
    name: "github_review_commits",
    description:
      "Summarize recent git commits and diff stats in the workspace (read-only). Use for commit review requests.",
    sideEffect: "read",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Number of commits (1-20)" },
      },
      additionalProperties: false,
    },
    maxObservationTokens: 800,
    async execute(input, ctx) {
      try {
        const limit = typeof input.limit === "number" ? input.limit : 5;
        const review = await reviewRecentCommits(ctx.workspaceRoot, limit, options?.exec);
        const lines = review.commits.map((c) => `${c.hash} ${c.subject}`).join("; ");
        return {
          ok: true,
          data: review,
          summary: lines ? `Recent commits: ${lines}` : "No commits found",
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, summary: `github_review_commits failed: ${message}` };
      }
    },
  };
}
