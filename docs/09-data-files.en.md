# 09. Data files

> **Product version:** that of `package.json`
> **Sibling translation:** [09 (ES). Archivos de datos](09-data-files.md)

## Purpose

This chapter inventories the data and configuration files that accompany Workers. The batch input JSON document and NDJSON events are defined in [03. JSON contract and NDJSON events](03-data-contract.en.md); they are not repeated here.

## `.forge614/project.json`

Portable repository identity (project and group `forge614` ids and names) that `docs/08-source-index.en.md:13` describes as the Engram identity. Workers does not read it: its entry point imports only `cli`, `updater`, and `package.json` (`src/main.ts:8-10`), and no file under `src/`, `test/`, or `scripts/` mentions it.

| Field | Type | Writer | Reader | Example |
|---|---|---|---|---|
| `schemaVersion` | number | Not recorded in this repository | Engram, per `docs/08-source-index.en.md:13`; not the Workers binary | `1` (`.forge614/project.json:2`) |
| `project` | object | Not recorded in this repository | Engram, per `docs/08-source-index.en.md:13`; not the Workers binary | Identity object (`.forge614/project.json:3-6`) |
| `project.id` | UUID text | Not recorded in this repository | Engram, per `docs/08-source-index.en.md:13`; not the Workers binary | `6b31d856-dbbd-451e-9d73-8a2782975a5f` (`.forge614/project.json:4`) |
| `project.name` | text | Not recorded in this repository | Engram, per `docs/08-source-index.en.md:13`; not the Workers binary | `forge614-workers` (`.forge614/project.json:5`) |
| `ecosystem` | object | Not recorded in this repository | Engram, per `docs/08-source-index.en.md:13`; not the Workers binary | Group object (`.forge614/project.json:7-10`) |
| `ecosystem.id` | UUID text | Not recorded in this repository | Engram, per `docs/08-source-index.en.md:13`; not the Workers binary | `e0b3e1c9-ffbb-4b6b-8a55-79fbf3e8f0b4` (`.forge614/project.json:8`) |
| `ecosystem.name` | text | Not recorded in this repository | Engram, per `docs/08-source-index.en.md:13`; not the Workers binary | `forge614` (`.forge614/project.json:9`) |

## `docs/notion-map.json`

Map between local manuals and their published pages. It does not participate in Workers execution (`src/main.ts:55-76`). Each `fingerprint` is `sha256:` plus the local manual's SHA-256 at the time it was reviewed against Notion. `reviewedProductVersion` remains `0.1.0` until those pages are published again; this documentation does not modify the map (`docs/notion-map.json:4,8-25`). It covers only manuals 00 to 08 (18 entries); 09 to 12 and `CONTRACT.md` have no entry yet. No file under `src/`, `test/`, or `scripts/` reads or writes it: it is maintained by the Notion publication flow, outside this repository.

| Field | Type | Writer | Reader | Example |
|---|---|---|---|---|
| `project` | text | External Notion publication flow (not recorded in the code) | External Notion publication flow (not recorded in the code) | `forge614-workers` (`docs/notion-map.json:2`) |
| `repository` | text | External Notion publication flow (not recorded in the code) | External Notion publication flow (not recorded in the code) | `jotredev/forge614-workers` (`docs/notion-map.json:3`) |
| `reviewedProductVersion` | semantic-version text | Publication process, when pages are reviewed | Whoever checks publication freshness | `0.1.0` (`docs/notion-map.json:4`) |
| `notionHub` | URL | External Notion publication flow (not recorded in the code) | External Notion publication flow (not recorded in the code) | Project hub URL (`docs/notion-map.json:5`) |
| `category` | text | External Notion publication flow (not recorded in the code) | External Notion publication flow (not recorded in the code) | `AI Engineer / Librerías` (`docs/notion-map.json:6`) |
| `entries` | array of objects | External Notion publication flow (not recorded in the code) | External Notion publication flow (not recorded in the code) | 18 local/remote associations (`docs/notion-map.json:7-25`) |
| `entries[].localPath` | path text | External Notion publication flow (not recorded in the code) | External Notion publication flow (not recorded in the code) | `docs/00-forge614-workers.md` (`docs/notion-map.json:8`) |
| `entries[].language` | text | External Notion publication flow (not recorded in the code) | External Notion publication flow (not recorded in the code) | `es` or `en` (`docs/notion-map.json:8-9`) |
| `entries[].notionUrl` | URL | External Notion publication flow (not recorded in the code) | External Notion publication flow (not recorded in the code) | Page URL (`docs/notion-map.json:8`) |
| `entries[].fingerprint` | `sha256:<hex>` text | External Notion publication flow (not recorded in the code) | External Notion publication flow (not recorded in the code) | `sha256:16ae…e28c` (`docs/notion-map.json:8`) |

## `package.json` and `tsconfig.json`

