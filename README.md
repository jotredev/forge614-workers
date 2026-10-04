# Forge614 Workers (`forge614-workers`)

> Analogía en una frase: Como un capataz que recibe órdenes ya decididas, las entrega a una máquina cada vez y devuelve un parte de trabajo: no diseña el trabajo, ejecuta con aislamiento y reporta hechos.

## Qué es
El brazo ejecutor no interactivo de Forge614: lee un documento JSON por `stdin` con tareas ya decididas por Atlas, resuelve cada una con Forge614 Engines, ejecuta Claude Code o Codex estrictamente en secuencia y devuelve un evento NDJSON por línea en `stdout`. Una tarea puede pedir `readOnly: true` para que el ayudante solo lea; si Engines no garantiza ese candado, la tarea no se lanza.

## Qué no es
- No tiene interfaz: la única interfaz visual del ecosistema es Forge614 Shell.
- No detecta ni configura asistentes de IA: eso es tarea de Forge614 Engines.
- No es un programa para usar a mano: lo llama Forge614 Atlas por la ruta `~/.forge614/workers/bin/forge614-workers`.
- No se agrega al PATH y no incluye el CLI de Claude Code ni el de Codex.
- No tiene versión para Windows todavía: los binarios oficiales son para macOS y Linux.

## Instalación

macOS / Linux:
```bash
curl -fsSL https://github.com/jotredev/forge614-workers/releases/latest/download/install.sh | bash
```

Requisitos: Bash, `curl` y una utilidad SHA-256 (`shasum` o `sha256sum`). Además necesita Forge614 Engines 1.17.0 o posterior: si falta o es anterior, el instalador instala la última versión antes de tocar nada de Workers. Si algún requisito no se puede cumplir, no instala nada y explica cómo cumplirlo.

El binario queda en `~/.forge614/workers/<versión>/forge614-workers` y el enlace activo en `~/.forge614/workers/bin/forge614-workers`. Workers es una dependencia interna y no se agrega al PATH: otros productos de Forge614 lo llaman directamente por esa ruta.

Para verificar: `~/.forge614/workers/bin/forge614-workers --version`.

Para actualizar: `~/.forge614/workers/bin/forge614-workers update` (descarga el instalador de la última versión y lo ejecuta con `--force`).

## Entrada, salida y códigos de salida
| Qué | Detalle |
| --- | --- |
| Entrada | Un documento JSON único por `stdin` (no NDJSON): `{"enginesBin": "<ruta>", "tasks": [...]}` |
| Salida | Un evento NDJSON por línea en `stdout`; `run_completed` cierra toda corrida no fatal |
| `0` | Lote completo, incluso con fallos individuales |
| `75` | Pausa por cuota agotada |
| `2` | Entrada inválida o `enginesBin` inexistente o no ejecutable; ninguna tarea corrió |
| `1` | Error inesperado que pudo ocurrir después de un progreso parcial |

`--version` y `--help` responden sin esperar `stdin`. El contrato completo está en [el contrato de datos](docs/03-data-contract.md).

## Documentación
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

Además: el [runbook para agregar un adapter](docs/adding-a-new-engine-adapter.md) y el [mapa local ↔ Notion](docs/notion-map.json).

## Desarrollo
```bash
bun test
bun run typecheck
bun run build
```

## Licencia
Todos los derechos reservados. Ver [`LICENSE`](LICENSE). Las vulnerabilidades se reportan según [`SECURITY.md`](SECURITY.md).
