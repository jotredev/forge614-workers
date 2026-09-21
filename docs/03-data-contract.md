# 03. Contrato JSON y eventos NDJSON

## Entrada

Workers recibe un único documento JSON por stdin:

```json
{"enginesBin":"/path/to/forge614-engines","maxOutputBytes":10485760,"tasks":[{"id":"task-1","agentId":"claude-code","executable":"/usr/local/bin/claude","prompt":"...","model":"claude-haiku-4-5","reasoningLevel":null,"timeoutMs":600000}]}
```

`enginesBin` es obligatorio. `maxOutputBytes` tiene default de 10 MiB y se aplica por separado a stdout y stderr de cada tarea. `id` es opaco y lo define Atlas. `model`, `reasoningLevel` y `timeoutMs` son opcionales; el timeout default es 10 minutos. Los niveles válidos son `low`, `medium` y `high`.

## Eventos

Cada línea de stdout es un objeto NDJSON. `task_completed` incluye `exitCode`, duración, texto capturado, tamaños reales y flags de truncamiento. `task_failed` añade `reason`: `timeout`, `engine_unsupported`, `spawn_error` o `generic_error`. `quota_exhausted` incluye motor y patrón coincidente. `run_completed` resume `totalTasks`, `completed`, `failed`, `notStarted`, `pausedByQuota` y duración. `fatal_error` no tiene `run_completed`.

Los tamaños son los bytes observados, incluso cuando el texto fue truncado. La detección de cuota examina stderr completo y solo los primeros 4096 bytes de stdout, independientemente del límite de captura.

## Resolución segura

Engines se invoca como `headless --agent <id> --executable <ruta> --stdin-prompt`, con `--model` y `--reasoning-level` cuando corresponda. Workers nunca pasa `--prompt`: el prompt no aparece en `argv` ni en `ps`.
