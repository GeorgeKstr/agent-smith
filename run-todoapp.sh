#!/usr/bin/env bash
set -euo pipefail

SMITH="npx tsx src/main.ts"
PROJECT_DIR="$HOME/Desktop/Projects/TodoApp"
AGENT_SMITH_DIR="$PWD"
TASK_FILE="$PWD/todoapp-tasks.json"

API_PORT=31337
ORGANIZER_PORT=8787

cleanup() {
  echo "--- Cleaning up ---"
  kill "${ORGANIZER_PID:-}" 2>/dev/null || true
  kill "${API_PID:-}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT

echo "=== Creating TodoApp project at ${PROJECT_DIR} ==="
mkdir -p "${PROJECT_DIR}"
mkdir -p "${PROJECT_DIR}/.agent"

# Write config for the TodoApp project so the API agent uses deepseek-v4-flash-free
python3 -c "
import json
with open('${AGENT_SMITH_DIR}/.agent/config.json') as f:
    config = json.load(f)
config['defaultProvider'] = 'opencode-zen'
config['models'] = {
    'tagger': 'deepseek-v4-flash-free',
    'summarizer': 'deepseek-v4-flash-free',
    'patcher': 'deepseek-v4-flash-free',
    'debugger': 'deepseek-v4-flash-free'
}
config['options'] = {'temperature': 0, 'numPredict': 8192}
config['organizer'] = {'enabled': True, 'url': 'http://127.0.0.1:8787', 'heartbeatMs': 5000}
with open('${PROJECT_DIR}/.agent/config.json', 'w') as f:
    json.dump(config, f, indent=2)
print('Config written')
"

echo "=== Starting Organizer on :${ORGANIZER_PORT} ==="
rm -f /tmp/agent-smith-organizer.db
${SMITH} organize --port "${ORGANIZER_PORT}" --db /tmp/agent-smith-organizer.db &
ORGANIZER_PID=$!
sleep 3

echo "=== Starting API Agent on :${API_PORT} ==="
${SMITH} api --port "${API_PORT}" --root "${PROJECT_DIR}" --create-root &
API_PID=$!
sleep 4

echo "=== Check health ==="
curl -s "http://127.0.0.1:${ORGANIZER_PORT}/api" > /dev/null && echo "Organizer: OK" || { echo "Organizer: DOWN"; exit 1; }
AGENT_STATUS=$(curl -s "http://127.0.0.1:${API_PORT}/api/status")
echo "Agent: ${AGENT_STATUS}"

# Create project
echo "=== Create organizer project ==="
PROJECT_RESP=$(curl -s -X POST "http://127.0.0.1:${ORGANIZER_PORT}/api/projects" \
  -H 'Content-Type: application/json' \
  -d '{"name": "TodoApp", "description": "Todo list application demo"}')
echo "Project resp: ${PROJECT_RESP}"
PROJECT_ID=$(echo "${PROJECT_RESP}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('project',{}).get('id',''))")
echo "Project ID: ${PROJECT_ID}"

if [ -z "${PROJECT_ID}" ]; then
  echo "Failed to create project. Trying to list existing..."
  curl -s "http://127.0.0.1:${ORGANIZER_PORT}/api/projects"
  # Use first project
  PROJECT_ID=$(curl -s "http://127.0.0.1:${ORGANIZER_PORT}/api/projects" \
    | python3 -c "import sys,json; p=json.load(sys.stdin).get('projects',[]); print(p[0]['id'] if p else '')")
  echo "Using existing project: ${PROJECT_ID}"
fi

# Get agent ID
echo "=== Get agent ID ==="
sleep 2
AGENTS_RESP=$(curl -s "http://127.0.0.1:${ORGANIZER_PORT}/api/agents")
echo "Agents: ${AGENTS_RESP}"
AGENT_ID=$(echo "${AGENTS_RESP}" | python3 -c "
import sys, json
resp = json.load(sys.stdin)
if isinstance(resp, list) and len(resp) > 0:
    print(resp[0].get('id', ''))
elif isinstance(resp, dict) and 'agents' in resp and len(resp['agents']) > 0:
    print(resp['agents'][0].get('id', ''))
else:
    print('')
")
echo "Agent ID: ${AGENT_ID}"
if [ -z "${AGENT_ID}" ]; then echo "ERROR: No agent"; exit 1; fi

# Import tasks
echo "=== Import tasks ==="
IMPORT_RESP=$(curl -s -X POST "http://127.0.0.1:${ORGANIZER_PORT}/api/tasks/import" \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c "
import json
with open('${TASK_FILE}') as f:
    raw = f.read()
data = {
    'text': raw,
    'format': 'json',
    'defaults': {'projectId': '${PROJECT_ID}', 'maxIterations': 2, 'autoApprove': True, 'autoApply': True},
    'options': {'createMissingBuckets': True, 'skipDuplicates': True}
}
print(json.dumps(data))
")")
echo "${IMPORT_RESP}" | python3 -m json.tool 2>/dev/null

# Extract task IDs
TASK_IDS=$(echo "${IMPORT_RESP}" | python3 -c "
import sys, json
resp = json.load(sys.stdin)
ids = resp.get('result', {}).get('taskIds', [])
for tid in ids:
    print(tid)
")

echo "=== Task IDs: ${TASK_IDS} ==="
if [ -z "${TASK_IDS}" ]; then echo "ERROR: No tasks imported"; exit 1; fi

# Assign agent to each task
for TID in ${TASK_IDS}; do
  [ -z "${TID}" ] && continue
  echo "Assign ${TID} -> ${AGENT_ID}"
  curl -s -X POST "http://127.0.0.1:${ORGANIZER_PORT}/api/tasks/${TID}/assign" \
    -H 'Content-Type: application/json' \
    -d "{\"agentId\": \"${AGENT_ID}\"}"
  echo ""
done

# Dispatch each task sequentially
for TID in ${TASK_IDS}; do
  [ -z "${TID}" ] && continue
  echo ""
  echo "=========================================="
  echo "  DISPATCH TASK ${TID}"
  echo "=========================================="

  DISPATCH_RESP=$(curl -s -X POST "http://127.0.0.1:${ORGANIZER_PORT}/api/tasks/${TID}/dispatch")
  echo "${DISPATCH_RESP}" | python3 -m json.tool 2>/dev/null || echo "${DISPATCH_RESP}"

  POLL=0
  while true; do
    sleep 10
    POLL=$((POLL + 1))
    TASK_RESP=$(curl -s "http://127.0.0.1:${ORGANIZER_PORT}/api/tasks/${TID}")
    TASK_STATUS=$(echo "${TASK_RESP}" | python3 -c "
import sys, json
t = json.load(sys.stdin)
print(t.get('status', 'unknown'))
")
    echo "[poll ${POLL}] ${TID}: ${TASK_STATUS}"

    case "${TASK_STATUS}" in
      completed|auto_approved)
        echo "--- SUCCESS ---"
        break
        ;;
      failed|cancelled)
        echo "--- FAILED ---"
        echo "${TASK_RESP}" | python3 -m json.tool 2>/dev/null
        break
        ;;
      needs_review)
        echo "--- Needs review, auto-approving ---"
        curl -s -X POST "http://127.0.0.1:${ORGANIZER_PORT}/api/tasks/${TID}/approve" -H 'Content-Type: application/json' -d '{}'
        echo ""
        ;;
    esac

    if [ ${POLL} -gt 60 ]; then echo "--- TIMEOUT ---"; break; fi
  done
done

echo ""
echo "=========================================="
echo "  DONE"
echo "=========================================="
echo ""
for TID in ${TASK_IDS}; do
  [ -z "${TID}" ] && continue
  echo "--- Task ${TID} ---"
  curl -s "http://127.0.0.1:${ORGANIZER_PORT}/api/tasks/${TID}" | python3 -c "
import sys, json
t = json.load(sys.stdin)
print(f\"  {t.get('title','')}: {t.get('status','')} (iter {t.get('currentIteration',0)}/{t.get('maxIterations',0)})\")
"
done

echo ""
ls -la "${PROJECT_DIR}/"
echo "Done."
