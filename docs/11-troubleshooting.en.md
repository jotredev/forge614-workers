# 11. Troubleshooting

> **Product version:** that of `package.json`
> **Sibling translation:** [11 (ES). Resolución de errores](11-troubleshooting.md)

## Purpose

This guide starts from the messages and branches Workers executes. The event contract is in [03](03-data-contract.en.md) and the short classification in [05](05-errors-and-quotas.en.md).

## Binary exit codes

| Code | Symptom or cause | What to do |
|:---:|---|---|
| `0` | The run reached its end; it may contain `task_failed` events. Successful `--version`, `--help`, and `update` also use it (`src/cli.ts:70-71`; `src/main.ts:57-71`). | Read the events; do not treat 0 as success for every task. |
| `1` | `fatal_error` with `unexpected_error`, or a failed `update` (`src/cli.ts:72-80`; `src/updater.ts:153-156`). | Keep the full `message` of the `fatal_error` event; if the `1` came from `update`, use the matching row in "`update` failures". |
| `2` | Invalid input, non-executable `enginesBin`, or extra `update` arguments (`src/cli.ts:31-58`; `src/updater.ts:139-143`). | Fix the document or run `update` without arguments. |
| `75` | A task exhausted quota (`quota_exhausted`) and the batch stopped there; it exits 75 even when no task was left unstarted (`notStarted` can be 0) (`src/cli.ts:70-71`; `src/runner.ts:265-267,333-341`). | Resume through the batch producer when quota returns: repeat the task of the `quota_exhausted` event (it did not finish) and the tasks that did not start; do not repeat completed tasks. |

## Task failures and Engines responses

| Symptom or code | Cause in code | What to do |
|---|---|---|
| `reason: "timeout"` | `timeoutMs` expired; the process receives SIGTERM and then SIGKILL if needed (`src/process-runner.ts:149-172`; `src/runner.ts:228-241`). | Increase `timeoutMs` or reduce the work; keep stdout/stderr and truncation flags. |
| `reason: "spawn_error"` | The system could not start the resolved command (`src/process-runner.ts:103-119`; `src/runner.ts:211-225`). | Check that `executable` exists and is executable, and that Engines resolves a valid path. |
| `reason: "generic_error"` | Non-zero exit without a quota pattern, unclassified Engines rejection, or task exception (`src/runner.ts:178-197,247-296,313-328`). | Read `stderr`; it preserves the original Engines code or process message. |
| `reason: "engine_unsupported"` | Engines returned `HEADLESS_UNSUPPORTED`, `REASONING_LEVEL_UNSUPPORTED`, or `READ_ONLY_UNSUPPORTED`, or read-only could not be confirmed (`src/runner.ts:129-146,178-183`). | Change the requested capability or update Engines; do not retry the unchanged combination. |
| `ENGINES_RESPONSE_INVALID` | `headless` did not print JSON or lacked both `headless` and `error`; Workers reports it as `task_failed` with `generic_error` and keeps up to 200 stdout characters in the message (`src/engines-client.ts:84-104`; `src/runner.ts:178-184`). | Run Engines manually with the same identifiers and update it if the response breaks the contract. |
| `HEADLESS_UNSUPPORTED` | Engines says the agent cannot run headlessly; Workers classifies it as `engine_unsupported` (`src/runner.ts:161-183`). | Select an agent that supports headless execution. |
| `REASONING_LEVEL_UNSUPPORTED` | The level exists in Workers but that agent does not support it; it becomes `engine_unsupported` (`src/types.ts:8,182-189`; `src/runner.ts:178-183`). | Choose a level Engines accepts for that agent or omit `reasoningLevel`. |
| `READ_ONLY_UNSUPPORTED` | Engines returned it or `capabilities` did not confirm exactly `supportsReadOnly: true`; no command runs (`src/engines-client.ts:128-146`; `src/runner.ts:126-146,178-183`). | Use Engines 1.17.0 or newer and inspect `capabilities --agent <id>`. |
| `INVALID_REASONING_LEVEL` | Engines did not accept the level sent. Workers only sends one of the five allowed values (`src/types.ts:8,182-189`), so this happens when that agent does not support it; Workers preserves it in `stderr` and classifies it as `generic_error` (`src/types.ts:5-6`; `src/runner.ts:178-184`). | Choose another of the five levels or omit `reasoningLevel` for that agent. |
| `UNKNOWN_AGENT` | Engines does not know `agentId`; without `readOnly` it becomes `generic_error`; with `readOnly` the capabilities check returns `false` first and the task ends as `engine_unsupported` with `READ_ONLY_UNSUPPORTED` (`src/runner.ts:129-146,178-183`; `src/engines-client.test.ts:228-232`). | Correct `agentId` using identifiers published by Engines. |
| `quota_exhausted` | The process exited non-zero and the adapter found a pattern in captured stderr or the first 4096 captured stdout bytes (`src/runner.ts:247-280`; `src/adapters/contract.ts:26-27`). | Wait for quota, then resume the event's task and the tasks that did not start; the run already emitted `run_completed`. |

