# forge614-workers — Design Spec

Status: Approved by design review (2026-09-20). Ready for implementation planning.

## 1. Role in the ecosystem

`forge614-workers` is the execution arm of the Forge614 ecosystem, consumed today by
`forge614-atlas` and, in the future, by `forge614-ai`. Per
`FORGE614_ECOSYSTEM_CONTRACT.md` section 7, it is the "non-interactive workers" that
Atlas runs — it never writes to Engram, never talks to a human, and never decides
which tasks to run, in what order, or with which engine/model. It receives an
already-decided list of tasks and executes them.

Boundaries (non-goals):
- No TUI, no direct human interaction — JSON in, JSON out, like Engines and Engram.
- Does not query `forge614-engines capabilities` to validate a task before running
  it — that is the caller's (Atlas's) responsibility. If a task requests an
  unsupported combination (e.g. `--reasoning-level` on `claude-code`), Workers fails
  that task and moves on; it never retries with a corrected combination.
- Does not report token usage. It never interprets the successful content of an
  engine's response — only raw bytes, byte counts, and pattern matches used purely
  for quota/error detection.
- Does not persist anything between runs. No database, no resumable state. Resuming
  a paused batch is entirely the caller's responsibility (Atlas/Engram own that).

## 2. Tech stack

TypeScript on Bun, following the same convention as `forge614-engines`:
- `bun test` for tests, `tsc --noEmit` for typecheck.
- `bun build --compile` to produce a single standalone binary
  (`dist/forge614-workers`).

## 3. Architecture and components

- **`runner`** — the main loop: reads the task list from stdin, executes each task
  in strict sequential order (never parallel — an explicit ecosystem decision to
  minimize AI subscription token consumption), emits NDJSON events to stdout, and
  decides when to stop the whole batch (only on `quota_exhausted`).
- **`adapters/`** — one module per supported `agentId` (`claude-code.ts`,
  `codex.ts`, ...), each implementing the `EngineAdapter` interface below. An
  adapter never builds the OS command (that's `engines-client`'s job) — it only
  knows how to interpret failures from its own engine's CLI, and how to isolate its
  process environment.
- **`engines-client`** — invokes
  `forge614-engines headless --agent <id> --executable <ruta> --prompt <texto> [--model <m>] [--reasoning-level <n>]`
  as a subprocess to resolve `{command, args}`, and translates Engines' known
  error codes (`HEADLESS_UNSUPPORTED`, `REASONING_LEVEL_UNSUPPORTED`) into the
  `engine_unsupported` task-failure reason. If `enginesBin` does not exist or is not
  executable, this is a fatal batch-level error (see section 6).
- **`process-runner`** — actually `spawn()`s the resolved command: creates an
  isolated temp directory per task, builds a restricted `env`, writes the prompt to
  the child's stdin, enforces the per-task timeout, captures stdout/stderr up to
  `maxOutputBytes`, and cleans up the temp directory when the task ends.

### Adapter interface

```ts
interface EngineAdapter {
  agentId: string;

  // Evaluated against the full captured stderr and a fixed 4 KiB (4096 bytes)
  // prefix of stdout (independent of maxOutputBytes) to recognize a
  // quota/session-exhausted signal specific to this engine's CLI.
  detectQuotaExhausted(
    stderr: string,
    stdoutPrefix: string
  ): { matched: boolean; pattern?: string };

  // Environment variables to set/override for this engine's isolated run, beyond
  // the universal HOME override applied by process-runner (e.g. an engine-specific
  // config-dir variable). Returns {} when no extra isolation is needed.
  isolationEnv(tempDir: string): Record<string, string>;
}
```

## 4. Data contracts

### Input (stdin, single JSON document, not NDJSON)

```json
{
  "enginesBin": "/path/to/forge614-engines",
  "maxOutputBytes": 10485760,
  "tasks": [
    {
      "id": "task-1",
      "agentId": "claude-code",
      "executable": "/usr/local/bin/claude",
      "prompt": "...",
      "model": "claude-haiku-4-5",
      "reasoningLevel": null,
      "timeoutMs": 600000
    }
  ]
}
```

- `enginesBin` — required. Path to the `forge614-engines` executable.
- `maxOutputBytes` — optional, default `10485760` (10 MiB). Applied independently
  to stdout and to stderr of each task.
- Per task: `id` is opaque to Workers (Atlas defines it to correlate events with its
  own Engram sessions). `model`, `reasoningLevel`, and `timeoutMs` are optional.
  `timeoutMs` defaults to a sensible constant (10 minutes) when omitted.

### Output (NDJSON, one event per line on stdout)

- `{"event":"task_started","taskId":"task-1","agentId":"claude-code","startedAt":"..."}`
- `{"event":"task_completed","taskId":"task-1","exitCode":0,"durationMs":4213,"stdout":"...","stdoutBytes":12000345,"stdoutTruncated":true,"stderr":"...","stderrBytes":842,"stderrTruncated":false}`
- `{"event":"task_failed","taskId":"task-1","reason":"timeout"|"engine_unsupported"|"generic_error"|"spawn_error","exitCode":...,"stdout":"...","stdoutBytes":...,"stdoutTruncated":...,"stderr":"...","stderrBytes":...,"stderrTruncated":...}`
- `{"event":"quota_exhausted","taskId":"task-1","agentId":"claude-code","matchedPattern":"...","stdout":"...","stdoutBytes":...,"stdoutTruncated":...,"stderr":"...","stderrBytes":...,"stderrTruncated":...}` — always the last per-task event before `run_completed` when it occurs.
- `{"event":"run_completed","totalTasks":N,"completed":N,"failed":N,"notStarted":N,"pausedByQuota":true|false,"totalDurationMs":N}` — always emitted as the final line, on every non-fatal path (full completion or quota pause).
- `{"event":"fatal_error","reason":"invalid_input"|"engines_bin_not_found","message":"..."}` — emitted instead of any task/run_completed events when the batch cannot start at all (malformed input JSON, or `enginesBin` missing/not executable). No tasks ran.

