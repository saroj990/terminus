import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDockerImage,
  checkStagingHealth,
  deployToStaging,
  isDeployDryRun,
  proposeStagingRollback,
  resolveStagingBaseUrl,
} from "./index.js";

describe("deploy client", () => {
  it("defaults to dry-run and staging URL", () => {
    assert.equal(isDeployDryRun({}), true);
    assert.equal(resolveStagingBaseUrl({}), "https://staging.example.com");
    assert.equal(resolveStagingBaseUrl({ LCA_STAGING_URL: "https://app.test/" }), "https://app.test");
  });

  it("dry-runs docker build and staging deploy", async () => {
    const cwd = process.cwd();
    const build = await buildDockerImage(cwd, { env: {} });
    assert.equal(build.dryRun, true);
    assert.match(build.command, /docker build/);

    const deploy = await deployToStaging(cwd, { env: {} });
    assert.equal(deploy.dryRun, true);
    assert.match(deploy.message, /Deploy/);
  });

  it("dry-runs health check as healthy", async () => {
    const health = await checkStagingHealth({ env: {} });
    assert.equal(health.dryRun, true);
    assert.equal(health.healthy, true);
    assert.match(health.url, /\/health$/);
  });

  it("proposes rollback steps", () => {
    const plan = proposeStagingRollback({
      reason: "health check failed",
      previousRevision: "rev-42",
      env: { LCA_STAGING_URL: "https://staging.example.com" },
    });
    assert.equal(plan.previousRevision, "rev-42");
    assert.equal(plan.steps.length, 3);
    assert.match(plan.steps[0] ?? "", /Scale down/);
  });
});
