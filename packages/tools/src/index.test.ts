import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateExpression, createCalculatorTool } from "./calculator.js";
import { resolveLocation, createWeatherTool } from "./weather.js";

describe("evaluateExpression", () => {
  it("computes arithmetic", () => {
    assert.equal(evaluateExpression("(12 + 8) * 3"), 60);
    assert.equal(evaluateExpression("10 / 4"), 2.5);
  });

  it("rejects unsafe input", () => {
    assert.throws(() => evaluateExpression("process.exit(1)"));
    assert.throws(() => evaluateExpression("1 + foo"));
  });
});

describe("calculator tool", () => {
  it("returns structured result", async () => {
    const tool = createCalculatorTool();
    const result = await tool.execute(
      { expression: "2+2" },
      { runId: "t", workspaceRoot: "/tmp" },
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { expression: "2+2", result: 4 });
  });
});

describe("resolveLocation", () => {
  it("resolves known cities", () => {
    assert.equal(resolveLocation("London").label, "London");
  });
});

describe("weather tool", () => {
  it("parses mocked API response", async () => {
    const tool = createWeatherTool({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            current: { temperature_2m: 18.5, weather_code: 1, wind_speed_10m: 12 },
          }),
          { status: 200 },
        ),
    });
    const result = await tool.execute(
      { location: "London" },
      { runId: "t", workspaceRoot: "/tmp" },
    );
    assert.equal(result.ok, true);
    assert.match(result.summary, /London/);
  });
});
