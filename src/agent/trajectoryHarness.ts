import { classifyRuntimeIntent } from "../agent/classifyRuntimeIntent.js";
import type { RuntimeIntent } from "../agent/runtimeIntent.js";
import type { AgentWorkflowPhase } from "../agent/workflowPhase.js";
import { toolsForPhase } from "../agent/phaseTools.js";
import { profileForPhase } from "../agent/permissionProfile.js";
import type { PermissionProfile } from "../agent/permissionProfile.js";
import { isWriteTool } from "../agent/toolPermissions.js";
import { parseLocalTextAction } from "../agent/localTextToolParser.js";
import { parseExplicitMode } from "../agent/parseExplicitMode.js";

export type TrajectoryScenario = {
  name: string;
  input: string;
  uiMode?: string;
  expected: {
    intent?: RuntimeIntent;
    explicitMode?: string;
    cleanedPrompt?: string;
  };
};

export type TrajectoryPhaseAssertion = {
  phase: AgentWorkflowPhase;
  allowedTools: string[];
  forbiddenTools?: string[];
  maxSearches?: number;
  maxReads?: number;
  minEdits?: number;
};

export type TrajectoryAssertion = {
  name: string;
  input: string;
  expectedIntent: RuntimeIntent;
  expectedPhases: AgentWorkflowPhase[];
  phaseAssertions?: Partial<Record<AgentWorkflowPhase, {
    allowedTools: string[];
    forbiddenTools?: string[];
  }>>;
  shouldNotContainTool?: string[];
  maxToolCallsPerPhase?: Partial<Record<AgentWorkflowPhase, number>>;
};

let passed = 0;
let failed = 0;

export function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    process.stdout.write(`  PASS  ${name}\n`);
  } catch (err) {
    failed++;
    process.stdout.write(`  FAIL  ${name}: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

export function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

export function eq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected "${String(expected)}", got "${String(actual)}"`);
  }
}

export function contains<T>(arr: T[], item: T, msg: string) {
  if (!arr.includes(item)) {
    throw new Error(`${msg}: "${String(item)}" not in [${arr.map(String).join(", ")}]`);
  }
}

export function notContains<T>(arr: T[], item: T, msg: string) {
  if (arr.includes(item)) {
    throw new Error(`${msg}: "${String(item)}" should not be in [${arr.map(String).join(", ")}]`);
  }
}

export function summarize(): { passed: number; failed: number; ok: boolean } {
  process.stdout.write(`\n${passed + failed} tests: ${passed} passed, ${failed} failed.\n`);
  return { passed, failed, ok: failed === 0 };
}

// ── Scenario-based harness ──────────────────────────────────────────

export function runIntentScenarios(scenarios: TrajectoryScenario[]): void {
  for (const scenario of scenarios) {
    test(scenario.name, () => {
      const { explicitMode, cleanedPrompt } = parseExplicitMode(scenario.input);
      const result = classifyRuntimeIntent({
        prompt: cleanedPrompt,
        uiMode: scenario.uiMode ?? "build",
        explicitMode,
      });

      if (scenario.expected.intent) {
        eq(result.intent, scenario.expected.intent,
          `intent for "${scenario.input}"`);
      }
      if (scenario.expected.explicitMode) {
        eq(explicitMode, scenario.expected.explicitMode,
          `explicitMode for "${scenario.input}"`);
      }
      if (scenario.expected.cleanedPrompt) {
        eq(cleanedPrompt, scenario.expected.cleanedPrompt,
          `cleanedPrompt for "${scenario.input}"`);
      }
    });
  }
}

export function runPhasePermissionTests(): void {
  // Phase permission tests run inline via direct imports.
  // See trajectoryRegression.test.ts for the actual test assertions.
}

export function runParserTests(): void {
  test("parse valid tool_call", () => {
    const result = parseLocalTextAction(
      '<tool_call>\n{"tool":"search","args":{"query":"test"}}\n</tool_call>'
    );
    eq(result.kind, "tool_call", "kind");
    if (result.kind === "tool_call") {
      eq(result.tool, "search", "tool name");
    }
  });

  test("parse valid final", () => {
    const result = parseLocalTextAction("<final>done</final>");
    eq(result.kind, "final", "kind");
  });

  test("parse normalizes tool_calls to tool_call", () => {
    const result = parseLocalTextAction(
      '<tool_calls>\n{"tool":"search","args":{"query":"x"}}\n</tool_calls>'
    );
    eq(result.kind, "tool_call", "kind");
    assert("repaired" in result && result.repaired === true, "should be repaired");
  });

  test("parse normalizes final_answer to final", () => {
    const result = parseLocalTextAction("<final_answer>ok</final_answer>");
    eq(result.kind, "final", "kind");
  });

  test("parse plain text", () => {
    const result = parseLocalTextAction("Hello world");
    eq(result.kind, "plain_text", "kind");
  });

  test("parse invalid JSON in tool_call", () => {
    const result = parseLocalTextAction("<tool_call>not json</tool_call>");
    eq(result.kind, "invalid", "kind");
  });

  test("parse multiple blocks -> first tool_call (multi-call supported)", () => {
    const result = parseLocalTextAction(
      "<tool_call>{\"tool\":\"a\",\"args\":{}}</tool_call><tool_call>{\"tool\":\"b\",\"args\":{}}</tool_call>"
    );
    eq(result.kind, "tool_call", "kind");
    if (result.kind === "tool_call") eq(result.tool, "a", "first tool");
  });
}
