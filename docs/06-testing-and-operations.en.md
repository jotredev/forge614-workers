# 06. Testing and operations

## Strategy

Most tests inject dependencies and simulate only expensive Claude/Codex processes. This keeps tests fast and deterministic. `engines-client.test.ts` and the registry completeness test use the real installed `forge614-engines` binary: resolving a command is cheap and does not invoke an AI.

## Commands

```bash
bun test
bun run typecheck
bun run build
```

`bun build --compile` produces `dist/forge614-workers`.

## Required coverage

- Strict ordering and immediate quota pause.
- `run_completed` on every non-fatal path.
- Timeout with `SIGTERM` followed by `SIGKILL`.
- Truncation with true byte counts.
- Empty cwd, complete environment inheritance, and temp cleanup.
- Spawn error, invalid JSON, and non-executable Engines binary.
- Registry completeness: every headless-capable Engines agent has an adapter.

Real AI CLIs must not run in the normal test suite.
