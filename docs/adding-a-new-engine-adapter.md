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
   of stdout) in the new adapter's `QUOTA_PATTERN`(s).
4. If the CLI reads its config/session state from an environment variable
   other than `HOME`, add it in the adapter's `isolationEnv(tempDir)`.
5. Register the new adapter in `src/adapters/registry.ts` (add it to the
   `adapters` array).
6. Add `src/adapters/<agentId>.test.ts` with fixtures for both a real
   quota-exhausted case and a generic, unrelated error (to guard against
   false positives).
7. Run `bun test` — `src/adapters/registry.completeness.test.ts` fails if
   the new agent isn't registered.
