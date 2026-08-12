import { createAgentRun, runAgentLoop } from "@lca/agent-core";
import { createHeuristicLlm } from "@lca/llm";
import { createDefaultPolicy } from "@lca/policy";
import { createCalculatorTool, createWeatherTool } from "@lca/tools";
import { PHASE1_CASES, type EvalCase } from "./cases.js";

interface CaseResult {
  id: string;
  passed: boolean;
  failures: string[];
}

async function runCase(c: EvalCase): Promise<CaseResult> {
  const failures: string[] = [];
  const tools = [
    createCalculatorTool(),
    createWeatherTool({
      fetchImpl: c.mockWeather
        ? async () =>
            new Response(
              JSON.stringify({
                current: {
                  temperature_2m: 21,
                  weather_code: 0,
                  wind_speed_10m: 8,
                },
              }),
              { status: 200 },
            )
        : fetch,
    }),
  ];

  const run = createAgentRun(c.goal);
  const result = await runAgentLoop(run, {
    llm: createHeuristicLlm(),
    tools,
    policy: createDefaultPolicy(),
  });

  if (c.expectStatus && result.status !== c.expectStatus) {
    failures.push(`status: expected ${c.expectStatus}, got ${result.status}`);
  }

  const usedTools = result.steps.flatMap((s) => s.toolCalls.map((t) => t.name));
  if (c.expectTools) {
    if (c.expectTools.length === 0 && usedTools.length > 0) {
      failures.push(`tools: expected none, got [${usedTools.join(", ")}]`);
    }
    for (const name of c.expectTools) {
      if (!usedTools.includes(name)) {
        failures.push(`tools: missing expected '${name}' (got [${usedTools.join(", ")}])`);
      }
    }
  }

  if (typeof c.expectNumericAnswer === "number") {
    const calcObs = result.steps
      .flatMap((s) => s.observations)
      .find((o) => o.toolName === "calculator" && o.ok);
    const data = calcObs?.data as { result?: number } | undefined;
    if (data?.result !== c.expectNumericAnswer) {
      failures.push(
        `numeric: expected ${c.expectNumericAnswer}, got ${data?.result ?? "undefined"}`,
      );
    }
    if (!result.finalAnswer?.includes(String(c.expectNumericAnswer))) {
      failures.push(`answer missing number ${c.expectNumericAnswer}: ${result.finalAnswer}`);
    }
  }

  if (c.expectAnswerIncludes) {
    for (const needle of c.expectAnswerIncludes) {
      if (!result.finalAnswer?.includes(needle)) {
        failures.push(`answer missing '${needle}': ${result.finalAnswer}`);
      }
    }
  }

  return { id: c.id, passed: failures.length === 0, failures };
}

async function main() {
  console.log(`Running ${PHASE1_CASES.length} Phase 1 eval cases (heuristic provider)...\n`);
  const results: CaseResult[] = [];
  for (const c of PHASE1_CASES) {
    const r = await runCase(c);
    results.push(r);
    const mark = r.passed ? "PASS" : "FAIL";
    console.log(`[${mark}] ${r.id}`);
    for (const f of r.failures) console.log(`       - ${f}`);
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  console.log(`\nSummary: ${passed}/${results.length} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
