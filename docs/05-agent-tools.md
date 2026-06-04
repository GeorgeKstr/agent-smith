# Agent Tools

The model should see very few tools.

## Model-facing tools

- request_context(query)
- request_file(path)
- request_symbol(name)
- submit_patch(unified_diff)
- request_check(name)
- finish(summary)

## Program-internal systems

- scanner
- watcher
- SQLite index
- tree-sitter parser
- graph builder
- retriever
- context packer
- Ollama client
- patch validator
- git apply runner
- check runner
- reindexer
- task memory
