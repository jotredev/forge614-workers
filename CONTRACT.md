# Contrato de Workers (`forge614-workers`)

Versión de este contrato: la del producto (`package.json`). Traducción: [CONTRACT.en.md](CONTRACT.en.md).

## Propósito

Workers ejecuta en secuencia un lote JSON de tareas no interactivas, resuelve cada comando mediante Engines y devuelve eventos NDJSON (`src/main.ts:13-29`; `src/runner.ts:108-116,333-344`).

## Qué hace

- Valida todo el documento y aplica 10 MiB por salida y 10 minutos por tarea cuando faltan esos topes (`src/types.ts:109-112,125-153,177`).
- Pregunta a Engines por el comando `headless` y entrega el prompt por stdin, no por argumentos (`src/engines-client.ts:58-79`; `src/runner.ts:149-209`).
- Ejecuta cada tarea en una carpeta temporal vacía, hereda el entorno y borra la carpeta al terminar (`src/process-runner.ts:99-119,174-177`).
- Captura stdout y stderr con conteo real, truncamiento y tiempo límite (`src/process-runner.ts:50-88,141-173`).
- Detecta cuota mediante el adaptador registrado y corta el lote con `quota_exhausted` (`src/runner.ts:247-280`).
- Garantiza que una tarea `readOnly` no arranque sin confirmación de Engines (`src/runner.ts:126-146`).
- Ofrece `--version`, `--help` y `update` sin leer stdin (`src/main.ts:55-76`).

## Qué no hace

- No elige tareas, asistentes, modelos ni niveles: valida o reenvía los valores de entrada (`src/types.ts:165-208`; `src/engines-client.ts:73-76`).
- No ejecuta tareas en paralelo: usa un solo ciclo con `await` por tarea (`src/runner.ts:108-116,149-209`).
- No reintenta fallos ni tareas tras cuota: lanza cada tarea una sola vez y, tras `quota_exhausted`, no inicia las siguientes (`src/runner.ts:109-116,265-281`).
- No persiste sesiones ni resultados: sus módulos no abren ninguna base; los eventos se entregan a `writeLine` (`src/cli.ts:60-68`). Los asistentes que lanza sí pueden dejar sus propias sesiones bajo el `HOME` real, que Workers no limpia (véase [04](docs/04-isolation-and-process-lifecycle.md)).
- No añade su carpeta a `PATH`; el instalador lo declara al terminar (`scripts/install.sh:303-305`).
- La carpeta temporal no es un aislamiento del entorno ni del disco; solo cambia `cwd` (`src/process-runner.ts:99-111`).

## Dependencias

| Dependencia | Cómo se consume | Requisito |
|---|---|---|
| Engines | `enginesBin` para `headless` y, cuando hay `readOnly`, `capabilities --agent <id>` | El instalador exige 1.17.0 o posterior y `supportsReadOnly: true` para `claude-code` (`scripts/install.sh:43-64`). |
| Bun | Compila el binario y ejecuta pruebas y herramientas del repositorio | La CI fija 1.4.2 (`.github/workflows/verify.yml:24-26`). |
| Sistema operativo | Procesos, señales, carpetas temporales y permisos | El instalador admite macOS y Linux, x64 y arm64 (`scripts/install.sh:149-156`). |

## Comandos públicos

| Comando | Entrada | Salida | Códigos de salida |
|---|---|---|---|
| `forge614-workers` | Un documento JSON por stdin; ver [03](docs/03-data-contract.md) | Un evento JSON por línea | `0`, `1`, `2`, `75` (`src/cli.ts:18-80`) |
| `forge614-workers --version`, `-v` | Debe ser el primer argumento | `forge614-workers <versión>` | `0` (`src/main.ts:32-43,57-62`) |
| `forge614-workers --help`, `-h` | Debe ser el primer argumento | Ayuda de texto | `0` (`src/main.ts:12-43,57-62`) |
| `forge614-workers update` | Ningún argumento adicional | Mensaje de actualizado o ya vigente por stdout; fallos por stderr | `0`, `1`, `2` (`src/updater.ts:121-157`) |

## Códigos de salida

| Código | Significado |
|:---:|---|
| `0` | Corrida terminada, incluso con tareas fallidas; o comando informativo/actualización exitosa. |
| `1` | Error fatal inesperado o actualización fallida. |
| `2` | Entrada inválida, Engines no ejecutable o argumentos extra de `update`. |
| `75` | Lote pausado por cuota. |

La decisión exacta está en `src/cli.ts:31-80` y `src/updater.ts:139-156`.

## Códigos de error y razones de fallo

| Código o razón | Significado |
|---|---|
| `invalid_input` | El documento o una tarea no cumple la validación (`src/types.ts:125-208`). |
| `engines_bin_not_found` | `enginesBin` no existe o no es ejecutable (`src/cli.ts:46-58`). |
| `unexpected_error` | Excepción fuera de la frontera por tarea (`src/cli.ts:63-80`). |
| `ENGINES_RESPONSE_INVALID` | Respuesta de `headless` no legible o sin `headless`/`error` (`src/engines-client.ts:84-104`). |
| `HEADLESS_UNSUPPORTED` | El asistente no admite ejecución sin interfaz; `engine_unsupported` (`src/runner.ts:178-183`). |
| `REASONING_LEVEL_UNSUPPORTED` | Ese asistente no admite el nivel; `engine_unsupported` (`src/runner.ts:178-183`). |
| `READ_ONLY_UNSUPPORTED` | Engines no garantiza solo lectura; `engine_unsupported` (`src/runner.ts:126-146,178-183`). |
| `timeout` | Venció el tiempo de la tarea (`src/runner.ts:228-241`). |
| `spawn_error` | No se pudo iniciar el comando (`src/runner.ts:211-225`). |
| `generic_error` | Otro rechazo, salida distinta de cero sin cuota o excepción de tarea (`src/runner.ts:178-197,283-328`). |
| `quota_exhausted` | Salida distinta de cero con patrón de cuota; corta el lote (`src/runner.ts:247-280`). |

## Compatibilidad

La entrada no lleva `schemaVersion`; su compatibilidad queda definida por los campos que acepta `parseRunInput` (`src/types.ts:125-208`). Los eventos tampoco llevan versión y forman la unión cerrada `TaskEvent` (`src/types.ts:55-107`): quitar o cambiar campos es incompatible para consumidores de NDJSON. Los campos opcionales de texto `readableDir` y `model` con tipo incorrecto se omiten, pero un `readOnly` inválido rechaza todo el lote (`src/types.ts:156-163,192-207`).

El instalador y la publicación cubren macOS y Linux, x64 y arm64; no hay artefacto de Windows (`scripts/install.sh:149-156`; `.github/workflows/release.yml:95-111`).
