# 09. Data files

> **Product version:** `package.json`: version `1.0.0`
> **Sibling translation:** [09 (ES). Archivos de datos](09-data-files.md)

## Purpose

This chapter inventories the data and configuration files that accompany Workers. The batch input JSON document and NDJSON events are defined in [03. JSON contract and NDJSON events](03-data-contract.en.md); they are not repeated here.

## `.forge614/project.json`

Portable repository identity. Workers does not read it during a run: its entry point imports only `cli`, `updater`, and `package.json` (`src/main.ts:8-10`).

| Field | Type | Writer | Reader | Example |
|---|---|---|---|---|
| `schemaVersion` | number | The tool that registers the project | Ecosystem tools, not the Workers binary | `1` (`.forge614/project.json:2`) |
| `project` | object | The tool that registers the project | Ecosystem tools | Identity object (`.forge614/project.json:3-6`) |
| `project.id` | UUID text | The tool that registers the project | Ecosystem tools | `6b31d856-dbbd-451e-9d73-8a2782975a5f` (`.forge614/project.json:4`) |
| `project.name` | text | The tool that registers the project | Ecosystem tools | `forge614-workers` (`.forge614/project.json:5`) |
| `ecosystem` | object | The tool that registers the project | Ecosystem tools | Group object (`.forge614/project.json:7-10`) |
| `ecosystem.id` | UUID text | The tool that registers the project | Ecosystem tools | `e0b3e1c9-ffbb-4b6b-8a55-79fbf3e8f0b4` (`.forge614/project.json:8`) |
| `ecosystem.name` | text | The tool that registers the project | Ecosystem tools | `forge614` (`.forge614/project.json:9`) |

## `docs/notion-map.json`

Map between local manuals and their published pages. It does not participate in Workers execution (`src/main.ts:55-76`). Each `fingerprint` is `sha256:` plus the local manual's SHA-256 at the time it was reviewed against Notion. `reviewedProductVersion` remains `0.1.0` until those pages are published again; this documentation does not modify the map (`docs/notion-map.json:4,8-25`).

| Field | Type | Writer | Reader | Example |
|---|---|---|---|---|
| `project` | text | Documentation synchronization process | Documentation synchronization process | `forge614-workers` (`docs/notion-map.json:2`) |
| `repository` | text | Documentation synchronization process | Documentation synchronization process | `jotredev/forge614-workers` (`docs/notion-map.json:3`) |
| `reviewedProductVersion` | semantic-version text | Publication process, when pages are reviewed | Whoever checks publication freshness | `0.1.0` (`docs/notion-map.json:4`) |
| `notionHub` | URL | Documentation synchronization process | Whoever navigates or publishes documentation | Project hub URL (`docs/notion-map.json:5`) |
| `category` | text | Documentation synchronization process | Whoever classifies pages | `AI Engineer / Librerías` (`docs/notion-map.json:6`) |
| `entries` | array of objects | Documentation synchronization process | Documentation synchronization process | 18 local/remote associations (`docs/notion-map.json:7-25`) |
| `entries[].localPath` | path text | Documentation synchronization process | Process that opens the local manual | `docs/00-forge614-workers.md` (`docs/notion-map.json:8`) |
| `entries[].language` | text | Documentation synchronization process | Process that selects a language | `es` or `en` (`docs/notion-map.json:8-9`) |
| `entries[].notionUrl` | URL | Documentation synchronization process | Process that opens or updates the page | Page URL (`docs/notion-map.json:8`) |
| `entries[].fingerprint` | `sha256:<hex>` text | Synchronization process after content review | Process that detects local changes | `sha256:16ae…e28c` (`docs/notion-map.json:8`) |

## `package.json` and `tsconfig.json`

| File/field | Project use | Source |
|---|---|---|
| `package.json.version` | `--version`, help, and `update` read the compiled version; release compares it with the tag. | `src/main.ts:9,13,41,67`; `.github/workflows/release.yml:59-74` |
| `scripts.test` | Runs the suite with `bun test`. | `package.json:7`; `.github/workflows/verify.yml:53` |
| `scripts.typecheck` | Runs `tsc --noEmit`. | `package.json:8`; `.github/workflows/verify.yml:54` |
| `scripts.build` | Compiles `src/main.ts` into `dist/forge614-workers`. | `package.json:9` |
| `engines.node` | Declares Node `>=20` for tools that interpret the manifest; the binary is compiled with Bun. | `package.json:15-17`; `.github/workflows/release.yml:108-109` |
| `tsconfig.compilerOptions` | ES2022, ESNext modules, `bundler` resolution, strict mode, Bun types, skipped library checking, and no emission. | `tsconfig.json:2-10` |
| `tsconfig.include` | Includes `src`, `test`, and `scripts` in type checking. | `tsconfig.json:11` |

