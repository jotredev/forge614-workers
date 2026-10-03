# 03. Contrato JSON y eventos NDJSON

## Entrada

Workers recibe un único documento JSON por stdin:

```json
{"enginesBin":"/path/to/forge614-engines","maxOutputBytes":10485760,"tasks":[{"id":"task-1","agentId":"claude-code","executable":"/usr/local/bin/claude","prompt":"...","model":"claude-haiku-4-5","reasoningLevel":null,"timeoutMs":600000}]}
```

Ejemplo de tarea de solo lectura: `{"id":"task-2","agentId":"codex","executable":"/usr/local/bin/codex","prompt":"...","readOnly":true}`.

`readableDir` y `readOnly` también son opcionales. `readableDir` es una carpeta a la que el ayudante (el proceso del agente que corre la tarea) tiene acceso además de su carpeta de trabajo vacía; Workers solo la reenvía a Engines como `--readable-dir` y la ignora si no es texto. Es un permiso de acceso, no de solo lectura: lo que impide escribir es `readOnly`. `readOnly` solo admite `true`, `false` o ausente (cualquier otro tipo hace fallar todo el lote con `fatal_error` (`invalid_input`, exit code 2), nunca se descarta en silencio). Con `readOnly: true` Workers reenvía `--read-only` a `headless`, pero antes pregunta a Engines (`capabilities --agent <id>`, una vez por agente en cada lote) si `supportsReadOnly` es `true`. Si no lo garantiza (campo ausente, `false`, error o respuesta inválida), la tarea falla como `engine_unsupported` con `READ_ONLY_UNSUPPORTED` en `stderr` y no se corre ninguna orden. Sin `readOnly` (o con `false`) Workers no hace la consulta de `capabilities`.

`enginesBin` es obligatorio. `maxOutputBytes` tiene default de 10 MiB y se aplica por separado a stdout y stderr de cada tarea. `id` es opaco y lo define Atlas. `model`, `reasoningLevel` y `timeoutMs` son opcionales; el timeout default es 10 minutos. Los niveles que Workers acepta son los cinco de Engines: `low`, `medium`, `high`, `xhigh` y `max`; cualquier otro valor hace fallar todo el lote con `fatal_error` (`invalid_input`). Workers no decide qué nivel admite cada motor: lo valida Engines, y un nivel que el motor no acepta vuelve como `INVALID_REASONING_LEVEL` (ver `05`).

## Eventos

Cada línea de stdout es un objeto NDJSON. `task_completed` incluye `exitCode`, duración, texto capturado, tamaños reales y flags de truncamiento. `task_failed` añade `reason`: `timeout`, `engine_unsupported`, `spawn_error` o `generic_error`. `quota_exhausted` incluye motor y patrón coincidente. `run_completed` resume `totalTasks`, `completed`, `failed`, `notStarted`, `pausedByQuota` y duración. `fatal_error` no tiene `run_completed`.

Los tamaños son los bytes observados, incluso cuando el texto fue truncado. La detección de cuota examina stderr completo y solo los primeros 4096 bytes de stdout, independientemente del límite de captura.

## Resolución segura

Engines se invoca como `headless --agent <id> --executable <ruta> --stdin-prompt`, con `--model`, `--reasoning-level`, `--readable-dir` y `--read-only` cuando corresponda. Workers nunca pasa `--prompt`: el prompt no aparece en `argv` ni en `ps`.
