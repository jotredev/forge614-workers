# Workers contract (`forge614-workers`)

Contract version: the product version (`package.json`). Translation: [CONTRACT.md](CONTRACT.md).

## Purpose

Workers sequentially executes a JSON batch of non-interactive tasks, resolves every command through Engines, and returns NDJSON events (`src/main.ts:13-29`; `src/runner.ts:108-116,333-344`).

## What it does

- Validates the full document and applies 10 MiB per stream and 10 minutes per task when those limits are absent (`src/types.ts:109-112,125-153,177`).
- Asks Engines for a `headless` command and sends the prompt over stdin, not arguments. It requires text `error.code` and `error.message`, or text `headless.command` and a text-array `headless.args`; malformed responses return `ENGINES_RESPONSE_INVALID` (`src/engines-client.ts:43-128`; `src/runner.ts:149-209,204-205`).
- Runs each task in an empty temporary directory, inherits the environment, and removes the directory afterward (`src/process-runner.ts:99-119,174-177`).
- Captures stdout and stderr with true counts, truncation, and timeout (`src/process-runner.ts:50-88,141-173`).
- Detects quota through the registered adapter and stops the batch with `quota_exhausted` (`src/runner.ts:247-280`).
- Ensures a `readOnly` task never starts without Engines confirmation (`src/runner.ts:126-146`).
- Offers `--version`, `--help`, `update`, and `uninstall` without reading stdin (`src/main.ts:55-76`).

## What it does not do

- Does not choose tasks, agents, models, or levels: it validates or forwards input values (`src/types.ts:165-208`; `src/engines-client.ts:73-76`).
- Does not run tasks in parallel: it uses one loop with an `await` per task (`src/runner.ts:108-116,149-209`).
- Does not retry failures or post-quota tasks: it launches each task once and, after `quota_exhausted`, starts none of the following ones (`src/runner.ts:109-116,265-281`).
- Does not persist sessions or results: its modules open no database; events go to `writeLine` (`src/cli.ts:60-68`). The agents it launches may leave their own sessions under the real `HOME`, which Workers does not clean (see [04](docs/04-isolation-and-process-lifecycle.en.md)).
- Does not add its folder to `PATH`; the pointer declares `path.modify: false` (`forge614.node.json:29`).
- The temporary directory is not environment or disk isolation; it only changes `cwd` (`src/process-runner.ts:99-111`).

## Dependencies

| Dependency | Consumption | Requirement |
|---|---|---|
| Engines | `enginesBin` for `headless` and, for `readOnly`, `capabilities --agent <id>` | Installer requires 1.17.0 or newer and `supportsReadOnly: true` for `claude-code` (`forge614.node.json:1-35`). |
| Bun | Builds the binary and runs repository tests and tools | CI pins 1.4.2 (`.github/workflows/verify.yml:24-26`). |
| Operating system | Processes, signals, and temporary directories | macOS and Linux x64/arm64; Windows x64. On Windows, timeout uses direct process termination (`src/process-runner.ts:147-164`). |

## Public commands

| Command | Input | Output | Exit codes |
|---|---|---|---|
| `forge614-workers` | One JSON document on stdin; see [03](docs/03-data-contract.en.md) | One JSON event per line | `0`, `1`, `2`, `75` (`src/cli.ts:18-80`) |
| `forge614-workers --version`, `-v` | Must be the first argument; optional `--json` | Text `forge614-workers <version>` or JSON identity | `0`; extra arguments `2` (`src/main.ts:32-43,57-62`) |
| `forge614-workers --help`, `-h` | Must be the first argument | Text help | `0` (`src/main.ts:12-43,57-62`) |
| `forge614-workers update [--version X.Y.Z] [--json]` | Optional tag; latest release when omitted | Actual installed version; optional JSON; JSON errors on stderr | `0`, `1`, `2` (`src/updater.ts:1-60`) |
| `forge614-workers uninstall [--json]` | Confirms in an interactive terminal; never removes Engines | Reports `removed` only after checking that Workers was deleted | `0`, `1`, `2`, cancellation `130` (`src/uninstall.ts:1-90`) |
| `forge614-workers uninstall --self [--json]` | Removes no Workers integrations | JSON `integrationsRemoved: true` | `0` (`src/uninstall.ts:45-50`) |

## Development and release commands

- `bun run verify`: typecheck, tests, and pointer validation.
- `bun run build:target`: builds the target selected by `FORGE614_TARGET`.
- `bun run smoke:target`: runs `--version` on the binary built for that target.
- `bun run release:publish`: publishes the ten prepared assets to the GitHub release.

## Exit codes

| Code | Meaning |
|:---:|---|
| `0` | Completed run, including failed tasks; or successful information/update command. |
| `1` | Unexpected fatal error or failed update. |
| `2` | Invalid input or command arguments; non-executable Engines. |
| `130` | Uninstall confirmation was canceled. |
| `75` | Batch paused by quota. |

Management commands emit stable JSON in `src/updater.ts` and `src/uninstall.ts`; the batch NDJSON contract stays in `src/cli.ts`.

## Error codes and failure reasons

| Code or reason | Meaning |
|---|---|
| `invalid_input` | Document or task fails validation (`src/types.ts:125-208`). |
| `engines_bin_not_found` | `enginesBin` is missing or non-executable (`src/cli.ts:46-58`). |
| `unexpected_error` | Exception outside the per-task boundary (`src/cli.ts:63-80`). |
| `ENGINES_RESPONSE_INVALID` | Unreadable JSON or malformed `headless` response; `error` requires text `code` and `message`, and `headless` requires text `command` and a text-array `args` (`src/engines-client.ts:84-123`). |
| `HEADLESS_UNSUPPORTED` | Agent does not support headless execution; `engine_unsupported` (`src/runner.ts:178-183`). |
| `REASONING_LEVEL_UNSUPPORTED` | Agent does not support that level; `engine_unsupported` (`src/runner.ts:178-183`). |
| `READ_ONLY_UNSUPPORTED` | Engines does not guarantee read-only; `engine_unsupported` (`src/runner.ts:126-146,178-183`). |
| `timeout` | Task timeout expired (`src/runner.ts:228-241`). |
| `spawn_error` | Command could not start (`src/runner.ts:211-225`). |
| `generic_error` | Other rejection, non-zero exit without quota, or task exception (`src/runner.ts:178-197,283-328`). |
| `quota_exhausted` | Non-zero exit with quota pattern; stops the batch (`src/runner.ts:247-280`). |

## Compatibility

Input has no `schemaVersion`; compatibility is defined by the fields accepted by `parseRunInput` (`src/types.ts:125-208`). Events also have no version and form the closed `TaskEvent` union (`src/types.ts:55-107`): removing or changing fields is incompatible for NDJSON consumers. Optional text fields `readableDir` and `model` with the wrong type are omitted, but invalid `readOnly` rejects the full batch (`src/types.ts:156-163,192-207`).

The installer and release cover macOS and Linux x64/arm64, and Windows x64. Windows is tested in CI only, not on a physical Windows machine (`forge614.node.json:1-35`; `.github/workflows/release.yml`).
