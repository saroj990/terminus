import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHeuristicLlm } from "./index.js";
import { createCalculatorTool, createDefaultTools, createWeatherTool } from "@lca/tools";

describe("heuristic llm", () => {
  const tools = [createCalculatorTool(), createWeatherTool()];
  const llm = createHeuristicLlm();

  it("routes math to calculator", async () => {
    const res = await llm.complete({
      messages: [
        { role: "system", content: "x" },
        { role: "user", content: "What is (12 + 8) * 3?" },
      ],
      tools,
    });
    assert.equal(res.toolCalls?.[0]?.name, "calculator");
  });

  it("routes weather to get_weather", async () => {
    const res = await llm.complete({
      messages: [
        { role: "system", content: "x" },
        { role: "user", content: "What is the weather in Tokyo?" },
      ],
      tools,
    });
    assert.equal(res.toolCalls?.[0]?.name, "get_weather");
    assert.equal(
      (res.toolCalls?.[0]?.arguments as { location?: string })?.location,
      "Tokyo",
    );
  });

  it("routes read_file for workspace paths", async () => {
    const res = await llm.complete({
      messages: [
        { role: "system", content: "x" },
        { role: "user", content: "Read the file README.md" },
      ],
      tools: createDefaultTools(),
    });
    assert.equal(res.toolCalls?.[0]?.name, "read_file");
  });

  it("routes where-is questions to search_codebase", async () => {
    const res = await llm.complete({
      messages: [
        { role: "system", content: "x" },
        { role: "user", content: "Where is greet defined?" },
      ],
      tools: createDefaultTools(),
    });
    assert.equal(res.toolCalls?.[0]?.name, "search_codebase");
  });
});
