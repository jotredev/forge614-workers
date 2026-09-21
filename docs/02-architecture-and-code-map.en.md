# 02. Architecture and code map

## Analogy

The system has a coordinator, a translator, a launcher, and specialized detectors. Each module has a narrow boundary so tests can replace expensive processes with injected dependencies.

## Components

| Component | Source | Function |
|---|---|---|
| Runner | `src/runner.ts` | Sequential loop, continuation after failures, quota pause, and `run_completed`. |
| Engines client | `src/engines-client.ts` | Invokes `forge614-engines headless` with `--stdin-prompt` and maps known errors. |
| Process runner | `src/process-runner.ts` | `spawn`, temporary `cwd`, stdin, timeout, capture, and cleanup. |
| Adapters | `src/adapters/*.ts` | Quota patterns and per-engine extra arguments. |
| Types | `src/types.ts` | Input validation and event types. |
| CLI/main | `src/cli.ts`, `src/main.ts` | Reads stdin, emits NDJSON, and chooses the exit code. |

## Per-task sequence

1. Emit `task_started`.
2. Ask Engines for the exact command.
3. Create an empty temporary directory.
4. Run the command with the inherited environment and prompt on stdin.
5. Apply timeout and byte limits.
6. Classify success, error, spawn, timeout, or quota.
7. Delete the temporary directory.
8. Continue or stop the batch according to the classification.

An unexpected exception inside a task becomes `generic_error`; the outer boundary emits `fatal_error` only if it escapes batch handling.
