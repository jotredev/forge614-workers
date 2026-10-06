# 10. Instalador, actualización y publicación

> **Versión del producto:** la de `package.json`
> **Traducción hermana:** [10 (EN). Installer, update, and release](10-installer.en.md)

## Propósito

El instalador descarga un binario publicado, verifica su huella, asegura un Engines compatible y activa la versión mediante un enlace simbólico (`scripts/install.sh:237-305`). Solo admite macOS y Linux, x64 y arm64 (`scripts/install.sh:149-156`).

## Requisitos y opciones

Requiere Bash con `set -euo pipefail`, `curl` y `shasum` o `sha256sum`; Engines debe ser 1.17.0 o posterior y declarar `supportsReadOnly: true` para `claude-code`, que es el único asistente que consulta el instalador (`scripts/install.sh:7,24-28,43-64,158-166`).

| Opción | Resultado | Fuente |
|---|---|---|
| `--version TAG` | Elige `tags/TAG`; exige una etiqueta semántica y solo puede aparecer una vez. | `scripts/install.sh:13,124-137,171-174` |
| `--force` | Reinstala la misma versión y permite reemplazar un comando activo que no sea enlace. | `scripts/install.sh:16,109-110,130,245-249` |
| `--help`, `-h` | Imprime la ayuda y sale con 0. | `scripts/install.sh:9-19,123` |

## `FORGE614_HOME`

Si `FORGE614_HOME` está definida y no vacía debe ser absoluta; si falta o está vacía se usa `$HOME/.forge614`. El binario de cada versión queda en `<home>/workers/<versión>/forge614-workers`, el comando activo en `<home>/workers/bin/forge614-workers` y Engines en `<home>/engines/bin/forge614-engines` (`scripts/install.sh:140-147,242-243`). La orden `update` usa la misma ruta por defecto, pero no valida que un `FORGE614_HOME` definido sea absoluto (`src/updater.ts:36-47`).

## Funciones del instalador

| Función | Recibe | Qué hace | Código de salida |
|---|---|---|---|
| `usage` | Nada | Imprime las opciones, destino y requisito de Engines. | El del último `printf`, normalmente 0 (`scripts/install.sh:9-19`). |
| `fail` | Mensaje en `$1` | Lo escribe en stderr y termina el script. | Siempre 1 (`scripts/install.sh:21-22`). |
| `is_loopback_test_url` | URL en `$1` | Solo acepta HTTP local con puerto 1–65535 y ruta sin consulta ni fragmento. | 0 si encaja; 1 si no (`scripts/install.sh:30-40`). |
| `engines_is_compatible` | Variables globales de ruta y versión mínima | Ejecuta `--version`, compara los tres números y consulta `capabilities --agent claude-code` (`scripts/install.sh:62`). | 0 solo con versión suficiente y `supportsReadOnly: true`; 1 en cualquier fallo (`scripts/install.sh:43-64`). |
| `ensure_engines` | Variables globales | Reutiliza Engines compatible o descarga y ejecuta su instalador, después vuelve a comprobar. | 0 si queda compatible; 1 mediante `fail` en cualquier rechazo (`scripts/install.sh:66-95`). |
| `check_destination` | Variables globales de destino y `force` | Rechaza carpetas que sean enlaces, rutas que no sean carpetas y comandos activos inseguros. | 0 si el destino es seguro; 1 mediante `fail` (`scripts/install.sh:97-112`). |
| `cleanup` | Variables globales temporales | Borra staging, enlace temporal, descarga y una carpeta de versión incompleta. | No llama a `exit`; conserva el código previo (`scripts/install.sh:189-206`). |
| `download` | URL y archivo destino | Ejecuta `curl` con protocolo permitido, TLS 1.2, redirecciones y fallo HTTP. | El de `curl` (`scripts/install.sh:208-213`). |
| `asset_url` | Texto final esperado de la URL | Extrae `browser_download_url` y exige una sola URL que termine con el texto. | 0 y URL con una coincidencia; 1 con cero o varias (`scripts/install.sh:215-235`). |

## Flujo paso a paso