## Fake programs in `test/fixtures/`

| File | What it does | Test that uses it (exact name and file) |
|---|---|---|
| `big-output.js` | Writes the requested number of ASCII bytes. | `truncates stdout at maxOutputBytes and reports the true observed size` — `src/process-runner.test.ts:160-173` |
| `echo-stdin.js` | Returns all stdin on stdout. | `runs a command, pipes stdin, and captures stdout` — `src/process-runner.test.ts:18-30` |
| `exit-immediately.js` | Exits 0 without reading a large input. | `resolves normally when the child exits without reading stdin` — `src/process-runner.test.ts:59-75` |
| `fake-agent-echo.js` | Returns the prompt with the `echoed: ` prefix. | `runs a successful task against a fake engines binary and a fake agent, exit 0` — `test/e2e.test.ts:211-230` |
| `fake-agent-quota.js` | Writes the quota pattern and exits 1. | `stops with exit 75 when the fake agent reports quota exhaustion` — `test/e2e.test.ts:238-255` |
| `fake-engines-capabilities-no-read-only.js` | Returns capabilities without `supportsReadOnly`. | `returns false when capabilities has no supportsReadOnly field (an Engines older than 1.17.0)` — `src/engines-client.test.ts:235-238` |
| `fake-engines-capabilities-read-only-false.js` | Returns `supportsReadOnly: false`. | `returns false when capabilities says supportsReadOnly is false` — `src/engines-client.test.ts:242-248` |
| `fake-engines-headless.js` | Resolves `headless` to the requested executable; used in both E2E scenarios. | `runs a successful task against a fake engines binary and a fake agent, exit 0` and `stops with exit 75 when the fake agent reports quota exhaustion` — `test/e2e.test.ts:211-245` |
| `fake-engines-invalid-json.sh` | Prints a response that is not JSON. | `reports ENGINES_RESPONSE_INVALID instead of throwing when the binary prints non-JSON stdout` and `returns false instead of throwing when the binary prints non-JSON stdout` — `src/engines-client.test.ts:196,252-255` |
| `ignore-sigterm.js` | Ignores SIGTERM until the runner escalates to SIGKILL. | `kills a process that ignores SIGTERM after the grace period` — `src/process-runner.test.ts:181-192` |
| `never-reads-stdin.js` | Waits 60 seconds without reading stdin. | `timeoutMs still engages when the child never reads a large stdin payload` — `src/process-runner.test.ts:83-108` |
| `print-cwd.js` | Prints the current working directory. | `cleans up the isolated temp working directory after the process exits` — `src/process-runner.test.ts:38-51` |
| `print-env.js` | Prints the environment as JSON. | `inherits the parent process's environment completely untouched (no HOME override, no allowlisting)` — `src/process-runner.test.ts:115-148` |

## Helpers in `test/support/`

| File | What it does | Test that uses it (exact name and file) |
|---|---|---|
| `fake-update-preload.ts` | Replaces `fetch`, provides a fake installer, and records calls. | `is answered without reading stdin: downloads the latest installer and runs it with --force` — `test/e2e.test.ts:170-177` |
| `fixture-path.ts` | Turns a fixture name into an absolute path. | The seven `runProcess` tests, from `runs a command, pipes stdin, and captures stdout` through `kills a process that ignores SIGTERM after the grace period` — `src/process-runner.test.ts:18-192` |
| `resolve-engines-bin.ts` | Uses `FORGE614_ENGINES_BIN` or looks for Engines in `PATH`. | `returns true for %s against the real forge614-engines binary`, `returns false for an agent id that Engines does not know`, and `every agent with supportsHeadlessExec has a registered adapter` — `src/engines-client.test.ts:220-230`; `src/adapters/registry.completeness.test.ts:15-17` |
