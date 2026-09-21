# Forge614 Workers — Summary and quickstart

> A foreman receives already-decided orders, gives them to one machine at a time, and returns a work report. It does not design the work or talk to the customer: it executes with isolation and reports facts.

## What it is

`forge614-workers` is Forge614's non-interactive execution arm. It receives a JSON list of tasks already decided by Atlas —engine, executable, model, reasoning level, and prompt— asks `forge614-engines` to resolve each command, and runs tasks strictly sequentially.

Atlas consumes it today; `forge614-ai` will consume it in the future. It does not talk to people, write to Engram, or retain state between runs.

## Quickstart

Input is one JSON document on `stdin`, not NDJSON:

```bash
cat run.json | forge614-workers
```

Output is one NDJSON event per line on `stdout`. `run_completed` is the final line of every non-fatal run.

## Boundaries

- Does not choose tasks, order, engine, or model.
- Does not preflight capabilities.
- Does not retry or repair parameters.
- Does not interpret successful responses or report tokens.
- Does not persist sessions or progress.

## Index

- [01. Role and ecosystem](01-role-and-ecosystem.en.md)
- [02. Architecture and code map](02-architecture-and-code-map.en.md)
- [03. JSON contract and NDJSON events](03-data-contract.en.md)
- [04. Isolation, authentication, and process lifecycle](04-isolation-and-process-lifecycle.en.md)
- [05. Errors, quotas, and exit codes](05-errors-and-quotas.en.md)
- [06. Testing and operations](06-testing-and-operations.en.md)
- [07. Adding an engine adapter](07-adding-engine-adapter.en.md)
- [08. Exhaustive source index](08-source-index.en.md)
