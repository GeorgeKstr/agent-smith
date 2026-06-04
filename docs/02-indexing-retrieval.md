# Indexing and Retrieval

## Index entities

- files
- tags
- file_tags
- symbols
- symbol_tags
- imports
- symbol_edges
- tasks
- edits
- test_runs

## Retrieval idea

Given a task:

1. classify into tag IDs and keywords
2. search exact text using ripgrep
3. score files by tag overlap, summary match, symbol match, graph proximity
4. choose seed symbols
5. expand graph to depth N
6. include tests and types
7. pack context within budget
8. ask model for unified diff only

## Prompt packet shape

```text
TASK
...

RULES
Return ONLY unified diff.

PROJECT TAGS
...

SELECTED FILES
...

CODE SEGMENTS
...
```