The four possible `task_failed` reasons are `timeout`, `engine_unsupported`, `spawn_error`, and `generic_error` (`src/types.ts:48-53`).

## Input and fatal errors

| Symptom | Cause | What to do |
|---|---|---|
| `fatal_error`, `invalid_input` | Broken JSON; root that is not an object (`null` included); `enginesBin` missing, empty, or not text; `tasks` missing or not an array; `maxOutputBytes` or `timeoutMs` that do not convert to a positive number; task that is not an object; `id`, `agentId`, `executable`, or `prompt` missing, empty, or not text; unsupported `reasoningLevel`; non-boolean `readOnly` (`src/types.ts:125-208`). | Fix input using [03](03-data-contract.en.md); every task is validated before any starts. |
| `fatal_error`, `engines_bin_not_found` | `accessSync(..., X_OK)` rejected `enginesBin` (`src/cli.ts:46-58`). | Use an existing executable file path. |
| `fatal_error`, `unexpected_error` | Something escaped the batch boundary, including event-output failure (`src/cli.ts:63-80`). | Keep the message and inspect the caller's output system. |
| Truncated output | The process wrote more than `maxOutputBytes`; `bytes` keeps the total and `truncated` is `true` (`src/process-runner.ts:69-88`). | Raise the limit for full text; use `bytes` for the true size. |

## Installer messages

Every message below exits 1 through `fail` (`scripts/install.sh:21-22`), except `HOME must be set` and the last row, which do not go through `fail`.

