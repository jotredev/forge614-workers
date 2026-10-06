# 12. Glosario

> **Versión del producto:** la de `package.json`
> **Traducción hermana:** [12 (EN). Glossary](12-glossary.en.md)

## Términos

| Término | Definición y ubicación |
|---|---|
| **Adaptador** | Reglas propias de un asistente para detectar cuota y agregar argumentos de ejecución. Cumple `EngineAdapter` y se obtiene por `agentId` (`src/adapters/contract.ts:10-23`; `src/adapters/registry.ts:6-15`). |
| **Carpeta de trabajo temporal** | Carpeta nueva y vacía donde corre una tarea. Se crea bajo la carpeta temporal del sistema y se borra siempre; cambia `cwd`, pero no aísla el entorno ni el resto del disco (`src/process-runner.ts:99-106,174-177`). |
| **Carpeta legible** | `readableDir`: carpeta adicional que Workers reenvía a Engines como `--readable-dir`; concede acceso y no activa por sí sola el candado de solo lectura (`src/types.ts:23-24`; `src/engines-client.ts:75`). |
| **Cuota** | Límite que un adaptador reconoce solo cuando el proceso salió distinto de cero. La coincidencia produce `quota_exhausted`, corta el lote y deja las tareas posteriores como no iniciadas (`src/runner.ts:247-280,333-341`). |
| **Engines** | Binario indicado por `enginesBin`; Workers lo usa para resolver `headless` y consultar `capabilities` cuando necesita confirmar solo lectura (`src/engines-client.ts:44-79,128-146`). |
| **Evento** | Objeto de salida que describe inicio, final, fallo, cuota, resumen o error fatal. El conjunto cerrado está en `TaskEvent` (`src/types.ts:55-107`). |
| **`FORGE614_HOME`** | Carpeta raíz de la instalación. El instalador usa su valor absoluto no vacío o `$HOME/.forge614`; `update` usa el mismo default sin validar rutas relativas (`scripts/install.sh:140-147`; `src/updater.ts:36-47`). |
| **Headless / sin interfaz** | Resolución de un comando para ejecución no interactiva. Workers pide `headless --agent … --executable … --stdin-prompt` y luego ejecuta la respuesta (`src/engines-client.ts:58-79`; `src/runner.ts:149-209`). |
| **Huella SHA-256** | Resumen hexadecimal usado por el instalador para comprobar que el binario descargado coincide con `SHA256SUMS`. Debe haber exactamente una entrada minúscula de 64 caracteres para el artefacto (`scripts/install.sh:261-274`). |
| **Lote** | Un `RunInput`: ruta de Engines, tope de salida y tareas ordenadas. El ejecutor las recorre secuencialmente y emite un `run_completed` final si no hay error fatal (`src/types.ts:38-46`; `src/runner.ts:108-116,333-344`). |
| **NDJSON** | Formato de salida: un objeto JSON serializado por línea. `runCli` aplica `JSON.stringify` a cada evento antes de entregarlo a `writeLine` (`src/cli.ts:60-68`). |
| **Proceso hijo** | Programa que ejecuta una tarea con el comando de Engines, argumentos de Engines más los del adaptador, prompt por stdin y entorno heredado (`src/runner.ts:200-209`; `src/process-runner.ts:103-136`). |
| **Razón de fallo** | Campo `reason` de `task_failed`: `timeout`, `engine_unsupported`, `spawn_error` o `generic_error` (`src/types.ts:48-53,70-81`). |
| **Solo lectura** | `readOnly: true` exige que Engines confirme `supportsReadOnly: true` antes de resolver o lanzar la tarea. Si no, Workers emite `engine_unsupported` con `READ_ONLY_UNSUPPORTED` (`src/runner.ts:126-146`). |
| **Tarea** | Unidad de un lote con `id`, `agentId`, `executable`, `prompt`, opciones de acceso/modelo/razonamiento y tiempo límite (`src/types.ts:13-36`). |
| **Tiempo agotado** | Resultado cuando el proceso rebasa `timeoutMs`; se envía SIGTERM, se espera la gracia y puede enviarse SIGKILL. La tarea falla, pero el lote continúa (`src/process-runner.ts:149-172`; `src/runner.ts:228-242`). |
| **Truncamiento** | Conservación de solo los primeros `maxOutputBytes` de cada salida, mientras `bytes` cuenta todo lo observado. `truncated` indica que el texto quedó incompleto (`src/process-runner.ts:50-88`). |
