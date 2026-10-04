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

The binary answers `forge614-workers --version` (or `-v`), which prints `forge614-workers <version>`, and `--help` (or `-h`), which prints a short help; both exit 0 without waiting for standard input. The binary also answers `forge614-workers update`: it downloads the `install.sh` of the latest release (`https://github.com/jotredev/forge614-workers/releases/latest/download/install.sh`) and runs it with `--force`, as `forge614-engram update` does. It is answered before stdin is read, accepts no arguments (any argument exits 2), prints one line with the previous and the new version (or that it is already up to date) and exits 1 when the download or the installer fails. With any other first argument it still waits for the batch on stdin. The version is read from `package.json`, the single source.

## Continuous integration

`.github/workflows/verify.yml` runs on every push and every pull request, on Ubuntu and macOS with Bun 1.4.2: `bun test`, `bun run typecheck` and `git diff --check`. The tests that use the real Engines receive a **pinned** Forge614 Engines 1.17.0: the workflow downloads its release, verifies its `.sha256`, checks that `capabilities --agent claude-code` reports `"supportsReadOnly": true` and points `FORGE614_ENGINES_BIN` at the binary. No test is skipped; raising that pinned version is a deliberate decision.

## Installation and release

`scripts/install.sh` installs a verified release. It checks the sha256 against `SHA256SUMS` and, **before** touching the Workers folder, makes sure a compatible Engines is present (executable, `--version` 1.17.0 or newer and `supportsReadOnly: true`); if it is missing or does not qualify, it installs the latest one with the published Engines `install.sh` and checks again, and if it still does not qualify it installs nothing of Workers. It places the binary at `$FORGE614_HOME/workers/<version>/forge614-workers` (by default `~/.forge614/workers/<version>/forge614-workers`) and atomically switches the `workers/bin/forge614-workers` link to that version; earlier versions are kept. Without `--force`, reinstalling the active version only says it is already active. It does not touch the PATH: Workers is an internal dependency that Atlas calls by the absolute path `~/.forge614/workers/bin/forge614-workers` (Atlas does not read `FORGE614_HOME`). Its tests (`scripts/__tests__/install.sh.test.ts`) use a temporary HOME and doubles of the release API and of Engines, never the real HOME.

`.github/workflows/release.yml` verifies, compiles the macOS arm64 and x64 and Linux x64 and arm64 binaries (quick check of each one: `--version` equal to `package.json` and an empty batch that ends with `run_completed`), generates `SHA256SUMS` and publishes only for a `v*` tag. It also runs, without publishing, on pull requests that touch `release.yml` or `install.sh`. Before publishing it checks that the tag matches `package.json` and that `CHANGELOG.md` has the `## <version>` entry. There is no release script: bumping the version means editing `package.json`, `CHANGELOG.md` and the version line of `docs/08` (es/en), and the `test/versions.test.ts` test requires them to agree.

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
- `--version`, `--help` and `update` without reading stdin.
- `update` with doubles (no network and no real installer): a failed download gives a clear message and a non-zero exit, the installer runs with `--force` and the downloaded file is cleaned up.

- Installer: clean install, reinstalling without `--force`, `--force`, Engines missing, old or without the lock, a sha256 mismatch and an untouched PATH.
- Versions aligned across `package.json`, `docs/08` (es/en) and `CHANGELOG.md`.

Real AI CLIs must not run in the normal test suite.