1. Analiza las opciones y valida la etiqueta (`scripts/install.sh:114-138`).
2. Resuelve `FORGE614_HOME`, plataforma, arquitectura y herramientas de huella (`scripts/install.sh:140-166`).
3. Comprueba el destino antes de descargar (`scripts/install.sh:168-169`).
4. Elige la release última o una etiqueta. En pruebas, solo acepta un endpoint HTTP local autorizado (`scripts/install.sh:171-187`).
5. Crea una carpeta de descarga y registra `cleanup` para toda salida (`scripts/install.sh:189-206`).
6. Descarga `release.json`, valida `tag_name` y, si la versión ya está activa y no se pasó `--force`, imprime `Forge614 Workers v<versión> is already active.` y sale con 0 (`scripts/install.sh:237-249`).
7. Localiza `SHA256SUMS` y el binario, restringe sus URL, descarga ambos y compara exactamente una huella SHA-256 minúscula (`scripts/install.sh:251-274`).
8. Asegura Engines y vuelve a comprobar el destino antes de crear Workers (`scripts/install.sh:276-278`).
9. Crea las carpetas que falten (la de `FORGE614_HOME` con permisos 700 solo si no existía), deja `workers`, `workers/bin` y la carpeta de la versión con permisos 700, copia el binario a un archivo temporal de `mktemp` con permisos 755 y lo mueve con `mv`, y cambia atómicamente el enlace activo (`scripts/install.sh:280-301`).
10. Imprime la ruta instalada y aclara que no añade Workers a `PATH` (`scripts/install.sh:303-305`).

## Variables exclusivas de pruebas

| Variable | Dónde se lee | Efecto |
|---|---|---|
| `FORGE614_WORKERS_INSTALLER_TEST` | `scripts/install.sh:81,181` | Debe valer `1` para habilitar cualquiera de los dos desvíos de prueba. |
| `FORGE614_WORKERS_TEST_RELEASE_BASE_URL` | `scripts/install.sh:180-186` | Cambia la API de releases por un servidor HTTP local con puerto explícito. |
| `FORGE614_WORKERS_ENGINES_INSTALLER_TEST_URL` | `scripts/install.sh:80-84` | Cambia el instalador de Engines por una URL local `file:///`. |
| `FORGE614_ENGINES_BIN` | `test/support/resolve-engines-bin.ts:13-20` | Hace que las pruebas de cliente y registro usen ese ejecutable en vez de buscarlo en `PATH`. |
| `FAKE_UPDATE_MARKER` | `test/support/fake-update-preload.ts:10` | Nombra el archivo donde el `fetch` falso y el instalador falso anotan sus llamadas; sin ella la precarga lanza un error (`test/support/fake-update-preload.ts:11`). La define `test/e2e.test.ts:146`. |

## Orden `update`

`forge614-workers update` se atiende antes de leer stdin (`src/main.ts:64-71`). No admite argumentos: cualquiera produce el mensaje `forge614-workers update takes no arguments.` y salida 2 (`src/updater.ts:133-143`). Descarga el instalador de `latest` a una carpeta temporal privada, ejecuta `bash <instalador> --force`, borra la carpeta temporal del instalador en todos los caminos una vez descargado (si falla la escritura del archivo, la carpeta ya creada queda) y confirma la versión ejecutando el comando instalado con `--version` (`src/updater.ts:14-15,50-80,83-119`). Éxito sale con 0; cualquier fallo se antepone con `Could not update forge614-workers:` y sale con 1 (`src/updater.ts:144-157`).

## Flujos de GitHub

### `verify.yml`

El trabajo `unix` corre en Linux y macOS, instala Bun y dependencias bloqueadas, descarga Engines 1.17.0 y verifica su huella y el candado de solo lectura de `claude-code`. Después ejecuta toda la suite, el typecheck, `git diff --check` y la comprobación sintáctica de `scripts/install.sh` (`.github/workflows/verify.yml:11-65`). No publica y solo tiene permiso `contents: read` (`.github/workflows/verify.yml:7-8`). Corre en cada `pull_request` y en cada `push` (`.github/workflows/verify.yml:3-5`), con un tope de 20 minutos y sin cancelar la otra plataforma si una falla (`.github/workflows/verify.yml:15,17`).

### `release.yml`

- `verify` repite las comprobaciones, exige una entrada de changelog para `package.json.version` y, ante un tag, exige `v<versión>` (`.github/workflows/release.yml:17-85`).
- `build` compila cuatro artefactos nativos, prueba `--version` y un lote vacío, conserva el permiso en un `.tar.gz` y sube cada resultado (`.github/workflows/release.yml:87-146`).
- `assemble` reúne los cuatro binarios, crea `SHA256SUMS`, exige que cada binario no esté vacío y sea ejecutable, que `SHA256SUMS` tenga exactamente 4 líneas con 64 hexadecimales minúsculas y el nombre del binario, y vuelve a verificar las huellas (`.github/workflows/release.yml:148-209`).
- `publish` solo corre para un push de tag después de `verify` y `assemble`; publica exclusivamente los cuatro binarios validados, `SHA256SUMS` e `install.sh` (`.github/workflows/release.yml:211-248`). Una etiqueta con `-` se publica como preliminar (`.github/workflows/release.yml:235-238`).

Un pull request que cambia el flujo o el instalador y una ejecución manual comprueban sin publicar; el push de una etiqueta `v*` sí puede llegar a `publish` (`.github/workflows/release.yml:3-11,215`).
