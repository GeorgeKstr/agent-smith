#!/usr/bin/env bash
set -euo pipefail

SMITH="npx tsx /home/spark/Desktop/Projects/AgentSmith/agent-smith/src/main.ts"
PROJECT_DIR="$HOME/Desktop/Projects/TodoApp"
TASK_FILE="/home/spark/Desktop/Projects/AgentSmith/agent-smith/todoapp-tasks.json"

ORGANIZER_PORT=8787
API_PORT=31337

cleanup() {
  kill "${ORGPID:-}" 2>/dev/null || true
  kill "${APIPID:-}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT

echo "=== Step 1: Prepare project ==="
mkdir -p "${PROJECT_DIR}"

echo "=== Step 2: Start services ==="
rm -f /tmp/agent-smith-organizer.db
${SMITH} organize --port ${ORGANIZER_PORT} --db /tmp/agent-smith-organizer.db &
ORGPID=$!
sleep 3

${SMITH} api --port ${API_PORT} --root "${PROJECT_DIR}" &
APIPID=$!
sleep 4

echo "=== Step 3: Create project ==="
PRJ=$(curl -s -X POST http://127.0.0.1:${ORGANIZER_PORT}/api/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"TodoApp","description":"Todo app demo"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['project']['id'])")
echo "Project: ${PRJ}"

echo "=== Step 4: Get agent ID ==="
AGENT=$(curl -s http://127.0.0.1:${ORGANIZER_PORT}/api/agents \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('agents',r)[0]['id'])")
echo "Agent: ${AGENT}"

echo "=== Step 5: Import tasks with defaults ==="
RAW_JSON=$(cat "${TASK_FILE}")
IMPORT_RESP=$(curl -s -X POST http://127.0.0.1:${ORGANIZER_PORT}/api/tasks/import \
  -H 'Content-Type: application/json' \
  -d "$(python3 -c "
import json
with open('${TASK_FILE}') as f:
    raw = f.read()
data = {
    'text': raw,
    'format': 'json',
    'defaults': {
        'projectId': '${PRJ}',
        'assignedAgentId': '${AGENT}',
        'implementModel': 'deepseek-v4-flash',
        'reviewModel': 'deepseek-v4-flash',
        'maxIterations': 2,
        'autoApprove': True,
        'autoApply': True,
    },
    'options': {'createMissingBuckets': True, 'skipDuplicates': True}
}
print(json.dumps(data))
")")
echo "${IMPORT_RESP}" | python3 -c "
import sys,json; r=json.load(sys.stdin)
res=r.get('result',{})
print(f\"Created: {res.get('created',0)}, IDs: {res.get('taskIds',[])}\")
"

TASK_IDS=$(echo "${IMPORT_RESP}" | python3 -c "
import sys,json; r=json.load(sys.stdin)
for tid in r.get('result',{}).get('taskIds',[]):
    print(tid)
")

echo ""
echo "=== Step 6: Dispatch tasks sequentially ==="
for TID in ${TASK_IDS}; do
  [ -z "${TID}" ] && continue
  echo ""
  echo "=========================================="
  TITLE=$(curl -s http://127.0.0.1:${ORGANIZER_PORT}/api/tasks/${TID} | python3 -c "import sys,json; print(json.load(sys.stdin).get('title',''))")
  echo "  TASK: ${TID} — ${TITLE}"
  echo "=========================================="

  # Dispatch — this triggers implement → review → iterate up to maxIterations
  DISP_RESP=$(curl -s -X POST http://127.0.0.1:${ORGANIZER_PORT}/api/tasks/${TID}/dispatch)
  echo "Dispatch: ${DISP_RESP}"

  POLL=0
  while true; do
    sleep 5
    POLL=$((POLL+1))
    TASK_DATA=$(curl -s http://127.0.0.1:${ORGANIZER_PORT}/api/tasks/${TID})
    STATUS=$(echo "${TASK_DATA}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))")
    ITER=$(echo "${TASK_DATA}" | python3 -c "import sys,json; t=json.load(sys.stdin); print(f\"{t.get('currentIteration',0)}/{t.get('maxIterations',0)}\")")
    echo "[poll ${POLL}] status=${STATUS} iter=${ITER}"

    case "${STATUS}" in
      completed|auto_approved)
        echo "--- ACCEPTED ---"
        break
        ;;
      failed|cancelled)
        echo "--- FAILED ---"
        echo "${TASK_DATA}" | python3 -c "import sys,json; t=json.load(sys.stdin); print('Result:', t.get('result_json',''))" 2>/dev/null
        break
        ;;
      needs_review)
        echo "--- Needs user review — auto-approving ---"
        curl -s -X POST "http://127.0.0.1:${ORGANIZER_PORT}/api/tasks/${TID}/approve" -H 'Content-Type: application/json' -d '{}'
        ;;
    esac
    if [ ${POLL} -gt 120 ]; then echo "--- TIMEOUT ---"; break; fi
  done
done

echo ""
echo "=========================================="
echo "  ALL TASKS COMPLETE"
echo "=========================================="
echo ""
echo "Final statuses:"
for TID in ${TASK_IDS}; do
  [ -z "${TID}" ] && continue
  curl -s "http://127.0.0.1:${ORGANIZER_PORT}/api/tasks/${TID}" | python3 -c "
import sys,json; t=json.load(sys.stdin)
print(f\"{t.get('title','')}: {t.get('status','')} (iter {t.get('currentIteration',0)}/{t.get('maxIterations',0)})\")
"
done

echo ""
echo "Files:"
find "${PROJECT_DIR}" -not -path '*/node_modules/*' -not -path '*/.agent/*' -type f 2>/dev/null | sort
echo "Done."