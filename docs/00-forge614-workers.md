# Forge614 Workers — Resumen y guía rápida

> Un capataz recibe órdenes ya decididas, las entrega a una máquina cada vez y devuelve un parte de trabajo. No diseña el trabajo ni conversa con el cliente: ejecuta con aislamiento y reporta hechos.

## Qué es

`forge614-workers` es el brazo ejecutor no interactivo de Forge614. Recibe una lista JSON de tareas ya decididas por Atlas —motor, ejecutable, modelo, nivel de razonamiento, si es de solo lectura (`readOnly`) y prompt—, resuelve cada comando mediante `forge614-engines` y ejecuta las tareas estrictamente en secuencia.

Consume `forge614-atlas` hoy y será consumido también por `forge614-ai` en el futuro. No habla con personas, no escribe en Engram y no conserva estado entre corridas.

## Inicio rápido

Entrada: un documento JSON único por `stdin` (no NDJSON).

```bash
cat run.json | forge614-workers
```

Salida: un evento NDJSON por línea en `stdout`. `run_completed` es la última línea de cualquier corrida no fatal.

`forge614-workers --version` imprime la versión, `--version --json` devuelve su identidad legible por máquina, `update` actualiza el binario y `uninstall` lo retira sin borrar Engines. Ninguna de estas órdenes espera `stdin`.

Instalación macOS/Linux: `curl -fsSL https://github.com/jotredev/forge614-workers/releases/latest/download/install.sh | bash`. En Windows x64 descarga `install.ps1` y ejecútalo con PowerShell `-NoProfile -ExecutionPolicy Bypass -File install.ps1`. Se requiere Node.js 22.19.0 o posterior. Windows se prueba solo en CI. El binario queda en `~/.forge614/workers/bin/forge614-workers`; más detalles en [06](06-testing-and-operations.md) y el [README](../README.md).

## Límites

- No elige tareas, orden, motor ni modelo.
- No consulta capacidades para validar antes de intentar, salvo para confirmar el candado de solo lectura cuando una tarea pide `readOnly`.
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
- [09. Archivos de datos](09-data-files.md)
- [10. Instalador, actualización y publicación](10-installer.md)
- [11. Resolución de errores](11-troubleshooting.md)
- [12. Glosario](12-glossary.md)
- [Contrato de Workers](../CONTRACT.md)

Las versiones en inglés conservan la misma numeración y cubren el mismo contrato.
