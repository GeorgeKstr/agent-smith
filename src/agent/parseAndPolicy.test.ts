import { parseExplicitMode } from "./parseExplicitMode.js";
import { canCreateFilesForTask } from "./createFilePolicy.js";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.log(`  FAIL  ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function eq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: expected "${expected}", got "${actual}"`);
}

// ── Explicit mode parsing ──
console.log("Explicit mode parsing (Task 2.1)");

test("/chat hello -> explicitMode=chat, cleaned=hello", () => {
  const r = parseExplicitMode("/chat hello");
  eq(r.explicitMode, "chat", "explicitMode");
  eq(r.cleanedPrompt, "hello", "cleanedPrompt");
});

test("/ask create helloworld.txt -> explicitMode=ask", () => {
  const r = parseExplicitMode("/ask create helloworld.txt");
  eq(r.explicitMode, "ask", "explicitMode");
  eq(r.cleanedPrompt, "create helloworld.txt", "cleanedPrompt");
});

test("/build create helloworld.txt -> explicitMode=patch", () => {
  const r = parseExplicitMode("/build create helloworld.txt");
  eq(r.explicitMode, "patch", "explicitMode");
  eq(r.cleanedPrompt, "create helloworld.txt", "cleanedPrompt");
});

test("/patch fix the bug -> explicitMode=patch", () => {
  const r = parseExplicitMode("/patch fix the bug");
  eq(r.explicitMode, "patch", "explicitMode");
  eq(r.cleanedPrompt, "fix the bug", "cleanedPrompt");
});

test("normal message -> explicitMode=auto", () => {
  const r = parseExplicitMode("hello");
  eq(r.explicitMode, "auto", "explicitMode");
  eq(r.cleanedPrompt, "hello", "cleanedPrompt");
});

test("plain text with / inside -> explicitMode=auto", () => {
  const r = parseExplicitMode("src/app.ts line 42");
  eq(r.explicitMode, "auto", "explicitMode");
  eq(r.cleanedPrompt, "src/app.ts line 42", "cleanedPrompt");
});

// ── Create-file policy (Task 5.1) ──
console.log("Create-file policy");

test("create helloworld.txt -> allowed", () => {
  assert(canCreateFilesForTask({ prompt: "create helloworld.txt" }), "create txt");
});

test("add a new component called Button -> allowed", () => {
  assert(canCreateFilesForTask({ prompt: "add a new component called Button" }), "add component");
});

test("generate a test for login.ts -> allowed", () => {
  assert(canCreateFilesForTask({ prompt: "generate a test for login.ts" }), "generate test");
});

test("write a README.md -> allowed", () => {
  assert(canCreateFilesForTask({ prompt: "write a README.md" }), "write readme");
});

test("new file for User type -> allowed", () => {
  assert(canCreateFilesForTask({ prompt: "new file for User type" }), "new file");
});

test("fix the bug in config switcher -> NOT allowed (edit existing)", () => {
  assert(!canCreateFilesForTask({ prompt: "fix the bug in config switcher" }), "fix bug");
});

test("refactor the parser -> NOT allowed (existing files)", () => {
  assert(!canCreateFilesForTask({ prompt: "refactor the parser" }), "refactor");
});

test("explain how this works -> NOT allowed", () => {
  assert(!canCreateFilesForTask({ prompt: "explain how this works" }), "explain");
});

test("hello -> NOT allowed", () => {
  assert(!canCreateFilesForTask({ prompt: "hello" }), "hello");
});

test("create file with taskGoal -> allowed", () => {
  assert(canCreateFilesForTask({ prompt: "set up project", taskGoal: "create a new component file" }), "task goal");
});

console.log("\nDone.");
