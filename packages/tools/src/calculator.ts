import type { ToolSpec } from "@lca/agent-core";

export interface CalculatorInput {
  expression: string;
}

/**
 * Safe arithmetic evaluator — digits, whitespace, and + - * / ( ) . only.
 * No identifiers, no function calls, no exponentiation via **.
 */
export function evaluateExpression(expression: string): number {
  const cleaned = expression.replace(/\s+/g, "");
  if (!cleaned) throw new Error("Empty expression");
  if (!/^[0-9+\-*/().]+$/.test(cleaned)) {
    throw new Error("Expression contains unsupported characters");
  }
  if (/[a-zA-Z_$]/.test(expression)) {
    throw new Error("Identifiers are not allowed");
  }

  // Shunting-yard / recursive descent would be ideal; for Phase 1 we use
  // Function only after charset validation (no user code paths).
  // eslint-disable-next-line no-new-func
  const value = Function(`"use strict"; return (${cleaned});`)();
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Expression did not evaluate to a finite number");
  }
  return value;
}

export function createCalculatorTool(): ToolSpec {
  return {
    name: "calculator",
    description:
      "Evaluate a basic arithmetic expression. Supports +, -, *, /, parentheses, and decimals.",
    sideEffect: "read",
    inputSchema: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "Arithmetic expression, e.g. '(12 + 8) * 3'",
        },
      },
      required: ["expression"],
      additionalProperties: false,
    },
    maxObservationTokens: 200,
    async execute(input) {
      const expression = String(input.expression ?? "");
      try {
        const result = evaluateExpression(expression);
        return {
          ok: true,
          data: { expression, result },
          summary: `${expression} = ${result}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error: message,
          summary: `Calculator failed: ${message}`,
        };
      }
    },
  };
}
