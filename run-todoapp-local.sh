#!/usr/bin/env bash
set -euo pipefail

SMITH="npx tsx /home/spark/Desktop/Projects/AgentSmith/agent-smith/src/main.ts"
PROJECT_DIR="$HOME/Desktop/Projects/TodoApp"
TASK_FILE="todoapp-tasks.json"

mkdir -p "${PROJECT_DIR}"
mkdir -p "${PROJECT_DIR}/.agent"

# Write agent config for the TodoApp project
python3 -c "
import json
with open('/home/spark/Desktop/Projects/AgentSmith/agent-smith/.agent/config.json') as f:
    config = json.load(f)
config['defaultProvider'] = 'opencode-zen'
config['models'] = {
    'tagger': 'deepseek-v4-flash-free',
    'summarizer': 'deepseek-v4-flash-free',
    'patcher': 'deepseek-v4-flash-free',
    'debugger': 'deepseek-v4-flash-free'
}
config['options'] = {'temperature': 0, 'numPredict': 8192}
with open('${PROJECT_DIR}/.agent/config.json', 'w') as f:
    json.dump(config, f, indent=2)
print('Config ready')
"

# Import tasks into the TodoApp project database
echo "=== Import tasks ==="
IMPORT_OUT=$(${SMITH} -C "${PROJECT_DIR}" task import --file "${TASK_FILE}" --format json --json 2>&1)
echo "${IMPORT_OUT}"

TASK_IDS=$(echo "${IMPORT_OUT}" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
for tid in data.get('taskIds', []):
    if tid: print(tid)
")

echo "=== Task IDs ==="
echo "${TASK_IDS}"

if [ -z "${TASK_IDS}" ]; then
  echo "ERROR: No tasks imported"
  exit 1
fi

# Run each task: implement (iter 1) + review (iter 2)
for TID in ${TASK_IDS}; do
  [ -z "${TID}" ] && continue
  echo ""
  echo "=========================================="
  echo "  TASK: ${TID}"
  echo "=========================================="

  echo "--- Iteration 1: Implement ---"
  ${SMITH} -C "${PROJECT_DIR}" task patch --apply "${TID}" 2>&1
  echo "--- Iteration 1 done ---"

  echo "--- Iteration 2: Review & improve ---"
  ${SMITH} -C "${PROJECT_DIR}" task patch --apply "${TID}" 2>&1
  echo "--- Iteration 2 done ---"
done

echo ""
echo "=========================================="
echo "  ALL TASKS COMPLETE"
echo "=========================================="
echo ""
echo "Project files:"
find "${PROJECT_DIR}" -not -path '*/node_modules/*' -not -path '*/.agent/*' -not -path '*/data/*' -type f 2>/dev/null | head -50
echo ""
echo "Done."
