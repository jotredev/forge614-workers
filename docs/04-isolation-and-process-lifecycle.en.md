# 04. Isolation, authentication, and process lifecycle

## The critical decision

Correct isolation is like providing an empty room, not removing the worker's badge. Each task gets an exclusive empty temporary `cwd`; the full parent environment is inherited unchanged. Workers never overrides `HOME`, `CODEX_HOME`, or any other variable.

Redirecting `HOME`/`CODEX_HOME` to an empty directory broke real authenticated sessions: Claude Code reported “Not logged in” and Codex returned a real 401. Identity lives in Keychain or files under the real home; the project memory that must be hidden lives in `cwd` (`CLAUDE.md`, `.claude/`, `.mcp.json`).

## Lifecycle

The prompt is written only to stdin. When `timeoutMs` expires, Workers sends `SIGTERM`, waits the configurable grace period (5 s by default), then sends `SIGKILL`. stdout and stderr are captured up to `maxOutputBytes` each. The temporary directory is deleted when the task ends.

Codex needs `--skip-git-repo-check` because an empty cwd is not a trusted repository. Claude Code needs no extra flag.

## Operational note

With the real HOME, each task may leave sessions under `~/.claude/projects/<encoded-cwd>/...` or `~/.codex/sessions/`. Workers does not clean them yet; unbounded accumulation across batches is a known operational risk, not a code defect currently fixed.