| Exact message or prefix | Cause (`file:line`) | What to do |
|---|---|---|
| `The Engines installer override is reserved for test fixtures.` | Installer override set without `FORGE614_WORKERS_INSTALLER_TEST=1` (`scripts/install.sh:80-81`). | Remove test variables in normal use. |
| `The Engines test installer must be a local file URL.` | Override does not start with `file:///` (`scripts/install.sh:82-84`). | Use a valid local URL only in tests. |
| `Could not download the Forge614 Engines installer. Forge614 Workers was not installed.` | Engines installer `curl` failed (`scripts/install.sh:87-90`). | Check network, TLS, and URL; install or update Engines separately. |
| `Forge614 Engines could not be installed. Forge614 Workers was not installed.` | Downloaded installer exited non-zero (`scripts/install.sh:91-92`). | Run and diagnose the Engines installer. |
| `Forge614 Engines is still missing or older than 1.17.0, or does not guarantee the read-only lock. Forge614 Workers was not installed.` | Post-install compatibility check still failed (`scripts/install.sh:93-94`). | Install Engines 1.17.0 or newer and require `supportsReadOnly: true` for `claude-code`. |
| `The Forge614 home must be a real directory, not a link.` | `FORGE614_HOME` is a link or exists as a non-directory (`scripts/install.sh:102-103`). | Select a real directory. |
| `The Workers installation folder must be a real directory, not a link.` | `<home>/workers` is a link or non-directory (`scripts/install.sh:104-105`). | Remove the conflicting object and create a real directory. |
| `The Workers bin folder must be a real directory, not a link.` | `<home>/workers/bin` is a link or non-directory (`scripts/install.sh:106-107`). | Remove the conflicting object and create a real directory. |
| `The active command path is a directory; remove it and run the installer again.` | Active command path is, or points to, a directory (`scripts/install.sh:108`). | Remove that directory and retry. |
| `The active command exists and is not a link. Use --force to replace it explicitly.` | A regular active file exists and `--force` was not passed (`scripts/install.sh:109-110`). | Inspect it and use `--force` only if replacement is intended. |
| `Specify one tag for --version.` | The value is missing, the value is empty, or `--version` appeared more than once (`scripts/install.sh:125`). | Provide exactly one tag. |
| `Specify a valid tag for --version.` | Value starts with `--` (`scripts/install.sh:126`). | Use a tag such as `v1.0.0`. |
| `Unknown option. See: bash scripts/install.sh --help` | Unsupported option (`scripts/install.sh:131`). | Read `--help`. |
| `Invalid release tag. Use a semantic version tag such as v1.2.3.` | Tag fails the semantic expression (`scripts/install.sh:135-137`). | Correct the tag. |
| `FORGE614_HOME must be an absolute path.` | Effective path is relative (`scripts/install.sh:140-143`). | Use an absolute path or unset the variable. |
| `HOME must be set` (bash prints it as `<script>: line 142: HOME: HOME must be set`) | Neither `FORGE614_HOME` nor `HOME` has a non-empty value; the `:?` expansion stops the shell with exit 1 without going through `fail` (`scripts/install.sh:142`). | Set one of them; if using `FORGE614_HOME`, it must be absolute. |
| `Unsupported operating system or architecture. Supported: macOS x64/arm64 and Linux x64/arm64.` | OS/architecture pair is absent from the table (`scripts/install.sh:149-156`). | Install on a published platform. |
| `curl is required to download a release.` | `curl` is absent from `PATH` (`scripts/install.sh:158-159`). | Install `curl`. |
| `A SHA-256 command is required: shasum or sha256sum.` | No digest tool was found (`scripts/install.sh:160-166`). | Install one of them. |
| `The release endpoint override is reserved for test fixtures.` | Test endpoint set without the guard (`scripts/install.sh:180-181`). | Remove it in normal use. |
| `The test release endpoint must be a loopback HTTP URL with an explicit numeric port.` | Test endpoint is not local or lacks a valid port (`scripts/install.sh:182-184`). | Use `http://127.0.0.1:<port>` or `http://localhost:<port>`. |
| `Could not download release metadata.` | `release.json` download failed (`scripts/install.sh:237-238`). | Check network, release, and temporary permissions. |
| `The release metadata does not carry a valid version tag.` | `tag_name` is missing or not semantic (`scripts/install.sh:239-241`). | Correct release metadata. |
| `The release is missing SHA256SUMS.` | There is not exactly one URL ending in `SHA256SUMS` (`scripts/install.sh:251-252`). | Publish one manifest. |
| `The release is missing the <artifact> binary.` | There is not exactly one URL for the platform binary (`scripts/install.sh:253`). | Publish the expected artifact. |
| `Release metadata contains an unsafe test fixture URL.` | A test-server asset does not point to allowed loopback (`scripts/install.sh:254-256`). | Correct both fixture URLs. |
| `Release assets must use HTTPS URLs.` | In normal use, the manifest URL does not start with `https://` (the manifest/binary string is checked joined, `scripts/install.sh:258`); a non-HTTPS binary URL is not caught here and fails later as `Could not download <artifact>.` because `curl` only allows HTTPS. | Publish HTTPS assets. |
| `Could not download SHA256SUMS.` | Manifest download failed (`scripts/install.sh:261-264`). | Check the asset and network. |
| `Could not download <artifact>.` | Binary download failed (`scripts/install.sh:264`). | Check the asset and network. |
| `SHA256SUMS does not contain one valid digest for <artifact>.` | There is not exactly one line with 64 lowercase hexadecimal digits and an equal name (`scripts/install.sh:265-268`). | Regenerate the manifest. |
| `Checksum verification failed for <artifact>.` | Calculated digest differs (`scripts/install.sh:269-274`). | Do not install; republish or redownload. |
| `Could not create the Workers installation folders.` | `mkdir` for `workers` or `bin` failed (`scripts/install.sh:281-282`). | Fix permissions and path type. |
| `Could not create the Workers version folder.` | Version-folder `mkdir` failed (`scripts/install.sh:283-284`). | Fix permissions or path conflict. |
| System error without a project prefix | `mktemp`, `cp`, `chmod`, `mv`, `ln`, or cleanup failed under `set -e`; the script exits with the code of the failing command (normally 1) (`scripts/install.sh:7,189-205,285-299`). | Use the operation and path named on stderr to fix permissions, space, or file type; the trap removes temporary state it managed to register. |

## `update` failures

| Message | Cause | What to do |
|---|---|---|
| `forge614-workers update takes no arguments.` | Any argument followed `update` (`src/updater.ts:139-142`). | Run only `forge614-workers update`. |
| `Could not download the Forge614 Workers installer.` | HTTP response was not successful (`src/updater.ts:72-80`). | Check connectivity and the `latest` release. |
| `The Forge614 Workers installer failed; the installed version was not confirmed.` | Installer exited non-zero (`src/updater.ts:107-111`). | Read inherited installer output and resolve its message. |
| `The installed Forge614 Workers did not report a valid version.` | Installed command did not print `forge614-workers X.Y.Z[...]` (`src/updater.ts:50-62`). | Reinstall and manually check `--version`. |
| `Could not update forge614-workers: <detail>` | Common boundary for download, launch, installer, or version-read failure (`src/updater.ts:153-156`). | Treat `<detail>` as the primary cause; the temporary installer was removed (`src/updater.ts:115-117`), unless writing it failed (`src/updater.ts:70`). |
