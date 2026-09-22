import { createCalculatorTool } from "./calculator.js";
import { createWeatherTool } from "./weather.js";
import { createListDirTool, createReadFileTool, createSearchFilesTool } from "./files.js";
import { createRunShellTool } from "./shell.js";
import { createIndexCodebaseTool, createSearchCodebaseTool } from "./rag.js";
import { createRecallTool, createRememberTool } from "./memory.js";
import { createConfirmActionTool } from "./confirm.js";
import {
  createGithubCreateIssueTool,
  createGithubOpenPrTool,
  createGithubReviewCommitsTool,
} from "./github.js";
import type { ExecFn } from "@lca/github";
import type { ToolSpec } from "@lca/agent-core";

export * from "./calculator.js";
export * from "./weather.js";
export * from "./files.js";
export * from "./shell.js";
export * from "./rag.js";
export * from "./memory.js";
export * from "./confirm.js";
export * from "./github.js";

export function createPhase1Tools(options?: {
  fetchImpl?: typeof fetch;
}): ToolSpec[] {
  return [createCalculatorTool(), createWeatherTool({ fetchImpl: options?.fetchImpl })];
}

export function createPhase2Tools(): ToolSpec[] {
  return [
    createReadFileTool(),
    createListDirTool(),
    createSearchFilesTool(),
    createRunShellTool(),
  ];
}

export function createPhase3Tools(): ToolSpec[] {
  return [createIndexCodebaseTool(), createSearchCodebaseTool()];
}

export function createPhase4Tools(): ToolSpec[] {
  return [createRememberTool(), createRecallTool()];
}

export function createPhase5Tools(): ToolSpec[] {
  return [createConfirmActionTool()];
}

export function createPhase6Tools(options?: { githubExec?: ExecFn }): ToolSpec[] {
  const exec = options?.githubExec;
  return [
    createGithubCreateIssueTool({ exec }),
    createGithubOpenPrTool({ exec }),
    createGithubReviewCommitsTool({ exec }),
  ];
}

export function createDefaultTools(options?: {
  fetchImpl?: typeof fetch;
  githubExec?: ExecFn;
}): ToolSpec[] {
  return [
    ...createPhase1Tools(options),
    ...createPhase2Tools(),
    ...createPhase3Tools(),
    ...createPhase4Tools(),
    ...createPhase5Tools(),
    ...createPhase6Tools({ githubExec: options?.githubExec }),
  ];
}
