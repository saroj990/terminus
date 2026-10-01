import type { ToolSpec } from "@lca/agent-core";
import {
  buildDockerImage,
  checkStagingHealth,
  deployToStaging,
  proposeStagingRollback,
  type ExecFn,
} from "@lca/deploy";

export function createDeployDockerBuildTool(options?: { exec?: ExecFn }): ToolSpec {
  return {
    name: "deploy_docker_build",
    description:
      "Build a Docker image for staging (dry-run by default). Set LCA_DEPLOY_LIVE=1 and approve to run docker build.",
    sideEffect: "exec",
    inputSchema: {
      type: "object",
      properties: {
        imageTag: { type: "string", description: "Optional image tag, default workspace name:staging" },
      },
      additionalProperties: false,
    },
    maxObservationTokens: 400,
    async execute(input, ctx) {
      try {
        const imageTag = typeof input.imageTag === "string" ? input.imageTag : undefined;
        const result = await buildDockerImage(ctx.workspaceRoot, {
          imageTag,
          exec: options?.exec,
        });
        if (result.dryRun) {
          return {
            ok: true,
            data: result,
            summary: `DRY RUN: ${result.command}`,
          };
        }
        return {
          ok: true,
          data: result,
          summary: `Built image ${result.imageTag}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, summary: `deploy_docker_build failed: ${message}` };
      }
    },
  };
}

export function createDeployStagingTool(): ToolSpec {
  return {
    name: "deploy_staging",
    description:
      "Deploy the staging image (dry-run by default). Live deploy requires LCA_DEPLOY_LIVE=1 and human approval.",
    sideEffect: "external",
    inputSchema: {
      type: "object",
      properties: {
        imageTag: { type: "string" },
      },
      additionalProperties: false,
    },
    maxObservationTokens: 400,
    async execute(input, ctx) {
      try {
        const imageTag = typeof input.imageTag === "string" ? input.imageTag : undefined;
        const result = await deployToStaging(ctx.workspaceRoot, { imageTag });
        if (result.dryRun) {
          return {
            ok: true,
            data: result,
            summary: `DRY RUN: ${result.message}`,
          };
        }
        return {
          ok: true,
          data: result,
          summary: result.message,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, summary: `deploy_staging failed: ${message}` };
      }
    },
  };
}

export function createDeployCheckHealthTool(options?: {
  fetchImpl?: typeof fetch;
}): ToolSpec {
  return {
    name: "deploy_check_health",
    description:
      "Verify staging health via HTTP GET (dry-run assumes OK). Uses LCA_STAGING_URL base, path /health.",
    sideEffect: "external",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Health path, default /health" },
      },
      additionalProperties: false,
    },
    maxObservationTokens: 300,
    async execute(input) {
      try {
        const pathArg = typeof input.path === "string" ? input.path : undefined;
        const result = await checkStagingHealth({
          path: pathArg,
          fetchImpl: options?.fetchImpl,
        });
        const prefix = result.dryRun ? "DRY RUN: " : "";
        return {
          ok: result.healthy,
          data: result,
          summary: `${prefix}${result.detail} (${result.url})`,
          error: result.healthy ? undefined : result.detail,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message, summary: `deploy_check_health failed: ${message}` };
      }
    },
  };
}

export function createDeployProposeRollbackTool(): ToolSpec {
  return {
    name: "deploy_propose_rollback",
    description:
      "Propose a staging rollback after a failed deploy or health check (destructive — requires approval before recording the plan).",
    sideEffect: "destructive",
    inputSchema: {
      type: "object",
      properties: {
        reason: { type: "string" },
        previousRevision: { type: "string" },
      },
      required: ["reason"],
      additionalProperties: false,
    },
    maxObservationTokens: 500,
    async execute(input, ctx) {
      const reason = String(input.reason ?? "health check failed");
      const previousRevision =
        typeof input.previousRevision === "string" ? input.previousRevision : undefined;
      const plan = proposeStagingRollback({ reason, previousRevision });
      const steps = plan.steps.join("; ");
      const marker = {
        plan,
        workspaceRoot: ctx.workspaceRoot,
        at: new Date().toISOString(),
      };
      return {
        ok: true,
        data: marker,
        summary: `Rollback plan for ${plan.stagingUrl} (rev ${plan.previousRevision}): ${steps}`,
      };
    },
  };
}
