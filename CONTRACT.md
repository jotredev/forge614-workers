# Contrato de Workers (`forge614-workers`)

Versión de este contrato: la del producto (`package.json`). Traducción: [CONTRACT.en.md](CONTRACT.en.md).

## Propósito

Workers ejecuta en secuencia un lote JSON de tareas no interactivas, resuelve cada comando mediante Engines y devuelve eventos NDJSON (`src/main.ts:13-29`; `src/runner.ts:108-116,333-344`).

## Qué hace

- Valida todo el documento y aplica 10 MiB por salida y 10 minutos por tarea cuando faltan esos topes (`src/types.ts:109-112,125-153,177`).
- Pregunta a Engines por el comando `headless` y entrega el prompt por stdin, no por argumentos. Exige `error.code` y `error.message` de texto, o `headless.command` de texto y `headless.args` como arreglo de textos; una respuesta mal formada devuelve `ENGINES_RESPONSE_INVALID` (`src/engines-client.ts:43-128`; `src/runner.ts:149-209,204-205`).
- Ejecuta cada tarea en una carpeta temporal vacía, hereda el entorno y borra la carpeta al terminar (`src/process-runner.ts:99-119,174-177`).
- Captura stdout y stderr con conteo real, truncamiento y tiempo límite (`src/process-runner.ts:50-88,141-173`).
- Detecta cuota mediante el adaptador registrado y corta el lote con `quota_exhausted` (`src/runner.ts:247-280`).
- Garantiza que una tarea `readOnly` no arranque sin confirmación de Engines (`src/runner.ts:126-146`).
- Ofrece `--version`, `--help`, `update` y `uninstall` sin leer stdin (`src/main.ts:55-76`).

## Qué no hace

- No elige tareas, asistentes, modelos ni niveles: valida o reenvía los valores de entrada (`src/types.ts:165-208`; `src/engines-client.ts:73-76`).
- No ejecuta tareas en paralelo: usa un solo ciclo con `await` por tarea (`src/runner.ts:108-116,149-209`).
- No reintenta fallos ni tareas tras cuota: lanza cada tarea una sola vez y, tras `quota_exhausted`, no inicia las siguientes (`src/runner.ts:109-116,265-281`).
- No persiste sesiones ni resultados: sus módulos no abren ninguna base; los eventos se entregan a `writeLine` (`src/cli.ts:60-68`). Los asistentes que lanza sí pueden dejar sus propias sesiones bajo el `HOME` real, que Workers no limpia (véase [04](docs/04-isolation-and-process-lifecycle.md)).
- No añade su carpeta a `PATH`; la ficha declara `path.modify: false` (`forge614.node.json:29`).
- La carpeta temporal no es un aislamiento del entorno ni del disco; solo cambia `cwd` (`src/process-runner.ts:99-111`).

## Dependencias

| Dependencia | Cómo se consume | Requisito |
|---|---|---|
| Engines | `enginesBin` para `headless` y, cuando hay `readOnly`, `capabilities --agent <id>` | El instalador exige 1.17.0 o posterior y `supportsReadOnly: true` para `claude-code` (`forge614.node.json:1-35`). |
| Bun | Compila el binario y ejecuta pruebas y herramientas del repositorio | La CI fija 1.4.2 (`.github/workflows/verify.yml:24-26`). |
| Sistema operativo | Procesos, señales y carpetas temporales | macOS y Linux x64/arm64; Windows x64. En Windows la terminación usa la API directa del proceso (`src/process-runner.ts:147-164`). |

## Comandos públicos

