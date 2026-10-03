# 03. JSON contract and NDJSON events

## Input

Workers receives one JSON document on stdin:

```json
{"enginesBin":"/path/to/forge614-engines","maxOutputBytes":10485760,"tasks":[{"id":"task-1","agentId":"claude-code","executable":"/usr/local/bin/claude","prompt":"...","model":"claude-haiku-4-5","reasoningLevel":null,"timeoutMs":600000}]}
```

`readableDir` and `readOnly` are also optional. `readableDir` is a folder the helper may read in addition to its empty working folder; Workers only forwards it to Engines as `--readable-dir` and ignores it when it is not a string. It grants access, it does not make anything read-only: `readOnly` is what stops writing. `readOnly` accepts only `true`, `false`, or absent (any other type fails the whole batch with `fatal_error`; it is never dropped silently). With `readOnly: true` Workers forwards `--read-only` to `headless`, but first asks Engines (`capabilities --agent <id>`, once per agent in each batch) whether `supportsReadOnly` is `true`. If Engines does not guarantee it (field absent, `false`, an error, or an invalid answer), the task fails as `engine_unsupported` with `READ_ONLY_UNSUPPORTED` in `stderr` and no command runs. Without `readOnly` Workers asks nothing.

`enginesBin` is required. `maxOutputBytes` defaults to 10 MiB and applies independently to stdout and stderr for each task. `id` is opaque and owned by Atlas. `model`, `reasoningLevel`, and `timeoutMs` are optional; the default timeout is 10 minutes. The levels Workers accepts are the five Engines knows: `low`, `medium`, `high`, `xhigh`, and `max`; any other text fails the whole batch with `fatal_error` (`invalid_input`). Workers does not decide which level each agent admits: Engines validates it, and a level the agent does not accept comes back as `INVALID_REASONING_LEVEL` (see `05`).

## Events

Each stdout line is an NDJSON object. `task_completed` includes `exitCode`, duration, captured text, true sizes, and truncation flags. `task_failed` adds `reason`: `timeout`, `engine_unsupported`, `spawn_error`, or `generic_error`. `quota_exhausted` includes the engine and matched pattern. `run_completed` summarizes `totalTasks`, `completed`, `failed`, `notStarted`, `pausedByQuota`, and duration. `fatal_error` has no `run_completed`.

Sizes are observed byte counts even when text is truncated. Quota detection examines full stderr and only the first 4096 bytes of stdout, independently of the capture limit.

## Safe resolution

Engines is invoked as `headless --agent <id> --executable <path> --stdin-prompt`, with `--model`, `--reasoning-level`, `--readable-dir`, and `--read-only` when applicable. Workers never passes `--prompt`: the prompt never appears in `argv` or `ps`.
