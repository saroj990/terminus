import { createCalculatorTool } from "./calculator.js";
import { createWeatherTool } from "./weather.js";
import type { ToolSpec } from "@lca/agent-core";

export * from "./calculator.js";
export * from "./weather.js";

export function createPhase1Tools(options?: {
  fetchImpl?: typeof fetch;
}): ToolSpec[] {
  return [createCalculatorTool(), createWeatherTool({ fetchImpl: options?.fetchImpl })];
}