| File/field | Project use | Source |
|---|---|---|
| `package.json.version` | `--version`, help, and `update` read the compiled version; release compares it with the tag. | `src/main.ts:9,13,41,67`; `.github/workflows/release.yml:76-85` |
| `package.json.name`, `private`, `type` | Name `forge614-workers`; `private: true` (not published to npm); `type: "module"` (`.js` files are interpreted as ESM modules). | `package.json:2-5` |
| `package.json.devDependencies` | `typescript` (`tsc --noEmit`) and `bun-types` (Bun types). | `package.json:11-14` |
| `scripts.test` | Runs the suite with `bun test`. | `package.json:7`; `.github/workflows/verify.yml:59` |
| `scripts.typecheck` | Runs `tsc --noEmit`. | `package.json:8`; `.github/workflows/verify.yml:61` |
| `scripts.build` | Compiles `src/main.ts` into `dist/forge614-workers`. | `package.json:9` |
| `engines.node` | Declares Node `>=20` for tools that interpret the manifest; the binary is compiled with Bun. | `package.json:15-17`; `.github/workflows/release.yml:125-126` |
| `tsconfig.compilerOptions` | ES2022, ESNext modules, `bundler` resolution, strict mode, Bun types, skipped library checking, and no emission. | `tsconfig.json:2-10` |
| `tsconfig.include` | Includes `src`, `test`, and `scripts` in type checking. | `tsconfig.json:11` |

## Fake programs in `test/fixtures/`

| File | What it does | Test that uses it (exact name and file) |
|---|---|---|
| `big-output.js` | Writes the requested number of ASCII bytes. | `truncates stdout at maxOutputBytes and reports the true observed size` — `src/process-runner.test.ts:160-175` |
| `echo-stdin.js` | Returns all stdin on stdout. | `runs a command, pipes stdin, and captures stdout` — `src/process-runner.test.ts:18-32` |
| `exit-immediately.js` | Exits 0 without reading a large input. | `resolves normally when the child exits without reading stdin` — `src/process-runner.test.ts:59-77` |
| `fake-agent-echo.js` | Returns the prompt with the `echoed: ` prefix. | `runs a successful task against a fake engines binary and a fake agent, exit 0` — `test/e2e.test.ts:211-231` |
| `fake-agent-quota.js` | Writes the quota pattern and exits 1. | `stops with exit 75 when the fake agent reports quota exhaustion` — `test/e2e.test.ts:238-256` |
| `fake-engines-capabilities-no-read-only.js` | Returns capabilities without `supportsReadOnly`. | `returns false when capabilities has no supportsReadOnly field (an Engines older than 1.17.0)` — `src/engines-client.test.ts:235-239` |
| `fake-engines-capabilities-read-only-false.js` | Returns `supportsReadOnly: false`. | `returns false when capabilities says supportsReadOnly is false` — `src/engines-client.test.ts:242-249` |
| `fake-engines-headless.js` | Resolves `headless` to the requested executable; used in both E2E scenarios. | `runs a successful task against a fake engines binary and a fake agent, exit 0` and `stops with exit 75 when the fake agent reports quota exhaustion` — `test/e2e.test.ts:211-231,238-256` |
| `fake-engines-invalid-json.sh` | Prints a response that is not JSON. | `reports ENGINES_RESPONSE_INVALID instead of throwing when the binary prints non-JSON stdout` and `returns false instead of throwing when the binary prints non-JSON stdout` — `src/engines-client.test.ts:196-211,252-256` |
| `ignore-sigterm.js` | Ignores SIGTERM until the runner escalates to SIGKILL. | `kills a process that ignores SIGTERM after the grace period` — `src/process-runner.test.ts:181-193` |
| `never-reads-stdin.js` | Waits 60 seconds without reading stdin. | `timeoutMs still engages when the child never reads a large stdin payload` — `src/process-runner.test.ts:83-109` |
| `print-cwd.js` | Prints the current working directory. | `cleans up the isolated temp working directory after the process exits` — `src/process-runner.test.ts:38-53` |
| `print-env.js` | Prints the environment as JSON. | `inherits the parent process's environment completely untouched (no HOME override, no allowlisting)` — `src/process-runner.test.ts:115-154` |

## Helpers in `test/support/`

| File | What it does | Test that uses it (exact name and file) |
|---|---|---|
| `fake-update-preload.ts` | Replaces `fetch`, provides a fake installer, and records calls. | `is answered without reading stdin: downloads the latest installer and runs it with --force` — `test/e2e.test.ts:170-178`; `refuses extra arguments with exit 2 and does not download anything` — `test/e2e.test.ts:184-191` |
| `fixture-path.ts` | Turns a fixture name into an absolute path. | The seven `runProcess` tests, from `runs a command, pipes stdin, and captures stdout` through `kills a process that ignores SIGTERM after the grace period` — `src/process-runner.test.ts:18-193` |
| `resolve-engines-bin.ts` | Uses `FORGE614_ENGINES_BIN` or looks for Engines in `PATH`. | The `resolveHeadlessCommand` tests of `src/engines-client.test.ts:17-193` (the path is resolved in `beforeAll`, `:12-14`), `returns true for %s against the real forge614-engines binary` and `returns false for an agent id that Engines does not know` — `src/engines-client.test.ts:220-232`; `every agent with supportsHeadlessExec has a registered adapter` — `src/adapters/registry.completeness.test.ts:15-30` |
