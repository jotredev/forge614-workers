# 11. Resolución de errores

> **Versión del producto:** `package.json`: versión `1.0.0`
> **Traducción hermana:** [11 (EN). Troubleshooting](11-troubleshooting.en.md)

## Propósito

Esta guía parte de los mensajes y ramas que ejecuta Workers. El contrato de eventos está en [03](03-data-contract.md) y la clasificación resumida en [05](05-errors-and-quotas.md).

## Códigos de salida del binario

| Código | Síntoma o causa | Qué hacer |
|:---:|---|---|
| `0` | La corrida llegó al final; puede contener tareas `task_failed`. También lo usan `--version`, `--help` y `update` exitoso (`src/cli.ts:70-71`; `src/main.ts:57-71`). | Lee los eventos, no interpretes 0 como éxito de todas las tareas. |
| `1` | `fatal_error` con `unexpected_error`, o fallo de `update` (`src/cli.ts:72-80`; `src/updater.ts:153-156`). | Conserva el mensaje completo; revisa la fila correspondiente de esta guía. |
| `2` | Entrada inválida, `enginesBin` no ejecutable o argumentos extra de `update` (`src/cli.ts:31-58`; `src/updater.ts:139-143`). | Corrige el documento o ejecuta `update` sin argumentos. |
| `75` | Una tarea agotó cuota y quedaron tareas sin iniciar (`src/cli.ts:70-71`; `src/runner.ts:265-280,333-341`). | Reanuda desde quien construye el lote cuando vuelva a haber cuota; no repitas las tareas ya completadas. |

## Fallos de tarea y respuestas de Engines

| Síntoma o código | Causa en el código | Qué hacer |
|---|---|---|
| `reason: "timeout"` | Venció `timeoutMs`; el proceso recibe SIGTERM y después SIGKILL si no termina (`src/process-runner.ts:149-184`; `src/runner.ts:228-241`). | Aumenta `timeoutMs` o reduce el trabajo; conserva stdout/stderr y sus flags de truncamiento. |
| `reason: "spawn_error"` | El sistema no pudo iniciar el comando resuelto (`src/process-runner.ts:103-119`; `src/runner.ts:211-225`). | Comprueba que `executable` exista y tenga permisos, y que Engines resuelva una ruta válida. |
| `reason: "generic_error"` | Salida distinta de cero sin patrón de cuota, rechazo de Engines no clasificado o excepción dentro de la tarea (`src/runner.ts:178-197,247-296,313-328`). | Lee `stderr`: conserva el código original de Engines o el mensaje del proceso. |
| `reason: "engine_unsupported"` | Engines devolvió `HEADLESS_UNSUPPORTED`, `REASONING_LEVEL_UNSUPPORTED` o `READ_ONLY_UNSUPPORTED`, o no pudo confirmarse solo lectura (`src/runner.ts:129-146,178-183`). | Cambia la capacidad solicitada o actualiza Engines; no reintentes la misma combinación sin cambiarla. |
| `ENGINES_RESPONSE_INVALID` | `headless` no imprimió JSON o no trajo `headless` ni `error`; Workers guarda hasta 200 caracteres del stdout (`src/engines-client.ts:83-101`). | Ejecuta Engines manualmente con los mismos identificadores y actualízalo si su respuesta no cumple el contrato. |
| `HEADLESS_UNSUPPORTED` | Engines indica que el asistente no admite ejecución sin interfaz; Workers lo clasifica como `engine_unsupported` (`src/runner.ts:161-183`). | Elige un asistente con ejecución sin interfaz. |
| `REASONING_LEVEL_UNSUPPORTED` | El nivel existe para Workers, pero ese asistente no lo admite; queda como `engine_unsupported` (`src/types.ts:8,182-189`; `src/runner.ts:178-183`). | Elige un nivel que Engines acepte para ese asistente o omite `reasoningLevel`. |
| `READ_ONLY_UNSUPPORTED` | Engines lo devolvió o `capabilities` no confirmó exactamente `supportsReadOnly: true`; el comando no se ejecuta (`src/engines-client.ts:117-146`; `src/runner.ts:126-146,178-183`). | Usa Engines 1.17.0 o posterior y verifica `capabilities --agent <id>`. |
| `INVALID_REASONING_LEVEL` | Engines rechazó el texto recibido; Workers lo conserva en `stderr` y lo clasifica como `generic_error` (`src/runner.ts:169-184`). | Usa `low`, `medium`, `high`, `xhigh` o `max`, y confirma que el asistente admita el elegido. |
| `UNKNOWN_AGENT` | Engines no conoce `agentId`; sin `readOnly` llega como `generic_error`, con `readOnly` suele fallar antes como `READ_ONLY_UNSUPPORTED` (`src/runner.ts:169-176`). | Corrige `agentId` usando los identificadores publicados por Engines. |
| `quota_exhausted` | El proceso salió distinto de cero y el adaptador encontró un patrón en stderr capturado o en los primeros 4096 bytes del stdout capturado (`src/runner.ts:247-280`; `src/adapters/contract.ts:26-27`). | Espera a que vuelva la cuota y reanuda las tareas no iniciadas; la corrida ya emitió `run_completed`. |

