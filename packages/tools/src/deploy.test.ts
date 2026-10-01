import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDeployCheckHealthTool,
  createDeployDockerBuildTool,
  createDeployProposeRollbackTool,
  createDeployStagingTool,
} from "./deploy.js";

describe("deploy tools", () => {
  it("dry-runs docker build and staging deploy", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lca-deploy-"));
    const build = createDeployDockerBuildTool();
    const buildRes = await build.execute({}, { workspaceRoot: root, signal: new AbortController().signal });
    assert.equal(buildRes.ok, true);
    assert.match(buildRes.summary ?? "", /DRY RUN.*docker build/i);

    const staging = createDeployStagingTool();
    const deployRes = await staging.execute({}, { workspaceRoot: root, signal: new AbortController().signal });
    assert.equal(deployRes.ok, true);
    assert.match(deployRes.summary ?? "", /DRY RUN.*Deploy/i);
  });

  it("dry-runs health check", async () => {
    const health = createDeployCheckHealthTool();
    const res = await health.execute({}, { workspaceRoot: process.cwd(), signal: new AbortController().signal });
    assert.equal(res.ok, true);
    assert.match(res.summary ?? "", /DRY RUN/i);
  });

  it("returns rollback plan summary", async () => {
    const rollback = createDeployProposeRollbackTool();
    const res = await rollback.execute(
      { reason: "health check failed", previousRevision: "rev-1" },
      { workspaceRoot: process.cwd(), signal: new AbortController().signal },
    );
    assert.equal(res.ok, true);
    assert.match(res.summary ?? "", /Rollback plan/i);
    assert.match(res.summary ?? "", /rev-1/);
  });
});
