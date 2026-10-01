/**
 * Phase 8 deployment helpers — dry-run by default, staging-only URL.
 * Set LCA_DEPLOY_LIVE=1 to run real docker build / deploy commands (policy should ask first).
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type ExecResult = { code: number; stdout: string; stderr: string };
export type ExecFn = (argv: string[], cwd: string) => Promise<ExecResult>;

export function isDeployLiveMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LCA_DEPLOY_LIVE === "1" || env.LCA_DEPLOY_LIVE === "true";
}

export function isDeployDryRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return !isDeployLiveMode(env);
}

export function resolveStagingBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.LCA_STAGING_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  return "https://staging.example.com";
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

function defaultImageTag(workspaceRoot: string): string {
  const base = path.basename(path.resolve(workspaceRoot)) || "app";
  return `${base.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}:staging`;
}

export interface DockerBuildResult {
  dryRun: boolean;
  imageTag: string;
  command: string;
}

export async function buildDockerImage(
  workspaceRoot: string,
  options?: { imageTag?: string; exec?: ExecFn; env?: NodeJS.ProcessEnv },
): Promise<DockerBuildResult> {
  const env = options?.env ?? process.env;
  const imageTag = options?.imageTag ?? defaultImageTag(workspaceRoot);
  const dockerfile = fs.existsSync(path.join(workspaceRoot, "Dockerfile"))
    ? "Dockerfile"
    : "Dockerfile (missing — would fail live)";
  const command = `docker build -t ${imageTag} -f ${dockerfile} .`;

  if (isDeployDryRun(env)) {
    return { dryRun: true, imageTag, command };
  }

  const exec = options?.exec ?? defaultExec;
  const result = await exec(["docker", "build", "-t", imageTag, "."], workspaceRoot);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "docker build failed");
  }
  return { dryRun: false, imageTag, command };
}

export interface StagingDeployResult {
  dryRun: boolean;
  stagingUrl: string;
  imageTag: string;
  message: string;
}

export async function deployToStaging(
  workspaceRoot: string,
  options?: { imageTag?: string; env?: NodeJS.ProcessEnv },
): Promise<StagingDeployResult> {
  const env = options?.env ?? process.env;
  const stagingUrl = resolveStagingBaseUrl(env);
  const imageTag = options?.imageTag ?? defaultImageTag(workspaceRoot);
  const message = `Deploy ${imageTag} to ${stagingUrl}`;

  if (isDeployDryRun(env)) {
    return { dryRun: true, stagingUrl, imageTag, message };
  }

  // Live path is intentionally a stub: real clusters differ; operators wire CI/CD separately.
  return {
    dryRun: false,
    stagingUrl,
    imageTag,
    message: `Live deploy stub completed for ${stagingUrl} (${imageTag})`,
  };
}

export interface HealthCheckResult {
  dryRun: boolean;
  url: string;
  healthy: boolean;
  status?: number;
  detail: string;
}

export async function checkStagingHealth(
  options?: {
    path?: string;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
  },
): Promise<HealthCheckResult> {
  const env = options?.env ?? process.env;
  const base = resolveStagingBaseUrl(env);
  const healthPath = options?.path ?? "/health";
  const url = `${base}${healthPath.startsWith("/") ? healthPath : `/${healthPath}`}`;

  if (isDeployDryRun(env)) {
    return {
      dryRun: true,
      url,
      healthy: true,
      detail: "DRY RUN: assume staging health OK",
    };
  }

  const fetchImpl = options?.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(url, { method: "GET" });
    const healthy = res.ok;
    return {
      dryRun: false,
      url,
      healthy,
      status: res.status,
      detail: healthy ? `Health OK (${res.status})` : `Health failed (${res.status})`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      dryRun: false,
      url,
      healthy: false,
      detail: `Health request failed: ${message}`,
    };
  }
}

export interface RollbackProposal {
  stagingUrl: string;
  previousRevision: string;
  reason: string;
  steps: string[];
}

export function proposeStagingRollback(input: {
  reason: string;
  previousRevision?: string;
  env?: NodeJS.ProcessEnv;
}): RollbackProposal {
  const env = input.env ?? process.env;
  const stagingUrl = resolveStagingBaseUrl(env);
  const previousRevision = input.previousRevision?.trim() || "previous-stable";
  const reason = input.reason.trim() || "health check failed";
  return {
    stagingUrl,
    previousRevision,
    reason,
    steps: [
      `Scale down bad release on ${stagingUrl}`,
      `Redeploy revision ${previousRevision}`,
      `Re-run GET ${stagingUrl}/health`,
    ],
  };
}
