# 11. Troubleshooting

> **Sibling translation:** [11 (ES). Resolución de errores](11-troubleshooting.md).

## Requirements and installation

| Symptom | Cause and resolution |
|---|---|
| The gatekeeper says Node is missing or too old | Install Node.js 22.19.0 or later and rerun `install.sh` or `install.ps1`. |
| OS or architecture is unsupported | Releases cover macOS/Linux x64 and arm64, and Windows x64. |
| `SHA256SUMS` is invalid or does not match | Stop installation and download the assets from the same release again; do not skip verification. |
| Engines is missing or incompatible | The installer requires Engines 1.17.0 or later and `supportsReadOnly: true` for Claude Code. Workers is not installed until this requirement is met. |

## Update

`update` errors are JSON on stderr, shaped as `{ "schemaVersion": 1, "code": "UPDATE_FAILED", "error": "…" }`, and exit 1. `INVALID_ARGUMENTS` exits 2. Check connectivity, the requested tag, and that the release gatekeeper has a valid GNU `SHA256SUMS` beside it. The command then verifies the version reported by the installed launcher.

On Windows, the executable in `workers/bin/` may be in use while Atlas processes a batch. Workers parks it before updating and restores it if installation fails. If another tool keeps files locked, wait for the batch to finish and retry `update`.

## Uninstall

`uninstall` keeps Engines and reports Workers removed only after checking that `FORGE614_HOME/workers` no longer exists. Interactive cancellation exits 130 without changing files. `uninstall` is rejected when the current directory is inside `workers`; change to another directory and retry. The check resolves real paths to account for Windows short path aliases.

Failures are JSON on stderr with code `UNINSTALL_FAILED`; invalid arguments use `INVALID_ARGUMENTS`. `uninstall --self` is required by `install.mjs` and removes no files.

On Windows, `uninstall` may leave `FORGE614_HOME\.forge614-workers-old-*.exe` because the deferred PowerShell process may exit with Workers. Close Workers and its active processes, open PowerShell, and remove the parked executables with:

```powershell
Get-ChildItem -LiteralPath $env:FORGE614_HOME -Filter '.forge614-workers-old-*.exe' -File | Remove-Item -Force
```

## NDJSON batches

Batch exit codes remain `0`, `1`, `2`, and `75`; command argument errors and the new commands do not change the NDJSON event format. See [05. Errors, quotas, and exit codes](05-errors-and-quotas.en.md) for batch reasons such as `timeout`, `spawn_error`, and `generic_error`.
