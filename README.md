# forge614-workers

Brazo ejecutor no interactivo de Forge614. Recibe un documento JSON por `stdin`, resuelve cada tarea con `forge614-engines` y ejecuta procesos Claude Code/Codex estrictamente en secuencia. Devuelve eventos NDJSON por `stdout`.

## Documentación

- [Resumen y guía rápida](docs/00-forge614-workers.md) · [English](docs/00-forge614-workers.en.md)
- [Índice exhaustivo de fuentes](docs/08-source-index.md) · [English](docs/08-source-index.en.md)
- [Runbook: agregar un adapter](docs/adding-a-new-engine-adapter.md)
- [Mapa local ↔ Notion](docs/notion-map.json)

La documentación detallada está numerada `00`–`08` y cada tema tiene versión en español e inglés. La publicación equivalente vive bajo el hub **⚒️ Forge614 Workers — Ejecución Secuencial de Tareas IA** en `AI Engineer / Librerías`.

## Desarrollo

```bash
bun test
bun run typecheck
bun run build
```