`stdoutBytes`/`stderrBytes` report the true observed size even when truncated, so
the caller knows how much was cut.

## 5. Process isolation and lifecycle

Per task:
1. Create an exclusive, empty temp directory (`mkdtemp`) used as the child's `cwd`.
2. Build a restricted `env`: inherit `PATH` and the minimum needed from the parent
   process, set `HOME` to the temp directory as a universal baseline, then apply
   the adapter's `isolationEnv(tempDir)` on top (which may override `HOME` again or
   add engine-specific variables).
3. Deliver the prompt exclusively via the child's **stdin** — never as a CLI
   argument, so it never appears in process listings.
4. Enforce `timeoutMs`: on expiry, send `SIGTERM`, wait a short grace period (5s),
   then `SIGKILL` if still alive. Results in `task_failed` with `reason: "timeout"`.
5. Capture stdout/stderr up to `maxOutputBytes` per stream.
6. On completion (success, failure, timeout, or quota detected), delete the temp
   directory before moving to the next task. No state leaks between tasks.

## 6. Error handling and pause semantics

| `reason` | When | Pauses the batch? |
|---|---|---|
| `quota_exhausted` | The adapter detects its quota/session-exhausted pattern in stderr or the stdout prefix | **Yes** — Workers stops immediately, emits `quota_exhausted` then `run_completed`, no further tasks run |
| `timeout` | `timeoutMs` elapsed without the process exiting | No — continue to the next task |
| `engine_unsupported` | Engines returned `HEADLESS_UNSUPPORTED` or `REASONING_LEVEL_UNSUPPORTED` while resolving the command | No — continue to the next task |
| `spawn_error` | The OS failed to launch the resolved command (ENOENT, permission denied, etc.) | No — continue to the next task |
| `generic_error` | Non-zero exit code, process ran, no quota pattern matched | No — continue to the next task |

Batch-level fatal errors (nothing ran): malformed input JSON, or `enginesBin`
missing/not executable. These emit a single `fatal_error` event and skip
`run_completed` entirely.

Exit codes of the `forge614-workers` process:
- `0` — batch ran to completion (individual task failures don't change this).
- `75` — batch stopped early due to `quota_exhausted`.
- `2` — fatal error, no task ran.

## 7. Testing strategy

- **Unit tests** (`bun test`), no real AI CLI required:
  - `adapters/*.test.ts` — `detectQuotaExhausted` and `isolationEnv` against
    captured/anonymized stderr and stdout fixtures (both quota-exhausted and
    generic-error cases, to guard against false positives/negatives).
  - `process-runner.test.ts` — timeout handling (fixture script that ignores
    `SIGTERM` to exercise `SIGKILL`), `maxOutputBytes` truncation, env/cwd
    isolation and temp-dir cleanup, and `spawn_error` (nonexistent executable).
  - `runner.test.ts` — sequential ordering, immediate stop on `quota_exhausted`,
    `run_completed` emitted on every non-fatal path, and the three exit codes.
- **`engines-client.test.ts` runs against the real, installed `forge614-engines`
  binary** — never a test double. Resolving a headless command is free, fast, and
  deterministic (it never invokes an actual AI engine, only builds a command
  string), so real error cases are provoked directly: request headless on
  `cursor` for a real `HEADLESS_UNSUPPORTED`, and request `--reasoning-level` on
  `claude-code` for a real `REASONING_LEVEL_UNSUPPORTED`. Also covers the
  `enginesBin` invalid-path case.
- **Test doubles reserved only for the AI engine processes themselves**
  (Claude/Codex), since those are costly and non-deterministic: fixture scripts
  that simulate success, quota-exhausted, timeout, and generic-error behavior based
  on their stdin input.
- **Registry completeness**: a test calls `forge614-engines agents list`, filters
  to `supportsHeadlessExec: true`, and fails if any such `agentId` has no
  registered adapter in Workers (currently excludes `cursor`, which has
  `supportsHeadlessExec: false`).

Implementation follows TDD (failing test first) per ecosystem convention.

## 8. Maintenance runbook

`docs/adding-a-new-engine-adapter.md` (created during implementation) documents,
without requiring extra context, the steps to add a new adapter when Engines adds
support for a new agent:

1. Confirm via `forge614-engines agents list` that the new agent has
   `supportsHeadlessExec: true` — if `false`, no Workers adapter is needed.
2. Copy `adapters/_template.ts`, rename it to the new `agentId`.
3. Run that engine's real CLI forcing a quota/session error and record the exact
   textual pattern(s) in the adapter.
4. Register it in `adapters/registry.ts`.
5. Add `adapters/<agent>.test.ts` with quota-exhausted and generic-error fixtures.
6. Run `bun test` — the registry-completeness test (section 7) fails if the new
   agent isn't registered.

## 9. Deliverables (for the implementation plan)

- `src/runner.ts`, `src/adapters/{contract,claude-code,codex,_template,registry}.ts`,
  `src/engines-client.ts`, `src/process-runner.ts`, CLI entrypoint.
- `docs/adding-a-new-engine-adapter.md`.
- Full test suite per section 7.
- `bun build --compile` producing `dist/forge614-workers`.
