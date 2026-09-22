import fs from "node:fs";
import path from "node:path";
import type { ToolSpec } from "@lca/agent-core";

/** HITL demo: destructive side-effect so policy asks before execute. */
export function createConfirmActionTool(): ToolSpec {
  return {
    name: "confirm_action",
    description:
      "Apply a named workspace action that requires human approval (destructive). Use when the user says confirm the action <name>.",
    sideEffect: "destructive",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "Short action name, e.g. demo" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    maxObservationTokens: 200,
    async execute(input, ctx) {
      const action = String(input.action ?? "demo").trim() || "demo";
      const dir = path.join(ctx.workspaceRoot, ".lca");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "hitl-marker.json");
      fs.writeFileSync(
        file,
        JSON.stringify({ action, at: new Date().toISOString() }, null, 2),
        "utf8",
      );
      return {
        ok: true,
        data: { action, file },
        summary: `Confirmed action ${action}`,
      };
    },
  };
}
