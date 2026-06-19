# Agent Pipeline

Agent Smith uses a small-context, task-focused coding agent that reduces reasoning burden on local models by:

- Distilling messy prompts into precise task contracts (TaskPacket)
- Retrieving compact evidence instead of dumping files (RetrievalLead)
- Maintaining compressed working memory across tool calls
- Using a minimal deterministic tool set (search/read/edit/check/finish)
- Editing through controlled operations rather than full unified diffs
- Auto-compacting context when approaching token budget

## Pipeline Flow

```
User prompt
  ↓
TaskPacket (goal, criteria, constraints, keywords)
  ↓
RetrievalLeads (compact, evidence-based file scoring)
  ↓
FocusedBriefing (token-budgeted prompt, no raw code dumps)
  ↓
Agent Loop (search → read → edit → check → finish, max 12 steps)
  ↓
WorkingMemory compaction (after every 3 tool calls)
  ↓
Result (changedFiles, checksRun, finalText)
```

## Context Budgets

Budget scales automatically based on `maxPromptTokens`:

### 4K Models
| Section | Tokens |
|---------|--------|
| System prompt | 400 |
| Project rules | 300 |
| Task packet | 600 |
| File cards | 800 |
| Live code | 900 |
| Tool history | 400 |
| Output reserve | 600 |

### 8K+ Models
| Section | Tokens |
|---------|--------|
| System prompt | 700 |
| Project rules | 600 |
| Task packet | 900 |
| File cards | 1200 |
| Live code | 2500 |
| Tool history | 1000 |
| Output reserve | 1500 |

## Tools

### Read-only (ask mode)
| Tool | Description |
|------|-------------|
| `search` | Search files, symbols, summaries, and text |
| `read` | Read a narrow line window from a file |
| `finish` | End the task with a summary |

### Patch tools (patch mode)
| Tool | Description |
|------|-------------|
| `edit` | Search/replace edit in one file |
| `replace_lines` | Replace an exact line range |
| `check` | Run typecheck, test, lint, or build |

## Safety

1. All paths confined to project root
2. Edits within safety line limits (`maxPatchLines`)
3. Check output compacted to 1500 chars max
4. Context auto-compacts after 3 tool calls or at 65% token budget
5. Single-occurrence enforcement for search/replace edits

## Debugging

```bash
# See how a prompt is distilled
smith distill "fix the switching bug"

# See what files the retriever would select
smith leads "fix the switching bug"

# Preview the compact context sent to the model
smith brief "fix the switching bug"

# Create a project rules template
smith init-rules
```

## Configuration

```json
{
  "context": {
    "maxPromptTokens": 4096,
    "maxLiveCodeTokens": 1200,
    "maxToolHistoryTokens": 600,
    "maxFileCards": 8,
    "maxReadLines": 160,
    "maxSearchResults": 8,
    "compactAfterToolCalls": 3,
    "compactAtTokenRatio": 0.65
  }
}
```

Increase these values for larger models. The 8K budget preset activates automatically when `maxPromptTokens > 4096`.
