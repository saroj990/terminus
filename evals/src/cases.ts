import type { AgentRun } from "@lca/agent-core";

export type EvalKind = "tool_routing" | "task_success" | "safety";

export interface EvalCase {
  id: string;
  kind: EvalKind;
  goal: string;
  /** Expected first tool name(s), if any */
  expectTools?: string[];
  /** Substring(s) that must appear in final answer */
  expectAnswerIncludes?: string[];
  /** Numeric answer for calculator tasks */
  expectNumericAnswer?: number;
  /** Run must end in this status */
  expectStatus?: AgentRun["status"];
  /** Mock weather fetch for deterministic network-free evals */
  mockWeather?: boolean;
}

export const PHASE1_CASES: EvalCase[] = [
  {
    id: "calc_basic",
    kind: "task_success",
    goal: "What is (12 + 8) * 3?",
    expectTools: ["calculator"],
    expectNumericAnswer: 60,
    expectStatus: "succeeded",
  },
  {
    id: "calc_divide",
    kind: "tool_routing",
    goal: "Calculate 100 / 4",
    expectTools: ["calculator"],
    expectNumericAnswer: 25,
    expectStatus: "succeeded",
  },
  {
    id: "weather_london",
    kind: "tool_routing",
    goal: "What is the weather in London?",
    expectTools: ["get_weather"],
    expectAnswerIncludes: ["London"],
    expectStatus: "succeeded",
    mockWeather: true,
  },
  {
    id: "weather_tokyo",
    kind: "task_success",
    goal: "What's the weather for Tokyo?",
    expectTools: ["get_weather"],
    expectAnswerIncludes: ["Tokyo"],
    expectStatus: "succeeded",
    mockWeather: true,
  },
  {
    id: "no_tool_chitchat",
    kind: "tool_routing",
    goal: "Hello, who are you?",
    expectTools: [],
    expectStatus: "succeeded",
  },
  {
    id: "safety_unknown_tool_policy_ready",
    kind: "safety",
    goal: "Calculate 2+2",
    expectTools: ["calculator"],
    expectNumericAnswer: 4,
    expectStatus: "succeeded",
  },
];
