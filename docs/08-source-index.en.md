# 08. Exhaustive source index

## Product and contracts

- `README.md`: project entry point (still minimal).
- `package.json`: version `0.1.0`, test/typecheck/build scripts, and dependencies.
- `FORGE614_ECOSYSTEM_CONTRACT.md`: cross-product boundaries and contracts.
- `docs/superpowers/specs/2026-09-20-forge614-workers-design.md`: approved specification.
- `docs/superpowers/plans/2026-09-20-forge614-workers-implementation.md`: implementation plan.

## Production code

- `src/types.ts`: input, defaults, validation, event types, and reasons.
- `src/engines-client.ts`: Engines subprocess client.
- `src/process-runner.ts`: spawn, stdin, cwd, timeout, capture, and cleanup.
- `src/runner.ts`: sequential orchestration and summary.
- `src/adapters/contract.ts`: `EngineAdapter` interface.
- `src/adapters/claude-code.ts`: Claude quota detection; no extra arguments.
- `src/adapters/codex.ts`: Codex quota detection and `--skip-git-repo-check`.
- `src/adapters/registry.ts`: adapter registry.
- `src/adapters/_template.ts`: extension template.
- `src/cli.ts`: input/output boundary and fatal errors.
- `src/main.ts`: binary entry point.
- `src/version.ts`: public version.

## Tests and fixtures

`src/**/*.test.ts` covers types, adapters, registry, Engines client, runner, process runner, CLI, and version. `test/e2e.test.ts` wires the full flow with doubles. `test/fixtures/` contains stdin echo, quota, oversized output, SIGTERM-ignoring, cwd/env printing, and fake Engines processes.

## Maintenance documentation

- `docs/adding-a-new-engine-adapter.md`: complete operational procedure.
- `docs/00`–`docs/08`: reviewed bilingual and navigable source set.
