import { toolsForRuntimeIntent, isWriteTool, permissionLevelForIntent } from "./toolPermissions.js";

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

function deepEq<T>(actual: T[], expected: T[], msg: string) {
  if (actual.length !== expected.length) {
    throw new Error(`${msg}: expected [${expected}], got [${actual}]`);
  }
  const aa = [...actual].sort();
  const ee = [...expected].sort();
  for (let i = 0; i < aa.length; i++) {
    if (aa[i] !== ee[i]) {
      throw new Error(`${msg}: expected [${expected}], got [${actual}]`);
    }
  }
}

// ── Task 3.1: Tool permissions ──
console.log("Tool permissions by intent");

test("chat intent -> no tools", () => {
  const tools = toolsForRuntimeIntent("chat");
  deepEq(tools, [], "chat tools");
});

test("ask intent -> read-only tools", () => {
  const tools = toolsForRuntimeIntent("ask");
  assert(tools.includes("search"), "ask has search");
  assert(tools.includes("read"), "ask has read");
  assert(tools.includes("ask_user"), "ask has ask_user");
  assert(tools.includes("finish"), "ask has finish");
  assert(!tools.includes("create_file"), "ask no create_file");
  assert(!tools.includes("edit"), "ask no edit");
  assert(!tools.includes("replace_lines"), "ask no replace_lines");
  assert(!tools.includes("check"), "ask no check");
});

test("patch intent -> write tools", () => {
  const tools = toolsForRuntimeIntent("patch");
  assert(tools.includes("search"), "patch has search");
  assert(tools.includes("read"), "patch has read");
  assert(tools.includes("create_file"), "patch has create_file");
  assert(tools.includes("edit"), "patch has edit");
  assert(tools.includes("replace_lines"), "patch has replace_lines");
  assert(tools.includes("check"), "patch has check");
  assert(tools.includes("ask_user"), "patch has ask_user");
  assert(tools.includes("finish"), "patch has finish");
});

test("command intent -> no tools", () => {
  const tools = toolsForRuntimeIntent("command");
  deepEq(tools, [], "command tools");
});

// ── Task 7.7: Write tool hard-block ──
console.log("Write tool detection");

test("create_file is write tool", () => {
  assert(isWriteTool("create_file"), "create_file");
});
test("edit is write tool", () => {
  assert(isWriteTool("edit"), "edit");
});
test("replace_lines is write tool", () => {
  assert(isWriteTool("replace_lines"), "replace_lines");
});
test("delete_file is write tool", () => {
  assert(isWriteTool("delete_file"), "delete_file");
});
test("search is NOT write tool", () => {
  assert(!isWriteTool("search"), "search");
});
test("read is NOT write tool", () => {
  assert(!isWriteTool("read"), "read");
});
test("ask_user is NOT write tool", () => {
  assert(!isWriteTool("ask_user"), "ask_user");
});
test("finish is NOT write tool", () => {
  assert(!isWriteTool("finish"), "finish");
});

// ── Permission levels ──
console.log("Permission levels");

test("chat -> none", () => {
  assert(permissionLevelForIntent("chat") === "none", "chat");
});
test("ask -> readonly", () => {
  assert(permissionLevelForIntent("ask") === "readonly", "ask");
});
test("patch -> write", () => {
  assert(permissionLevelForIntent("patch") === "write", "patch");
});
test("command -> none", () => {
  assert(permissionLevelForIntent("command") === "none", "command");
});

console.log("\nDone.");
