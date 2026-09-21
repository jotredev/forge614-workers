# 05. Errors, quotas, and exit codes

## Classification

| Result | Condition | Stops batch? |
|---|---|---|
| `quota_exhausted` | Non-zero exit and adapter detects a quota/session pattern | Yes |
| `timeout` | Timeout expires | No |
| `engine_unsupported` | Engines returns `HEADLESS_UNSUPPORTED` or `REASONING_LEVEL_UNSUPPORTED` | No |
| `spawn_error` | OS cannot launch the executable | No |
| `generic_error` | Any other rejection, non-zero exit, or task exception | No |

A process with exit code 0 is never quota-exhausted even if its text mentions limits. On quota, later tasks do not start and `run_completed` is emitted.

## Binary exit codes

- `0`: batch completed, including individual task failures.
- `75`: paused because quota was exhausted.
- `2`: invalid JSON or missing/non-executable `enginesBin`; no task ran.
- `1`: unexpected `fatal_error` that may follow partial progress.

## Diagnosis

Keep `stderr` and true observed sizes. For generic Engines rejections, the original code is preserved in the task event's `stderr`. Do not turn failures into automatic retries: Atlas decides how to resume.
