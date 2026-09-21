# Adding a new engine adapter

When `forge614-engines` adds support for a new agent, follow these steps to
add a matching adapter to `forge614-workers`. No extra context should be
needed beyond this document.

1. Confirm via `forge614-engines agents list` that the new agent has
   `supportsHeadlessExec: true`. If it is `false`, no Workers adapter is
   needed — Workers can never invoke that agent headlessly.
2. Copy `src/adapters/_template.ts` to `src/adapters/<agentId>.ts`.
3. Run that engine's real CLI, force a quota/session-exhausted error, and
   record the exact textual pattern(s) it prints (to stderr, or to the start
   of stdout) in the new adapter's `QUOTA_PATTERN`(s). **At this same step,
   with a real, already-authenticated session, also verify authentication
   survives Workers' isolation**: run the CLI with its `cwd` set to a fresh,
   empty temp directory (Workers never overrides `HOME`, `CODEX_HOME`, or
   any other config/session environment variable — only `cwd` is isolated)
   and confirm it authenticates and responds normally. Do not assume this
   works by analogy with Claude Code or Codex — verify it for real, for this
   specific CLI, every time. If authentication fails, the new adapter may
   need `extraArgs()` to add a flag (as Codex's does for
   `--skip-git-repo-check`, required because Workers' isolated `cwd` is
   never a directory the CLI already trusts) — but do not guess at an
   undocumented mechanism for extracting or relocating the CLI's stored
   credentials; report the exact failure and treat it as its own
   investigation before proceeding.
4. If the CLI needs extra CLI flags to run correctly in a fresh, untrusted
   working directory (e.g. Codex's `--skip-git-repo-check`), add them in the
   adapter's `extraArgs()`.
5. Register the new adapter in `src/adapters/registry.ts` (add it to the
   `adapters` array).
6. Add `src/adapters/<agentId>.test.ts` with fixtures for both a real
   quota-exhausted case and a generic, unrelated error (to guard against
   false positives).
7. Run `bun test` — `src/adapters/registry.completeness.test.ts` fails if
   the new agent isn't registered.
