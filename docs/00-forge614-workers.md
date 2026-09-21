# Forge614 Workers — Resumen y guía rápida

> Un capataz recibe órdenes ya decididas, las entrega a una máquina cada vez y devuelve un parte de trabajo. No diseña el trabajo ni conversa con el cliente: ejecuta con aislamiento y reporta hechos.

## Qué es

`forge614-workers` es el brazo ejecutor no interactivo de Forge614. Recibe una lista JSON de tareas ya decididas por Atlas —motor, ejecutable, modelo, nivel de razonamiento y prompt—, resuelve cada comando mediante `forge614-engines` y ejecuta las tareas estrictamente en secuencia.

Consume `forge614-atlas` hoy y será consumido también por `forge614-ai` en el futuro. No habla con personas, no escribe en Engram y no conserva estado entre corridas.

## Inicio rápido

Entrada: un documento JSON único por `stdin` (no NDJSON).

```bash
cat run.json | forge614-workers
```

Salida: un evento NDJSON por línea en `stdout`. `run_completed` es la última línea de cualquier corrida no fatal.

## Límites

- No elige tareas, orden, motor ni modelo.
- No consulta capacidades para validar antes de intentar.
- No reintenta ni corrige parámetros.
- No interpreta respuestas exitosas ni reporta tokens.
- No persiste sesiones ni progreso.

## Índice

- [01. Rol y ecosistema](01-role-and-ecosystem.md)
- [02. Arquitectura y mapa del código](02-architecture-and-code-map.md)
- [03. Contrato JSON y eventos NDJSON](03-data-contract.md)
- [04. Aislamiento, autenticación y ciclo de procesos](04-isolation-and-process-lifecycle.md)
- [05. Errores, cuotas y códigos de salida](05-errors-and-quotas.md)
- [06. Testing y operación](06-testing-and-operations.md)
- [07. Agregar un adapter](07-adding-engine-adapter.md)
- [08. Índice exhaustivo de fuentes](08-source-index.md)

Las versiones en inglés conservan la misma numeración y cubren el mismo contrato.
