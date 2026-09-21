# 02. Arquitectura y mapa del código

## Analogía

El sistema tiene un coordinador, un traductor, un lanzador y detectores especializados. Cada módulo tiene una frontera estrecha para que las pruebas puedan sustituir procesos costosos por dependencias inyectadas.

## Componentes

| Componente | Fuente | Función |
|---|---|---|
| Runner | `src/runner.ts` | Bucle secuencial, continuidad tras fallos, pausa por cuota y `run_completed`. |
| Engines client | `src/engines-client.ts` | Invoca `forge614-engines headless` con `--stdin-prompt` y traduce errores conocidos. |
| Process runner | `src/process-runner.ts` | `spawn`, `cwd` temporal, stdin, timeout, captura y limpieza. |
| Adapters | `src/adapters/*.ts` | Patrones de cuota y argumentos extra por motor. |
| Types | `src/types.ts` | Validación de entrada y tipos de eventos. |
| CLI/main | `src/cli.ts`, `src/main.ts` | Lee stdin, emite NDJSON y determina el exit code. |

## Secuencia por tarea

1. Emitir `task_started`.
2. Pedir a Engines el comando exacto.
3. Crear un directorio temporal vacío.
4. Ejecutar el comando con entorno heredado y prompt por stdin.
5. Aplicar timeout y límites de bytes.
6. Clasificar éxito, error, spawn, timeout o cuota.
7. Borrar el directorio temporal.
8. Continuar o detener el lote según la clasificación.

La excepción inesperada dentro de una tarea se convierte en `generic_error`; el límite exterior solo produce `fatal_error` si escapa el manejo del lote.
