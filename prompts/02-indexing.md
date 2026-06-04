Continue Agent Smith.

Implement Stage 2 and Stage 3.

Stage 2:
- Add global numeric tag map.
- Add Ollama file summarization.
- Add Ollama file tagging.
- Cache summaries/tags by file hash.
- Store summaries/tags in SQLite.
- Add background summary queue with concurrency 1.
- Show tag/summary progress in the TUI.

Stage 3:
- Add tree-sitter support for TypeScript, JavaScript, JSON, and Python.
- Extract symbols:
  - functions
  - classes
  - methods
  - exported symbols
  - TypeScript types/interfaces
  - obvious React components
- Store symbols in SQLite.
- Preserve symbol summaries if symbol hash is unchanged.
- Extract local imports.
- Add basic import graph.
- Implement inspect and graph commands.

Keep the TUI responsive.
Do not implement patching yet.
