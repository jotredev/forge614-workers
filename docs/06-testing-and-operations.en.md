# 06. Testing and operations

## Strategy

Most tests inject dependencies and simulate only expensive Claude/Codex processes. This keeps tests fast and deterministic. `engines-client.test.ts` and the registry completeness test use the real installed `forge614-engines` binary: resolving a command is cheap and does not invoke an AI. Those tests need forge614-engines 1.17.0 or later (read-only lock and `supportsReadOnly`); `FORGE614_ENGINES_BIN` points them at another binary.

## Commands

```bash
bun test
bun run typecheck
bun run build
```

`bun build --compile` produces `dist/forge614-workers`.

The binary answers `forge614-workers --version` (or `-v`), which prints `forge614-workers <version>`, and `--help` (or `-h`), which prints a short help; both exit 0 without waiting for standard input. With any other first argument it still waits for the batch on stdin. The version is read from `package.json`, the single source.

## Required coverage

- Strict ordering and immediate quota pause.
- `run_completed` on every non-fatal path.
- Timeout with `SIGTERM` followed by `SIGKILL`.
- Truncation with true byte counts.
- Empty cwd, complete environment inheritance, and temp cleanup.
- Spawn error, invalid JSON, and non-executable Engines binary.
- Registry completeness: every headless-capable Engines agent has an adapter.
- Read-only lock: a `readOnly` task without a confirmed lock launches no command.
- Validation of `readOnly` (only `true`/`false`/absent) and of the five reasoning levels.
- `--version` and `--help` without reading stdin.

Real AI CLIs must not run in the normal test suite.
