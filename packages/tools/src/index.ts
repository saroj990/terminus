import { createCalculatorTool } from "./calculator.js";
import { createWeatherTool } from "./weather.js";
import { createListDirTool, createReadFileTool, createSearchFilesTool } from "./files.js";
import { createRunShellTool } from "./shell.js";
import { createIndexCodebaseTool, createSearchCodebaseTool } from "./rag.js";
import type { ToolSpec } from "@lca/agent-core";

export * from "./calculator.js";
export * from "./weather.js";
export * from "./files.js";
export * from "./shell.js";
export * from "./rag.js";

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

export function createDefaultTools(options?: {
  fetchImpl?: typeof fetch;
}): ToolSpec[] {
  return [...createPhase1Tools(options), ...createPhase2Tools(), ...createPhase3Tools()];
}