| Comando | Entrada | Salida | Códigos de salida |
|---|---|---|---|
| `forge614-workers` | Un documento JSON por stdin; ver [03](docs/03-data-contract.md) | Un evento JSON por línea | `0`, `1`, `2`, `75` (`src/cli.ts:18-80`) |
| `forge614-workers --version`, `-v` | Debe ser el primer argumento; `--json` es opcional | Texto `forge614-workers <versión>` o JSON con identidad | `0`; argumentos extra `2` (`src/main.ts:32-43,57-62`) |
| `forge614-workers --help`, `-h` | Debe ser el primer argumento | Ayuda de texto | `0` (`src/main.ts:12-43,57-62`) |
| `forge614-workers update [--version X.Y.Z] [--json]` | Etiqueta opcional; la última release si se omite | Versión instalada real; JSON opcional; errores JSON por stderr | `0`, `1`, `2` (`src/updater.ts:1-60`) |
| `forge614-workers uninstall [--json]` | Confirma en terminal interactiva; nunca borra Engines | Informa `removed` solo tras comprobar el borrado | `0`, `1`, `2`, cancelar `130` (`src/uninstall.ts:1-90`) |
| `forge614-workers uninstall --self [--json]` | No retira integraciones propias | `integrationsRemoved: true` en JSON | `0` (`src/uninstall.ts:45-50`) |

## Comandos de desarrollo y publicación

- `bun run verify`: typecheck, pruebas y comprobación de la ficha.
- `bun run build:target`: compila el destino indicado por `FORGE614_TARGET`.
- `bun run smoke:target`: ejecuta `--version` sobre el binario compilado para ese destino.
- `bun run release:publish`: publica los diez assets preparados en el release de GitHub.

## Códigos de salida

| Código | Significado |
|:---:|---|
| `0` | Corrida terminada, incluso con tareas fallidas; o comando informativo/actualización exitosa. |
| `1` | Error fatal inesperado o actualización fallida. |
| `2` | Entrada o argumentos de comando inválidos; Engines no ejecutable. |
| `130` | Se canceló la confirmación de desinstalación. |
| `75` | Lote pausado por cuota. |

Los comandos de gestión emiten JSON estable en `src/updater.ts` y `src/uninstall.ts`; el lote NDJSON conserva su contrato en `src/cli.ts`.

## Códigos de error y razones de fallo

| Código o razón | Significado |
|---|---|
| `invalid_input` | El documento o una tarea no cumple la validación (`src/types.ts:125-208`). |
| `engines_bin_not_found` | `enginesBin` no existe o no es ejecutable (`src/cli.ts:46-58`). |
| `unexpected_error` | Excepción fuera de la frontera por tarea (`src/cli.ts:63-80`). |
| `ENGINES_RESPONSE_INVALID` | JSON ilegible o respuesta `headless` mal formada; `error` requiere `code` y `message` de texto, y `headless` requiere `command` de texto y `args` como arreglo de textos (`src/engines-client.ts:84-123`). |
| `HEADLESS_UNSUPPORTED` | El asistente no admite ejecución sin interfaz; `engine_unsupported` (`src/runner.ts:178-183`). |
| `REASONING_LEVEL_UNSUPPORTED` | Ese asistente no admite el nivel; `engine_unsupported` (`src/runner.ts:178-183`). |
| `READ_ONLY_UNSUPPORTED` | Engines no garantiza solo lectura; `engine_unsupported` (`src/runner.ts:126-146,178-183`). |
| `timeout` | Venció el tiempo de la tarea (`src/runner.ts:228-241`). |
| `spawn_error` | No se pudo iniciar el comando (`src/runner.ts:211-225`). |
| `generic_error` | Otro rechazo, salida distinta de cero sin cuota o excepción de tarea (`src/runner.ts:178-197,283-328`). |
| `quota_exhausted` | Salida distinta de cero con patrón de cuota; corta el lote (`src/runner.ts:247-280`). |

## Compatibilidad

La entrada no lleva `schemaVersion`; su compatibilidad queda definida por los campos que acepta `parseRunInput` (`src/types.ts:125-208`). Los eventos tampoco llevan versión y forman la unión cerrada `TaskEvent` (`src/types.ts:55-107`): quitar o cambiar campos es incompatible para consumidores de NDJSON. Los campos opcionales de texto `readableDir` y `model` con tipo incorrecto se omiten, pero un `readOnly` inválido rechaza todo el lote (`src/types.ts:156-163,192-207`).

El instalador y la publicación cubren macOS y Linux x64/arm64 y Windows x64. Windows se prueba solo en CI; no en una máquina real (`forge614.node.json:1-35`; `.github/workflows/release.yml`).
