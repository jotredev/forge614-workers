# 04. Isolation, authentication, and process lifecycle

## The critical decision

Correct isolation is like providing an empty room, not removing the worker's badge. Each task gets an exclusive empty temporary `cwd`; the full parent environment is inherited unchanged. Workers never overrides `HOME`, `CODEX_HOME`, or any other variable.

Redirecting `HOME`/`CODEX_HOME` to an empty directory broke real authenticated sessions: Claude Code reported “Not logged in” and Codex returned a real 401. Identity lives in Keychain or files under the real home; the project memory that must be hidden lives in `cwd` (`CLAUDE.md`, `.claude/`, `.mcp.json`).

## Read-only lock

A task with `readOnly: true` is like lending someone a book they may read but not write in. `readableDir` is not a substitute for the lock: it adds a folder the helper can reach but does not stop writing there; `readOnly` is what stops writing. Workers does not build that lock: Engines does, with `--read-only`, differently for each agent. Claude Code gets only the reading tools (`Read`, `Grep`, `Glob`), in the permission mode that denies everything else instead of asking, and loads none of the user's MCP connections. Codex gets its read-only sandbox requested explicitly and is launched without reading its `config.toml`, so it has no MCP either. That way the helper cannot write files or save to Engram.

Because an Engines older than 1.17.0 would ignore `--read-only` without saying so, Workers checks before running that `capabilities` reports `supportsReadOnly: true` for that agent. If it cannot confirm it, nothing runs (see `05`).

## Lifecycle

The prompt is written only to stdin. When `timeoutMs` expires, Workers sends `SIGTERM`, waits the configurable grace period (5 s by default), then sends `SIGKILL`. stdout and stderr are captured up to `maxOutputBytes` each. The temporary directory is deleted when the task ends.

Codex needs `--skip-git-repo-check` because an empty cwd is not a trusted repository. Claude Code needs no extra flag.

## Operational note

With the real HOME, each task may leave sessions under `~/.claude/projects/<encoded-cwd>/...` or `~/.codex/sessions/`. Workers does not clean them yet; unbounded accumulation across batches is a known operational risk, not a code defect currently fixed.
