Continue Agent Smith.

Implement Stage 4 and Stage 5.

Stage 4:
- Task classification prompt.
- Classify task into tag IDs, keywords, likely files, likely symbols, needs_tests, needs_types.
- Retrieval scoring:
  - ripgrep exact hits
  - tag overlap
  - summary match
  - symbol match
  - graph proximity
  - related tests
  - task memory
- Graph expansion to configured depth.
- Token-budgeted context packet builder.
- Context preview in TUI.
- Implement `agent-smith ask`.

Stage 5:
- Generate patch as unified diff only.
- Validate diff format.
- Reject forbidden paths.
- Reject edits outside project root.
- Run `git apply --check`.
- Apply patch.
- Reindex changed files immediately.
- Run configured checks.
- Repair loop with max 2 retries.
- Implement `agent-smith patch`.

Do not let the model run arbitrary shell commands.
