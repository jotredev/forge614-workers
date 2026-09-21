# 07. Adding an engine adapter

The full runbook is [`adding-a-new-engine-adapter.md`](adding-a-new-engine-adapter.md). An adapter is a per-engine boundary: it recognizes quota/session exhaustion in stderr or the first 4 KiB of stdout and supplies extra arguments for an isolated cwd.

1. Confirm with `forge614-engines agents list` that the agent has `supportsHeadlessExec: true`.
2. Copy `src/adapters/_template.ts` to `src/adapters/<agentId>.ts`.
3. With the real CLI and an authenticated session, force a quota error and record exact patterns.
4. In the same step test the CLI in an empty directory with isolated cwd; never assume authentication works by analogy.
5. Add `extraArgs()` only when the CLI needs a documented flag, such as Codex's `--skip-git-repo-check`.
6. Register the adapter in `src/adapters/registry.ts`.
7. Add quota and generic-error tests; run `bun test`.

Never invent a credential-moving mechanism. If isolation fails, document the evidence and investigate it separately.
