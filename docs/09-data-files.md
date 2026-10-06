# 09. Archivos de datos

> **Versión del producto:** `package.json`: versión `1.0.0`
> **Traducción hermana:** [09 (EN). Data files](09-data-files.en.md)

## Propósito

Este capítulo inventaría los archivos de datos y configuración que acompañan a Workers. El documento JSON de entrada del lote y los eventos NDJSON están definidos en [03. Contrato JSON y eventos NDJSON](03-data-contract.md); no se repiten aquí.

## `.forge614/project.json`

Identidad portátil del repositorio. Workers no lo lee durante una corrida: su punto de entrada solo importa `cli`, `updater` y `package.json` (`src/main.ts:8-10`).

| Campo | Tipo | Quién lo escribe | Quién lo lee | Ejemplo |
|---|---|---|---|---|
| `schemaVersion` | número | La herramienta que registra el proyecto | Herramientas del ecosistema; no el binario de Workers | `1` (`.forge614/project.json:2`) |
| `project` | objeto | La herramienta que registra el proyecto | Herramientas del ecosistema | Objeto de identidad (`.forge614/project.json:3-6`) |
| `project.id` | texto UUID | La herramienta que registra el proyecto | Herramientas del ecosistema | `6b31d856-dbbd-451e-9d73-8a2782975a5f` (`.forge614/project.json:4`) |
| `project.name` | texto | La herramienta que registra el proyecto | Herramientas del ecosistema | `forge614-workers` (`.forge614/project.json:5`) |
| `ecosystem` | objeto | La herramienta que registra el proyecto | Herramientas del ecosistema | Objeto de grupo (`.forge614/project.json:7-10`) |
| `ecosystem.id` | texto UUID | La herramienta que registra el proyecto | Herramientas del ecosistema | `e0b3e1c9-ffbb-4b6b-8a55-79fbf3e8f0b4` (`.forge614/project.json:8`) |
| `ecosystem.name` | texto | La herramienta que registra el proyecto | Herramientas del ecosistema | `forge614` (`.forge614/project.json:9`) |

## `docs/notion-map.json`

Mapa entre los manuales locales y sus páginas publicadas. No participa en la ejecución de Workers (`src/main.ts:55-76`). Cada `fingerprint` es `sha256:` más el SHA-256 del manual local en el momento en que se revisó contra Notion. `reviewedProductVersion` permanece en `0.1.0` hasta que vuelvan a publicarse esas páginas; esta documentación no modifica el mapa (`docs/notion-map.json:4,8-25`).

| Campo | Tipo | Quién lo escribe | Quién lo lee | Ejemplo |
|---|---|---|---|---|
| `project` | texto | El proceso de sincronización documental | El proceso de sincronización documental | `forge614-workers` (`docs/notion-map.json:2`) |
| `repository` | texto | El proceso de sincronización documental | El proceso de sincronización documental | `jotredev/forge614-workers` (`docs/notion-map.json:3`) |
| `reviewedProductVersion` | texto semántico | El proceso de publicación, cuando revisa las páginas | Quien comprueba la vigencia de la publicación | `0.1.0` (`docs/notion-map.json:4`) |
| `notionHub` | URL | El proceso de sincronización documental | Quien navega o publica la documentación | URL del centro del proyecto (`docs/notion-map.json:5`) |
| `category` | texto | El proceso de sincronización documental | Quien clasifica las páginas | `AI Engineer / Librerías` (`docs/notion-map.json:6`) |
| `entries` | arreglo de objetos | El proceso de sincronización documental | El proceso de sincronización documental | 18 asociaciones locales/remotas (`docs/notion-map.json:7-25`) |
| `entries[].localPath` | texto de ruta | El proceso de sincronización documental | El proceso que abre el manual local | `docs/00-forge614-workers.md` (`docs/notion-map.json:8`) |
| `entries[].language` | texto | El proceso de sincronización documental | El proceso que elige idioma | `es` o `en` (`docs/notion-map.json:8-9`) |
| `entries[].notionUrl` | URL | El proceso de sincronización documental | El proceso que abre o actualiza la página | URL de la página (`docs/notion-map.json:8`) |
| `entries[].fingerprint` | texto `sha256:<hex>` | El proceso de sincronización tras revisar contenido | El proceso que detecta cambios locales | `sha256:16ae…e28c` (`docs/notion-map.json:8`) |

## `package.json` y `tsconfig.json`