Las cuatro razones posibles de `task_failed` son `timeout`, `engine_unsupported`, `spawn_error` y `generic_error` (`src/types.ts:48-53`).

## Entrada y errores fatales

| Síntoma | Causa | Qué hacer |
|---|---|---|
| `fatal_error`, `invalid_input` | JSON roto; raíz no objeto; falta `enginesBin` o `tasks`; topes no positivos; tarea no objeto; falta `id`, `agentId`, `executable` o `prompt`; `reasoningLevel` no permitido; `readOnly` no booleano (`src/types.ts:125-208`). | Corrige la entrada con el esquema de [03](03-data-contract.md); todas las tareas se validan antes de iniciar. |
| `fatal_error`, `engines_bin_not_found` | `accessSync(..., X_OK)` rechazó `enginesBin` (`src/cli.ts:46-58`). | Usa la ruta de un archivo existente y ejecutable. |
| `fatal_error`, `unexpected_error` | Algo escapó de la frontera del lote, incluso un fallo de escritura de eventos (`src/cli.ts:63-80`). | Conserva el mensaje y revisa el sistema de salida de quien invoca Workers. |
| Salida truncada | El proceso escribió más de `maxOutputBytes`; `bytes` conserva el total y `truncated` vale `true` (`src/process-runner.ts:69-88`). | Aumenta el tope si necesitas el texto completo; usa `bytes` para conocer el tamaño real. |

## Mensajes del instalador

Todos los mensajes siguientes terminan con salida 1 mediante `fail` (`scripts/install.sh:21-22`).

