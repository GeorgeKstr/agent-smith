#!/usr/bin/env python3
import subprocess, json, re, time, sys, os

SMITH = "npx tsx " + os.path.expanduser("~/Desktop/Projects/AgentSmith/agent-smith/src/main.ts")
ROOT = os.path.expanduser("~/Desktop/Projects/TodoApp")

def run(args, timeout=600):
    full = SMITH.split() + ["-C", ROOT] + args
    try:
        result = subprocess.run(full, capture_output=True, text=True, timeout=timeout)
        return (result.stdout or "") + (result.stderr or "")
    except subprocess.TimeoutExpired:
        return "TIMEOUT"

# Get task IDs in order
out = run(["task", "list", "--json"], timeout=30)
if not out.strip():
    print("No tasks found. Import first.")
    sys.exit(1)

tasks = json.loads(out)

def sort_key(t):
    m = re.match(r"(\d+)", t.get("title", ""))
    return int(m.group(1)) if m else 99

tasks.sort(key=sort_key)

for t in tasks:
    tid = t["id"]
    title = t["title"]
    print()
    print("=" * 60)
    print(f"  TASK: {tid} — {title}")
    print("=" * 60)

    max_iter = 2
    for iteration in range(1, max_iter + 1):
        print(f"  --- Iteration {iteration}/{max_iter} ---")
        start = time.time()
        out = run(["task", "patch", "--apply", tid], timeout=900)
        elapsed = time.time() - start
        print(out[-600:])
        print(f"  Time: {elapsed:.0f}s")

        if "Agent completed" in out:
            print(f"  --- ACCEPTED ---")
            break
        elif "Agent partial" in out:
            if iteration < max_iter:
                print(f"  --- Partial, retrying ---")
            else:
                print(f"  --- Partial after {max_iter} iterations, moving on ---")
                break
        else:
            if iteration < max_iter:
                print(f"  --- Failed, retrying ---")
            else:
                print(f"  --- Failed after {max_iter} iterations ---")
                break

print()
print("=" * 60)
print("  ALL TASKS COMPLETE")
print("=" * 60)
print()
print("Files created:")
subprocess.run(["find", ROOT, "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.agent/*", "-type", "f"], timeout=10)
