/**
 * Phase 6 GitHub helpers — `gh` CLI wrapper, dry-run by default.
 * Set LCA_GITHUB_LIVE=1 to perform real issue/PR mutations (policy should ask first).
 */

import { spawn } from "node:child_process";

export type ExecResult = { code: number; stdout: string; stderr: string };
export type ExecFn = (argv: string[], cwd: string) => Promise<ExecResult>;

export function isGithubLiveMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LCA_GITHUB_LIVE === "1" || env.LCA_GITHUB_LIVE === "true";
}

export function isGithubDryRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isGithubLiveMode(env);
}

export function defaultExec(argv: string[], cwd: string): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(argv[0] ?? "", argv.slice(1), {
      cwd,
      env: { ...process.env, PATH: process.env.PATH },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.on("error", (err) => {
      resolve({ code: 1, stdout: "", stderr: err.message });
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c) => {
      stdout += String(c);
    });
    child.stderr?.on("data", (c) => {
      stderr += String(c);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export function parseGithubSlugFromRemote(url: string): string | undefined {
  const trimmed = url.trim();
  const ssh = trimmed.match(/git@github\.com:([^/]+\/[^/.]+)/i);
  if (ssh?.[1]) return ssh[1].replace(/\.git$/i, "");
  const https = trimmed.match(/github\.com[/:]([^/]+\/[^/.]+)/i);
  if (https?.[1]) return https[1].replace(/\.git$/i, "");
  return undefined;
}

export async function resolveRepoSlug(
  workspaceRoot: string,
  exec: ExecFn = defaultExec,
): Promise<string> {
  const remote = await exec(["git", "remote", "get-url", "origin"], workspaceRoot);
  if (remote.code === 0) {
    const slug = parseGithubSlugFromRemote(remote.stdout);
    if (slug) return slug;
  }
  return "unknown/unknown";
}

export interface CommitSummary {
  hash: string;
  subject: string;
}

export async function reviewRecentCommits(
  workspaceRoot: string,
  limit: number,
  exec: ExecFn = defaultExec,
): Promise<{ commits: CommitSummary[]; diffStat: string }> {
  const n = Math.min(Math.max(limit, 1), 20);
  const log = await exec(["git", "log", `-n`, String(n), "--oneline"], workspaceRoot);
  if (log.code !== 0) {
    throw new Error(log.stderr.trim() || "git log failed");
  }
  const commits: CommitSummary[] = log.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const sp = line.indexOf(" ");
      if (sp <= 0) return { hash: line, subject: "" };
      return { hash: line.slice(0, sp), subject: line.slice(sp + 1) };
    });

  const stat = await exec(["git", "diff", "--stat", `HEAD~${Math.min(n, commits.length || 1)}`, "HEAD"], workspaceRoot);
  const diffStat =
    stat.code === 0 && stat.stdout.trim()
      ? stat.stdout.trim().slice(0, 2000)
      : "(no diff stat available)";

  return { commits, diffStat };
}

export interface CreateIssueInput {
  title: string;
  body?: string;
}

export interface CreateIssueResult {
  dryRun: boolean;
  repo: string;
  title: string;
  body: string;
  url?: string;
}

export async function createIssue(
  workspaceRoot: string,
  input: CreateIssueInput,
  options?: { exec?: ExecFn; live?: boolean },
): Promise<CreateIssueResult> {
  const exec = options?.exec ?? defaultExec;
  const live = options?.live ?? isGithubLiveMode();
  const repo = await resolveRepoSlug(workspaceRoot, exec);
  const title = input.title.trim();
  const body = (input.body ?? "").trim();
  if (!title) throw new Error("title is required");

  if (!live) {
    return { dryRun: true, repo, title, body };
  }

  const argv = ["gh", "issue", "create", "--title", title];
  if (body) argv.push("--body", body);
  argv.push("--json", "url", "-q", ".url");
  const res = await exec(argv, workspaceRoot);
  if (res.code !== 0) throw new Error(res.stderr.trim() || "gh issue create failed");
  return { dryRun: false, repo, title, body, url: res.stdout.trim() };
}

export interface OpenPrInput {
  title: string;
  body?: string;
  head?: string;
  base?: string;
}

export interface OpenPrResult {
  dryRun: boolean;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  url?: string;
}

export async function openPullRequest(
  workspaceRoot: string,
  input: OpenPrInput,
  options?: { exec?: ExecFn; live?: boolean },
): Promise<OpenPrResult> {
  const exec = options?.exec ?? defaultExec;
  const live = options?.live ?? isGithubLiveMode();
  const repo = await resolveRepoSlug(workspaceRoot, exec);
  const title = input.title.trim();
  const body = (input.body ?? "").trim();
  const head = (input.head ?? "HEAD").trim();
  const base = (input.base ?? "master").trim();
  if (!title) throw new Error("title is required");

  if (!live) {
    return { dryRun: true, repo, title, body, head, base };
  }

  const argv = ["gh", "pr", "create", "--title", title];
  if (body) argv.push("--body", body);
  argv.push("--head", head, "--base", base, "--json", "url", "-q", ".url");
  const res = await exec(argv, workspaceRoot);
  if (res.code !== 0) throw new Error(res.stderr.trim() || "gh pr create failed");
  return { dryRun: false, repo, title, body, head, base, url: res.stdout.trim() };
}