| Mensaje o prefijo exacto | Causa (`archivo:línea`) | Qué hacer |
|---|---|---|
| `The Engines installer override is reserved for test fixtures.` | Se definió el desvío del instalador sin `FORGE614_WORKERS_INSTALLER_TEST=1` (`scripts/install.sh:80-81`). | Quita las variables de prueba en uso normal. |
| `The Engines test installer must be a local file URL.` | El desvío no empieza por `file:///` (`scripts/install.sh:82-84`). | Usa una URL local válida solo en pruebas. |
| `Could not download the Forge614 Engines installer. Forge614 Workers was not installed.` | Falló `curl` del instalador de Engines (`scripts/install.sh:87-90`). | Revisa red, TLS y la URL; instala o actualiza Engines por separado. |
| `Forge614 Engines could not be installed. Forge614 Workers was not installed.` | El instalador descargado salió distinto de cero (`scripts/install.sh:91-92`). | Ejecuta y diagnostica el instalador de Engines. |
| `Forge614 Engines is still missing or older than 1.17.0, or does not guarantee the read-only lock. Forge614 Workers was not installed.` | La comprobación posterior sigue fallando (`scripts/install.sh:93-94`). | Instala Engines 1.17.0 o posterior y exige `supportsReadOnly: true`. |
| `The Forge614 home must be a real directory, not a link.` | `FORGE614_HOME` es enlace o existe sin ser carpeta (`scripts/install.sh:102-103`). | Elige una carpeta real. |
| `The Workers installation folder must be a real directory, not a link.` | `<home>/workers` es enlace o no es carpeta (`scripts/install.sh:104-105`). | Retira el objeto conflictivo y crea una carpeta real. |
| `The Workers bin folder must be a real directory, not a link.` | `<home>/workers/bin` es enlace o no es carpeta (`scripts/install.sh:106-107`). | Retira el objeto conflictivo y crea una carpeta real. |
| `The active command path is a directory; remove it and run the installer again.` | La ruta del comando activo es o apunta a una carpeta (`scripts/install.sh:108`). | Quita esa carpeta y repite. |
| `The active command exists and is not a link. Use --force to replace it explicitly.` | Hay un archivo regular activo y no se pasó `--force` (`scripts/install.sh:109-110`). | Comprueba el archivo y usa `--force` solo si deseas reemplazarlo. |
| `Specify one tag for --version.` | Falta valor o `--version` apareció más de una vez (`scripts/install.sh:124-125`). | Da exactamente una etiqueta. |
| `Specify a valid tag for --version.` | El valor empieza por `--` (`scripts/install.sh:126`). | Usa una etiqueta como `v1.0.0`. |
| `Unknown option. See: bash scripts/install.sh --help` | La opción no está admitida (`scripts/install.sh:131`). | Consulta `--help`. |
| `Invalid release tag. Use a semantic version tag such as v1.2.3.` | La etiqueta no cumple la expresión semántica (`scripts/install.sh:135-137`). | Corrige la etiqueta. |
| `FORGE614_HOME must be an absolute path.` | La ruta efectiva es relativa (`scripts/install.sh:140-143`). | Usa una ruta absoluta o quita la variable. |
| `HOME must be set` | Ni `FORGE614_HOME` ni `HOME` tienen un valor no vacío; la expansión `:?` detiene el shell (`scripts/install.sh:142`). | Define una de las dos; si usas `FORGE614_HOME`, debe ser absoluta. |
| `Unsupported operating system or architecture. Supported: macOS x64/arm64 and Linux x64/arm64.` | La pareja de sistema/arquitectura no está en la tabla (`scripts/install.sh:149-156`). | Instala en una plataforma publicada. |
| `curl is required to download a release.` | `curl` no aparece en `PATH` (`scripts/install.sh:158-159`). | Instala `curl`. |
| `A SHA-256 command is required: shasum or sha256sum.` | No se encontró ninguna herramienta de huella (`scripts/install.sh:160-166`). | Instala una de las dos. |
| `The release endpoint override is reserved for test fixtures.` | Se definió el endpoint de prueba sin la guarda (`scripts/install.sh:180-181`). | Quita la variable en uso normal. |
| `The test release endpoint must be a loopback HTTP URL with an explicit numeric port.` | El endpoint de prueba no es local o no tiene puerto válido (`scripts/install.sh:182-184`). | Usa `http://127.0.0.1:<puerto>` o `http://localhost:<puerto>`. |
| `Could not download release metadata.` | Falló la descarga de `release.json` (`scripts/install.sh:237-238`). | Revisa red, release y permisos temporales. |
| `The release metadata does not carry a valid version tag.` | `tag_name` falta o no es versión semántica (`scripts/install.sh:239-241`). | Corrige los metadatos de la release. |
| `The release is missing SHA256SUMS.` | No hay exactamente una URL que termine en `SHA256SUMS` (`scripts/install.sh:251-252`). | Publica un solo manifiesto. |
| `The release is missing the <artifact> binary.` | No hay exactamente una URL para el binario de la plataforma (`scripts/install.sh:253`). | Publica el artefacto esperado. |
| `Release metadata contains an unsafe test fixture URL.` | Un asset del servidor de prueba no apunta a loopback permitido (`scripts/install.sh:254-256`). | Corrige ambas URL del fixture. |
| `Release assets must use HTTPS URLs.` | En uso real, las URL combinadas no pasan la restricción HTTPS (`scripts/install.sh:257-259`). | Publica assets HTTPS. |
| `Could not download SHA256SUMS.` | Falló la descarga del manifiesto (`scripts/install.sh:261-264`). | Revisa el asset y la red. |
| `Could not download <artifact>.` | Falló la descarga del binario (`scripts/install.sh:264`). | Revisa el asset y la red. |
| `SHA256SUMS does not contain one valid digest for <artifact>.` | No hay exactamente una línea con huella minúscula de 64 hexadecimales y nombre igual (`scripts/install.sh:265-268`). | Regenera el manifiesto. |
| `Checksum verification failed for <artifact>.` | La huella calculada no coincide (`scripts/install.sh:269-274`). | No instales el archivo; vuelve a publicar o descargar. |
| `Could not create the Workers installation folders.` | Falló `mkdir` de `workers` o `bin` (`scripts/install.sh:281-282`). | Corrige permisos y tipo de ruta. |
| `Could not create the Workers version folder.` | Falló `mkdir` de la versión (`scripts/install.sh:283-284`). | Corrige permisos o conflicto de ruta. |
| Error del sistema sin prefijo propio | Falló `mktemp`, `cp`, `chmod`, `mv`, `ln` o una limpieza bajo `set -e` (`scripts/install.sh:7,189-205,285-299`). | Usa la operación y ruta que nombre stderr para corregir permisos, espacio o tipo de archivo; la trampa elimina lo temporal que alcanzó a registrar. |

## Fallos de `update`

| Mensaje | Causa | Qué hacer |
|---|---|---|
| `forge614-workers update takes no arguments.` | Llegó cualquier argumento después de `update` (`src/updater.ts:139-142`). | Ejecuta solo `forge614-workers update`. |
| `Could not download the Forge614 Workers installer.` | La respuesta HTTP no fue exitosa (`src/updater.ts:72-80`). | Revisa conectividad y la release `latest`. |
| `The Forge614 Workers installer failed; the installed version was not confirmed.` | El instalador salió distinto de cero (`src/updater.ts:107-111`). | Lee la salida heredada del instalador y resuelve su mensaje. |
| `The installed Forge614 Workers did not report a valid version.` | El comando instalado no imprimió `forge614-workers X.Y.Z[...]` (`src/updater.ts:50-62`). | Reinstala y comprueba manualmente `--version`. |
| `Could not update forge614-workers: <detalle>` | Frontera común para descarga, lanzamiento, instalador o lectura de versión (`src/updater.ts:153-156`). | Usa `<detalle>` como causa primaria; el instalador temporal ya fue borrado (`src/updater.ts:115-117`). |
