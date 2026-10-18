# 06. Testing and operations

## Strategy

Most tests inject dependencies and simulate only expensive Claude/Codex processes. This keeps tests fast and deterministic. `engines-client.test.ts` and the registry completeness test use the real installed `forge614-engines` binary: resolving a command is cheap and does not invoke an AI. Those tests need forge614-engines 1.17.0 or later (read-only lock and `supportsReadOnly`); `FORGE614_ENGINES_BIN` points them at another binary.

## Commands

```bash
bun test
bun run typecheck
bun run build
```

`bun build --compile` produces `dist/forge614-workers`. Releases use `bun run build:target` and `bun run smoke:target` with `FORGE614_TARGET`.

`--version`, `--version --json`, `update [--version X.Y.Z] [--json]`, and `uninstall [--json|--self]` are handled before reading stdin. Management commands emit JSON in `--json` mode and use stable error codes. Windows x64 uses direct process termination on timeout; the test that requires ignoring SIGTERM runs on Unix only.

## Continuous integration

`.github/workflows/verify.yml` verifies Ubuntu and Windows with Bun 1.4.2 and pins Forge614 Engines 1.17.0 for integration tests. Windows is tested in CI only, not on a physical machine.

## Installation and release

`install.sh` and `install.ps1` gatekeepers download and verify `install.mjs`, the pointer, and binaries declared by `forge614.node.json`. Node.js 22.19.0 is required. The installer checks Engines before installing Workers; Windows publishes a copied `.exe` in `workers/bin/`, while Unix uses a link. E2E tests use temporary `HOME` and `FORGE614_HOME` directories and a loopback server.

`.github/workflows/release.yml` compiles five native binaries (macOS/Linux x64 and arm64, Windows x64), runs `smoke:target`, prepares ten assets, and publishes only the tag matching `package.json` with `release:publish`.

## Required coverage

- Strict ordering and immediate quota pause.
- `run_completed` on every non-fatal path.
- Timeout escalates to forced termination; the ignored-`SIGTERM` case is Unix-only.
- Truncation with true byte counts.
- Empty cwd, complete environment inheritance, and temp cleanup.
- Spawn error, invalid JSON, and non-executable Engines binary.
- Registry completeness: every headless-capable Engines agent has an adapter.
- Read-only lock: a `readOnly` task without a confirmed lock launches no command.
- Validation of `readOnly` (only `true`/`false`/absent) and of the five reasoning levels.
- `--version --json`, `update` with a local checksummed gatekeeper, and `uninstall` with Engines left intact.
- Install/update/uninstall E2E through loopback-only test servers and temporary homes.
- Windows x64 install, update from the active executable, and uninstall in CI.
- Absolute `FORGE614_HOME` honoured and relative rejected.
- Versions aligned across `package.json`, `docs/08` (es/en) and `CHANGELOG.md`.

Real AI CLIs must not run in the normal test suite.