| Archivo/campo | Uso en el proyecto | Fuente |
|---|---|---|
| `package.json.version` | `--version`, la ayuda y `update` leen la versión compilada; la publicación la compara con el tag. | `src/main.ts:9,13,41,67`; `.github/workflows/release.yml:59-74` |
| `scripts.test` | Ejecuta la suite con `bun test`. | `package.json:7`; `.github/workflows/verify.yml:53` |
| `scripts.typecheck` | Ejecuta `tsc --noEmit`. | `package.json:8`; `.github/workflows/verify.yml:54` |
| `scripts.build` | Compila `src/main.ts` como binario en `dist/forge614-workers`. | `package.json:9` |
| `engines.node` | Declara Node `>=20` para herramientas que interpretan el manifiesto; el binario se compila con Bun. | `package.json:15-17`; `.github/workflows/release.yml:108-109` |
| `tsconfig.compilerOptions` | ES2022, módulos ESNext, resolución `bundler`, modo estricto, tipos de Bun, omisión de revisión de librerías y ninguna emisión. | `tsconfig.json:2-10` |
| `tsconfig.include` | Incluye `src`, `test` y `scripts` en la revisión de tipos. | `tsconfig.json:11` |

## Programas falsos de `test/fixtures/`

| Archivo | Qué hace | Prueba que lo usa (nombre exacto y archivo) |
|---|---|---|
| `big-output.js` | Escribe la cantidad pedida de bytes ASCII. | `truncates stdout at maxOutputBytes and reports the true observed size` — `src/process-runner.test.ts:160-173` |
| `echo-stdin.js` | Devuelve por stdout todo su stdin. | `runs a command, pipes stdin, and captures stdout` — `src/process-runner.test.ts:18-30` |
| `exit-immediately.js` | Sale con 0 sin leer una entrada grande. | `resolves normally when the child exits without reading stdin` — `src/process-runner.test.ts:59-75` |
| `fake-agent-echo.js` | Devuelve el prompt con el prefijo `echoed: `. | `runs a successful task against a fake engines binary and a fake agent, exit 0` — `test/e2e.test.ts:211-230` |
| `fake-agent-quota.js` | Escribe el patrón de cuota y sale con 1. | `stops with exit 75 when the fake agent reports quota exhaustion` — `test/e2e.test.ts:238-255` |
| `fake-engines-capabilities-no-read-only.js` | Responde capacidades sin `supportsReadOnly`. | `returns false when capabilities has no supportsReadOnly field (an Engines older than 1.17.0)` — `src/engines-client.test.ts:235-238` |
| `fake-engines-capabilities-read-only-false.js` | Responde `supportsReadOnly: false`. | `returns false when capabilities says supportsReadOnly is false` — `src/engines-client.test.ts:242-248` |
| `fake-engines-headless.js` | Resuelve `headless` al ejecutable pedido; se usa en los dos escenarios E2E. | `runs a successful task against a fake engines binary and a fake agent, exit 0` y `stops with exit 75 when the fake agent reports quota exhaustion` — `test/e2e.test.ts:211-245` |
| `fake-engines-invalid-json.sh` | Imprime una respuesta que no es JSON. | `reports ENGINES_RESPONSE_INVALID instead of throwing when the binary prints non-JSON stdout` y `returns false instead of throwing when the binary prints non-JSON stdout` — `src/engines-client.test.ts:196,252-255` |
| `ignore-sigterm.js` | Ignora SIGTERM hasta que el ejecutor escala a SIGKILL. | `kills a process that ignores SIGTERM after the grace period` — `src/process-runner.test.ts:181-192` |
| `never-reads-stdin.js` | Espera 60 segundos sin leer stdin. | `timeoutMs still engages when the child never reads a large stdin payload` — `src/process-runner.test.ts:83-108` |
| `print-cwd.js` | Imprime la carpeta de trabajo actual. | `cleans up the isolated temp working directory after the process exits` — `src/process-runner.test.ts:38-51` |
| `print-env.js` | Imprime el entorno como JSON. | `inherits the parent process's environment completely untouched (no HOME override, no allowlisting)` — `src/process-runner.test.ts:115-148` |

## Apoyos de `test/support/`

| Archivo | Qué hace | Prueba que lo usa (nombre exacto y archivo) |
|---|---|---|
| `fake-update-preload.ts` | Reemplaza `fetch`, entrega un instalador falso y registra sus llamadas. | `is answered without reading stdin: downloads the latest installer and runs it with --force` — `test/e2e.test.ts:170-177` |
| `fixture-path.ts` | Convierte un nombre de fixture en una ruta absoluta. | Las siete pruebas de `runProcess`, desde `runs a command, pipes stdin, and captures stdout` hasta `kills a process that ignores SIGTERM after the grace period` — `src/process-runner.test.ts:18-192` |
| `resolve-engines-bin.ts` | Usa `FORGE614_ENGINES_BIN` o busca Engines en `PATH`. | `returns true for %s against the real forge614-engines binary`, `returns false for an agent id that Engines does not know` y `every agent with supportsHeadlessExec has a registered adapter` — `src/engines-client.test.ts:220-230`; `src/adapters/registry.completeness.test.ts:15-17` |
