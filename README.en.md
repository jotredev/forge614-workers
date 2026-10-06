# Forge614 Workers (`forge614-workers`)

> One-sentence analogy: Like a foreman who receives already-decided orders, hands them to one machine at a time and returns a work report: it does not design the work, it executes with isolation and reports facts.

## What it is
Forge614's non-interactive execution arm: it reads a JSON document on `stdin` with tasks already decided by Atlas, asks Forge614 Engines to resolve each one, runs Claude Code or Codex strictly in sequence and returns one NDJSON event per line on `stdout`. A task can ask for `readOnly: true` so the helper only reads; if Engines does not guarantee that lock, the task is not launched.

## What it is not
- It has no interface: the only visual interface of the ecosystem is Forge614 Shell.
- It does not detect or configure AI assistants: that is the job of Forge614 Engines.
- It is not a program to use by hand: Forge614 Atlas calls it at `~/.forge614/workers/bin/forge614-workers`.
- It is not added to PATH and does not include the Claude Code or Codex CLIs.
- It has no Windows version yet: official binaries are for macOS and Linux.

## Installation

macOS / Linux:
```bash
curl -fsSL https://github.com/jotredev/forge614-workers/releases/latest/download/install.sh | bash
```

To install a specific version: `curl -fsSL https://github.com/jotredev/forge614-workers/releases/latest/download/install.sh | bash -s -- --version v1.0.0`.

Requirements: Bash, `curl`, and a SHA-256 utility (`shasum` or `sha256sum`). It also needs Forge614 Engines 1.17.0 or newer that guarantees the read-only lock (`supportsReadOnly`): if it is missing or does not qualify, the installer installs the latest Engines before touching anything of Workers (which also needs `tar` and `node` or `python3`). If Engines still does not qualify, it installs nothing of Workers and explains how to meet it.

The binary is placed at `~/.forge614/workers/<version>/forge614-workers` and the active link at `~/.forge614/workers/bin/forge614-workers`. Workers is an internal dependency and is not added to PATH: other Forge614 products call it directly by that path.

If you set `FORGE614_HOME` (an absolute path), the installer and `update` use that folder instead of `~/.forge614`; Atlas does not read it and always looks in `~/.forge614`.

To verify: `~/.forge614/workers/bin/forge614-workers --version`.

To update: `~/.forge614/workers/bin/forge614-workers update` (it downloads the installer of the latest version and runs it with `--force`).

To restore Engines if it was removed, use `--force` or `update`.

There is no uninstall command yet: remove the `~/.forge614/workers` folder, which does not affect other products.

## Input, output and exit codes
| What | Detail |
| --- | --- |
| Input | One JSON document on `stdin` (not NDJSON): `{"enginesBin": "<path>", "tasks": [...]}` |
| Output | One NDJSON event per line on `stdout`; `run_completed` closes every non-fatal run |
| `0` | Complete batch, even with individual failures |
| `75` | Paused because the quota is exhausted |
| `2` | Invalid input, or `enginesBin` missing or not executable; no task ran |
| `1` | Unexpected error that may have happened after partial progress |

`--version`, `--help` and `update` answer without waiting for `stdin`. The full contract is in [the data contract](docs/03-data-contract.en.md).

## Documentation
| # | Español | English |
| --- | --- | --- |
| 00 | [Resumen y guía rápida](docs/00-forge614-workers.md) | [Summary and quickstart](docs/00-forge614-workers.en.md) |
| 01 | [Rol y ecosistema](docs/01-role-and-ecosystem.md) | [Role and ecosystem](docs/01-role-and-ecosystem.en.md) |
| 02 | [Arquitectura y mapa del código](docs/02-architecture-and-code-map.md) | [Architecture and code map](docs/02-architecture-and-code-map.en.md) |
| 03 | [Contrato JSON y eventos NDJSON](docs/03-data-contract.md) | [JSON contract and NDJSON events](docs/03-data-contract.en.md) |
| 04 | [Aislamiento, autenticación y ciclo de procesos](docs/04-isolation-and-process-lifecycle.md) | [Isolation, authentication, and process lifecycle](docs/04-isolation-and-process-lifecycle.en.md) |
| 05 | [Errores, cuotas y códigos de salida](docs/05-errors-and-quotas.md) | [Errors, quotas, and exit codes](docs/05-errors-and-quotas.en.md) |
| 06 | [Testing y operación](docs/06-testing-and-operations.md) | [Testing and operations](docs/06-testing-and-operations.en.md) |
| 07 | [Agregar un adapter](docs/07-adding-engine-adapter.md) | [Adding an engine adapter](docs/07-adding-engine-adapter.en.md) |
| 08 | [Índice exhaustivo de fuentes](docs/08-source-index.md) | [Exhaustive source index](docs/08-source-index.en.md) |
| 09 | [Archivos de datos](docs/09-data-files.md) | [Data files](docs/09-data-files.en.md) |
| 10 | [Instalador, actualización y publicación](docs/10-installer.md) | [Installer, update, and release](docs/10-installer.en.md) |
| 11 | [Resolución de errores](docs/11-troubleshooting.md) | [Troubleshooting](docs/11-troubleshooting.en.md) |
| 12 | [Glosario](docs/12-glossary.md) | [Glossary](docs/12-glossary.en.md) |
| Contract | [Contrato de Workers](CONTRACT.md) | [Workers contract](CONTRACT.en.md) |

Also: the [runbook for adding an adapter](docs/adding-a-new-engine-adapter.md) and the [local ↔ Notion map](docs/notion-map.json).

## Development
Requires Bun (CI uses 1.4.2).

```bash
bun test
bun run typecheck
bun run build
```

## License
All rights reserved. See [`LICENSE`](LICENSE). Vulnerabilities are reported as described in [`SECURITY.md`](SECURITY.md).
