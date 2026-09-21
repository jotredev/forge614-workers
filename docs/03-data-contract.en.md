# 03. JSON contract and NDJSON events

## Input

Workers receives one JSON document on stdin:

```json
{"enginesBin":"/path/to/forge614-engines","maxOutputBytes":10485760,"tasks":[{"id":"task-1","agentId":"claude-code","executable":"/usr/local/bin/claude","prompt":"...","model":"claude-haiku-4-5","reasoningLevel":null,"timeoutMs":600000}]}
```

`enginesBin` is required. `maxOutputBytes` defaults to 10 MiB and applies independently to stdout and stderr for each task. `id` is opaque and owned by Atlas. `model`, `reasoningLevel`, and `timeoutMs` are optional; the default timeout is 10 minutes. Valid levels are `low`, `medium`, and `high`.

## Events

Each stdout line is an NDJSON object. `task_completed` includes `exitCode`, duration, captured text, true sizes, and truncation flags. `task_failed` adds `reason`: `timeout`, `engine_unsupported`, `spawn_error`, or `generic_error`. `quota_exhausted` includes the engine and matched pattern. `run_completed` summarizes `totalTasks`, `completed`, `failed`, `notStarted`, `pausedByQuota`, and duration. `fatal_error` has no `run_completed`.

Sizes are observed byte counts even when text is truncated. Quota detection examines full stderr and only the first 4096 bytes of stdout, independently of the capture limit.

## Safe resolution

Engines is invoked as `headless --agent <id> --executable <path> --stdin-prompt`, with `--model` and `--reasoning-level` when applicable. Workers never passes `--prompt`: the prompt never appears in `argv` or `ps`.
