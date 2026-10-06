# 12. Glossary

> **Product version:** that of `package.json`
> **Sibling translation:** [12 (ES). Glosario](12-glossary.md)

## Terms

| Term | Definition and location |
|---|---|
| **Adapter** | Agent-specific rules for detecting quota and adding execution arguments. It implements `EngineAdapter` and is selected by `agentId` (`src/adapters/contract.ts:10-23`; `src/adapters/registry.ts:6-15`). |
| **Batch** | A `RunInput`: Engines path, output limit, and ordered tasks. The runner visits them sequentially and emits final `run_completed` unless a fatal error occurs (`src/types.ts:38-46`; `src/runner.ts:108-116,333-344`). |
| **Child process** | Program that runs a task with the Engines command, Engines plus adapter arguments, prompt on stdin, and inherited environment (`src/runner.ts:200-209`; `src/process-runner.ts:103-136`). |
| **Engines** | Binary named by `enginesBin`; Workers uses it to resolve `headless` and query `capabilities` when read-only must be confirmed (`src/engines-client.ts:44-79,128-146`). |
| **Event** | Output object describing start, completion, failure, quota, summary, or fatal error. The closed set is `TaskEvent` (`src/types.ts:55-107`). |
| **Failure reason** | `reason` field of `task_failed`: `timeout`, `engine_unsupported`, `spawn_error`, or `generic_error` (`src/types.ts:48-53,70-81`). |
| **`FORGE614_HOME`** | Installation root. The installer uses its non-empty absolute value or `$HOME/.forge614`; `update` uses the same default without validating relative paths (`scripts/install.sh:140-147`; `src/updater.ts:36-47`). |
| **Headless** | Resolution of a command for non-interactive execution. Workers requests `headless --agent … --executable … --stdin-prompt` and then runs the answer (`src/engines-client.ts:58-79`; `src/runner.ts:149-209`). |
| **NDJSON** | Output format: one serialized JSON object per line. `runCli` applies `JSON.stringify` to every event before passing it to `writeLine` (`src/cli.ts:60-68`). |
| **Quota** | Limit an adapter recognizes only after a non-zero process exit. A match produces `quota_exhausted`, stops the batch, and leaves later tasks not started (`src/runner.ts:247-280,333-341`). |
| **Readable folder** | `readableDir`: extra folder Workers forwards to Engines as `--readable-dir`; it grants access and does not itself enable the read-only lock (`src/types.ts:23-24`; `src/engines-client.ts:75`). |
| **Read-only** | `readOnly: true` requires Engines to confirm `supportsReadOnly: true` before resolving or launching the task. Otherwise Workers emits `engine_unsupported` with `READ_ONLY_UNSUPPORTED` (`src/runner.ts:126-146`). |
| **SHA-256 digest** | Hexadecimal summary the installer uses to ensure the downloaded binary matches `SHA256SUMS`. There must be exactly one 64-character lowercase entry for the artifact (`scripts/install.sh:261-274`). |
| **Task** | Batch unit with `id`, `agentId`, `executable`, `prompt`, access/model/reasoning options, and timeout (`src/types.ts:13-36`). |
| **Temporary working directory** | New empty folder in which a task runs. It is created under the system temporary folder and always removed; it changes `cwd` but does not isolate the environment or the rest of the disk (`src/process-runner.ts:99-106,174-177`). |
| **Timeout** | Result when the process exceeds `timeoutMs`; SIGTERM is sent, the grace period is observed, and SIGKILL may follow. The task fails but the batch continues (`src/process-runner.ts:149-172`; `src/runner.ts:228-242`). |
| **Truncation** | Keeping only the first `maxOutputBytes` of each stream while `bytes` counts everything observed. `truncated` marks incomplete text (`src/process-runner.ts:50-88`). |
