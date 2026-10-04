# 08. Exhaustive source index

## Product and contracts

- `README.md` and `README.en.md`: project entry point (what it is, installation, input/output and documentation) in Spanish and English.
- `package.json`: version `1.0.0`, test/typecheck/build scripts, and dependencies.
- `tsconfig.json`: strict typing of `src`, `test` and `scripts`.
- `CHANGELOG.md`: version history (one `## <version>` entry per release).
- `LICENSE` and `SECURITY.md`: license and security policy.
- `scripts/install.sh`: verified installer (sha256, compatible Engines, version folder and active link).
- `.github/workflows/verify.yml` and `.github/workflows/release.yml`: verification on every push and PR, and binary publication.
- `FORGE614_ECOSYSTEM_CONTRACT.md`: cross-product boundaries and contracts.
- `.forge614/project.json`: portable Engram identity of the project (project id and the `forge614` group).
- `docs/superpowers/specs/2026-09-20-forge614-workers-design.md`: approved specification.
- `docs/superpowers/plans/2026-09-20-forge614-workers-implementation.md`: implementation plan.

## Production code

- `src/types.ts`: input, defaults, validation, event types, and reasons.
- `src/engines-client.ts`: Engines subprocess client (`headless` and `capabilities`).
- `src/process-runner.ts`: spawn, stdin, cwd, timeout, capture, and cleanup.
- `src/runner.ts`: sequential orchestration and summary.
- `src/adapters/contract.ts`: `EngineAdapter` interface.
- `src/adapters/claude-code.ts`: Claude quota detection; no extra arguments.
- `src/adapters/codex.ts`: Codex quota detection and `--skip-git-repo-check`.
- `src/adapters/registry.ts`: adapter registry.
- `src/adapters/_template.ts`: extension template.
- `src/cli.ts`: input/output boundary and fatal errors.
- `src/updater.ts`: `update` command (downloads the installer of the latest release and runs it with `--force`, with injectable download and process).
- `src/main.ts`: binary entry point; answers `--version`/`--help`/`update` before reading stdin and takes the version from `package.json`.

## Tests and fixtures

`src/**/*.test.ts` covers types, adapters, registry, Engines client, runner, process runner, and CLI. `src/updater.test.ts` covers `update` with doubles. `scripts/__tests__/install.sh.test.ts` tests the installer with a temporary HOME. `test/versions.test.ts` requires aligned versions. `test/e2e.test.ts` wires the full flow with doubles and checks `--version`, `--help` and `update` (with `test/support/fake-update-preload.ts`). `test/fixtures/` contains stdin echo, quota, oversized output, SIGTERM-ignoring, cwd/env printing, and fake Engines processes.

## Maintenance documentation

- `docs/adding-a-new-engine-adapter.md`: complete operational procedure.
- `docs/00`–`docs/08`: reviewed bilingual and navigable source set.
- `docs/notion-map.json`: local ↔ Notion map with the sha256 fingerprint of each manual.
