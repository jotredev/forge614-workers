#!/usr/bin/env bash
# Instalador de Forge614 Workers: descarga el binario de una versión publicada (la última, o la que indique `--version`),
# verifica su suma SHA-256 (huella que detecta si el archivo cambió o llegó dañado), se asegura de que haya un Forge614 Engines
# compatible (1.17.0 o más nuevo, con bloqueo de solo lectura) y deja el comando activo en `$FORGE614_HOME/workers/bin/forge614-workers`.
# Lo prueba `scripts/__tests__/install.sh.test.ts`; el comando `update` (`src/updater.ts`) descarga la última copia y la ejecuta con `--force`.
# `-e` termina el script si un comando falla, `-u` lo termina si se lee una variable sin definir y `pipefail` hace que una tubería falle si falla cualquiera de sus pasos.
set -euo pipefail

# Imprime la ayuda del instalador en stdout. No recibe argumentos y no falla: termina con el código de su último `printf` (0).
usage() {
  printf '%s\n' \
    'Install a verified Forge614 Workers release binary.' \
    'Usage: bash scripts/install.sh [--version TAG] [--force]   (TAG is a release tag such as v1.0.0)' \
    'Destination: $FORGE614_HOME (default $HOME/.forge614)/workers/<version>/forge614-workers,' \
    'with the active version linked at workers/bin/forge614-workers.' \
    '--force reinstalls the same version or replaces a command that is not a link.' \
    'Requires Forge614 Engines 1.17.0 or newer with the read-only lock (supportsReadOnly); it is installed first when missing or not compatible.' \
    'Nothing of Workers is installed when a requirement cannot be met.'
}

# Escribe el mensaje que recibe como $1 en stderr y termina todo el script con código 1 (`exit`, no `return`: no vuelve a quien la llamó).
fail() { printf '%s\n' "$1" >&2; exit 1; }

# Versión más antigua de Forge614 Engines que garantiza el bloqueo de solo lectura del que depende Workers.
min_engines_major=1
min_engines_minor=17
min_engines_patch=0
engines_hint='Install or update it with: curl -fsSL https://github.com/jotredev/forge614-engines/releases/latest/download/install.sh | bash'

# Recibe una dirección como $1 y devuelve 0 solo si es `http://127.0.0.1` o `http://localhost` con un puerto numérico
# entre 1 y 65535 y, como mucho, una ruta sin `?` ni `#`; devuelve 1 si no tiene esa forma o si el puerto queda fuera de rango.
# Solo se usa con los servidores de prueba del instalador, que no deben salir de la máquina.
is_loopback_test_url() {
  local url="$1"
  local port
  # Si la dirección no encaja con la expresión regular, se devuelve 1; el grupo 2 es el puerto.
  [[ "$url" =~ ^http://(127\.0\.0\.1|localhost):([0-9]+)(/[^\?#]*)?$ ]] || return 1
  port="${BASH_REMATCH[2]}"
  # `10#` fuerza base decimal para que un puerto con ceros a la izquierda no se lea como octal; el código de salida es el de la comparación.
  (( 10#$port >= 1 && 10#$port <= 65535 ))
}

# No recibe argumentos (usa `engines_binary` y los mínimos `min_engines_*`). Devuelve 0 solo si el Engines instalado se
# ejecuta, su versión es igual o mayor que la mínima y `capabilities` declara `supportsReadOnly: true` para claude-code;
# devuelve 1 en cuanto falla cualquiera de esos pasos, sin imprimir nada. Es una consulta: no termina el script.
engines_is_compatible() {
  local version_output capabilities major minor patch
  local version_pattern='^forge614-engines ([0-9]+)\.([0-9]+)\.([0-9]+)'
  # El ejecutable debe existir y tener permiso de ejecución.
  [ -x "$engines_binary" ] || return 1
  # Se pide la versión y se separa en tres números con la expresión regular; sin coincidencia, no es compatible.
  version_output="$("$engines_binary" --version 2>/dev/null)" || return 1
  [[ "$version_output" =~ $version_pattern ]] || return 1
  major="${BASH_REMATCH[1]}"
  minor="${BASH_REMATCH[2]}"
  patch="${BASH_REMATCH[3]}"
  # Comparación de versiones número a número (mayor, luego menor, luego parche); `10#` fuerza base decimal.
  (( 10#$major > min_engines_major \
    || (10#$major == min_engines_major && (10#$minor > min_engines_minor \
    || (10#$minor == min_engines_minor && 10#$patch >= min_engines_patch))) )) || return 1
  # Además de la versión, Engines debe declarar que garantiza el bloqueo de solo lectura; el código de salida es el de `grep`.
  capabilities="$("$engines_binary" capabilities --agent claude-code 2>/dev/null)" || return 1
  grep -Eq '"supportsReadOnly"[[:space:]]*:[[:space:]]*true' <<< "$capabilities"
}

# No recibe argumentos. Se asegura de que haya un Engines compatible: si ya lo hay, lo avisa y devuelve 0; si falta o no
# cumple, descarga e instala el último y vuelve a comprobarlo. Termina el script con código 1 (vía `fail`) si el cambio
# de dirección de prueba se usa sin `FORGE614_WORKERS_INSTALLER_TEST=1` o no es un `file:///`, si no se puede descargar
# el instalador de Engines, si este falla o si después de instalarlo sigue sin ser compatible. Corre antes de crear nada de Workers.
ensure_engines() {
  local installer_url installer engines_proto
  if engines_is_compatible; then
    printf 'Forge614 Engines is compatible: %s\n' "$engines_binary"
    return 0
  fi

  # Por defecto el instalador se descarga solo por HTTPS; la variable de prueba permite un archivo local, y solo con la marca de pruebas.
  installer_url='https://github.com/jotredev/forge614-engines/releases/latest/download/install.sh'
  engines_proto='=https'
  if [ -n "${FORGE614_WORKERS_ENGINES_INSTALLER_TEST_URL:-}" ]; then
    [ "${FORGE614_WORKERS_INSTALLER_TEST:-}" = '1' ] || fail 'The Engines installer override is reserved for test fixtures.'
    installer_url="$FORGE614_WORKERS_ENGINES_INSTALLER_TEST_URL"
    case "$installer_url" in file:///*) ;; *) fail 'The Engines test installer must be a local file URL.' ;; esac
    engines_proto='=https,file'
  fi

  printf '%s\n' 'Forge614 Engines 1.17.0 or newer is required; installing the latest release.'
  installer="$download_dir/forge614-engines-install.sh"
  curl --fail --location --proto "$engines_proto" --tlsv1.2 --silent --show-error "$installer_url" --output "$installer" \
    || fail "Could not download the Forge614 Engines installer. Forge614 Workers was not installed. $engines_hint"
  FORGE614_HOME="$forge_home" bash "$installer" < /dev/null \
    || fail "Forge614 Engines could not be installed. Forge614 Workers was not installed. $engines_hint"
  engines_is_compatible \
    || fail "Forge614 Engines is still missing or older than 1.17.0, or does not guarantee the read-only lock. Forge614 Workers was not installed. $engines_hint"
}

# No recibe argumentos (usa `forge_home`, `workers_root`, `bin_dir`, `link` y `force`). Rechaza un destino que no se puede
# usar con seguridad: termina el script con código 1 (vía `fail`) si alguna de las tres carpetas es un enlace o existe pero
# no es carpeta, si la ruta del comando activo es una carpeta (o un enlace que apunta a una carpeta), o si ese comando existe, no es un enlace y no se pasó
# `--force`. Si todo está bien, devuelve 0. Se llama antes y después de asegurar Engines.
check_destination() {
  [ ! -L "$forge_home" ] && { [ ! -e "$forge_home" ] || [ -d "$forge_home" ]; } \
    || fail 'The Forge614 home must be a real directory, not a link.'
  [ ! -L "$workers_root" ] && { [ ! -e "$workers_root" ] || [ -d "$workers_root" ]; } \
    || fail 'The Workers installation folder must be a real directory, not a link.'
  [ ! -L "$bin_dir" ] && { [ ! -e "$bin_dir" ] || [ -d "$bin_dir" ]; } \
    || fail 'The Workers bin folder must be a real directory, not a link.'
  [ ! -d "$link" ] || fail 'The active command path is a directory; remove it and run the installer again.'
  if [ -e "$link" ] && [ ! -L "$link" ] && [ "$force" -ne 1 ]; then
    fail 'The active command exists and is not a link. Use --force to replace it explicitly.'
  fi
}

# Valores por defecto de las opciones: sin versión (se toma la última), sin `--force` y `--version` aún no visto.
version=''
force=0
seen_version=0

# Lee las opciones una por una: `--help`/`-h` imprime la ayuda y sale con 0; `--version` exige un único valor que no
# empiece con `--`; `--force` activa el reemplazo; cualquier otra cosa termina con código 1.
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --version)
      [ "$#" -ge 2 ] && [ -n "$2" ] && [ "$seen_version" -eq 0 ] || fail 'Specify one tag for --version.'
      case "$2" in --*) fail 'Specify a valid tag for --version.' ;; esac
      version="$2"
      seen_version=1
      shift 2 ;;
    --force) force=1; shift ;;
    *) fail 'Unknown option. See: bash scripts/install.sh --help' ;;
  esac
done

# La etiqueta pedida debe ser una versión semántica (tres números, con `v` inicial y sufijo como `-beta.1` opcionales).
if [ -n "$version" ] && ! [[ "$version" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z][0-9A-Za-z.-]*)?$ ]]; then
  fail 'Invalid release tag. Use a semantic version tag such as v1.2.3.'
fi

# Rutas de la instalación. Si `FORGE614_HOME` está definida y no vacía debe ser una ruta absoluta (una relativa termina con error); si no está definida o está vacía se usa `$HOME/.forge614`, y solo en ese caso, si `HOME` tampoco está definida o está vacía, el shell termina con error.
repo='jotredev/forge614-workers'
forge_home="${FORGE614_HOME:-${HOME:?HOME must be set}/.forge614}"
case "$forge_home" in /*) ;; *) fail 'FORGE614_HOME must be an absolute path.' ;; esac
workers_root="$forge_home/workers"
bin_dir="$workers_root/bin"
link="$bin_dir/forge614-workers"
engines_binary="$forge_home/engines/bin/forge614-engines"

# El nombre del binario publicado depende del sistema operativo y de la arquitectura; otros no se admiten.
case "$(uname -s)/$(uname -m)" in
  Darwin/x86_64) artifact='forge614-workers-darwin-x64' ;;
  Darwin/arm64) artifact='forge614-workers-darwin-arm64' ;;
  Linux/x86_64) artifact='forge614-workers-linux-x64' ;;
  Linux/aarch64) artifact='forge614-workers-linux-arm64' ;;
  *) fail 'Unsupported operating system or architecture. Supported: macOS x64/arm64 and Linux x64/arm64.' ;;
esac

# Herramientas necesarias: `curl` para descargar y `shasum` o, si no está, `sha256sum` para verificar la huella.
command -v curl >/dev/null 2>&1 || fail 'curl is required to download a release.'
if command -v shasum >/dev/null 2>&1; then
  checksum_tool='shasum'
elif command -v sha256sum >/dev/null 2>&1; then
  checksum_tool='sha256sum'
else
  fail 'A SHA-256 command is required: shasum or sha256sum.'
fi

# Se revisa el destino antes de descargar nada, para no gastar red si no se va a poder instalar.
check_destination

# Dirección de los metadatos de la versión en la API de GitHub: la última (`latest`) o la etiqueta pedida (`tags/<versión>`).
selector='latest'
if [ -n "$version" ]; then selector="tags/$version"; fi
release_json_url="https://api.github.com/repos/${repo}/releases/${selector}"
curl_protocol='=https'
test_endpoint=0

# Este punto de entrada existe solo para las pruebas desechables del instalador.
# No es una opción de instalación admitida ni forma parte de la ayuda para el usuario.
if [ -n "${FORGE614_WORKERS_TEST_RELEASE_BASE_URL:-}" ]; then
  [ "${FORGE614_WORKERS_INSTALLER_TEST:-}" = '1' ] || fail 'The release endpoint override is reserved for test fixtures.'
  test_base_url="${FORGE614_WORKERS_TEST_RELEASE_BASE_URL%/}"
  is_loopback_test_url "$test_base_url" || fail 'The test release endpoint must be a loopback HTTP URL with an explicit numeric port.'
  release_json_url="${test_base_url}/repos/${repo}/releases/${selector}"
  curl_protocol='=http,https'
  test_endpoint=1
fi

# Carpeta temporal donde se descargan los archivos; `cleanup` la borra al terminar.
download_dir="$(mktemp -d "${TMPDIR:-/tmp}/forge614-workers-release.XXXXXX")"
staging=''
link_staging=''
target=''
created_target=0
completed=0
# No recibe argumentos. Corre al terminar el script (trampa `trap ... EXIT`), con éxito o con error: borra los archivos
# temporales de instalación, la carpeta de versión creada en esta corrida si la instalación no se completó y la carpeta de
# descargas. Usa `rm -f`/`rm -rf`, que no fallan si el archivo ya no existe, y no llama a `exit`: no cambia el código de salida.
cleanup() {
  [ -z "$staging" ] || rm -f -- "$staging"
  [ -z "$link_staging" ] || rm -f -- "$link_staging"
  # Una carpeta de versión creada por esta corrida se borra de nuevo si la corrida no terminó.
  if [ "$created_target" -eq 1 ] && [ "$completed" -ne 1 ] && [ -n "$target" ]; then rm -rf -- "$target"; fi
  rm -rf -- "$download_dir"
}
trap cleanup EXIT

# Recibe la dirección a descargar ($1) y el archivo donde guardarla ($2). Devuelve el código de `curl`: distinto de cero si
# falla la conexión o el servidor responde con error (`--fail`). No termina el script: quien la llama usa `|| fail`.
# Solo acepta los protocolos de `curl_protocol` (HTTPS, o también HTTP en las pruebas) y exige TLS 1.2 o más nuevo.
download() {
  curl --fail --location --proto "$curl_protocol" --tlsv1.2 --silent --show-error "$1" --output "$2"
}

# Recibe el nombre de un archivo de la versión publicada ($1) y escribe en stdout su dirección de descarga, leída de
# `release.json`. Elige las direcciones que terminan con ese texto (compara el final de la dirección, no el nombre completo del
# archivo: `x-SHA256SUMS` también valdría). Devuelve 0 solo si hay exactamente una; con ninguna o con varias devuelve 1 (el
# `exit 1` del `awk`, que por ser el último comando de la tubería es el código de toda ella) y no imprime nada.
asset_url() {
  local asset_name="$1"
  # `tr` pone cada objeto del JSON en su propia línea, `sed` extrae el valor de `browser_download_url` y `awk` conserva
  # las direcciones que terminan con el nombre pedido y cuenta cuántas son.
  tr '{' '\n' < "$download_dir/release.json" \
    | sed -n 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"[:space:]]*\)".*/\1/p' \
    | awk -v asset_name="$asset_name" '
        substr($0, length($0) - length(asset_name) + 1) == asset_name {
          count += 1
          url = $0
        }
        END {
          if (count != 1) exit 1
          print url
        }
      '
}

# Se descargan los metadatos de la versión y se lee su etiqueta (`tag_name`, la primera que aparezca) sin la `v` inicial.
download "$release_json_url" "$download_dir/release.json" || fail 'Could not download release metadata.'
tag="$(sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$download_dir/release.json" | head -n 1)"
release_version="${tag#v}"
[[ "$release_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z][0-9A-Za-z.-]*)?$ ]] || fail 'The release metadata does not carry a valid version tag.'
target="$workers_root/$release_version"
command_path="$target/forge614-workers"

# Si esa versión ya es la activa y no se pidió `--force`, no hay nada que hacer: se avisa y se sale con 0.
if [ "$force" -ne 1 ] && [ -L "$link" ] && [ "$(readlink "$link")" = "$command_path" ] && [ -x "$command_path" ]; then
  printf 'Forge614 Workers v%s is already active.\n' "$release_version"
  exit 0
fi

# Direcciones del archivo de sumas y del binario de esta plataforma. En pruebas deben ser locales; en uso real, HTTPS.
manifest_url="$(asset_url SHA256SUMS)" || fail 'The release is missing SHA256SUMS.'
binary_url="$(asset_url "$artifact")" || fail "The release is missing the ${artifact} binary."
if [ "$test_endpoint" -eq 1 ]; then
  is_loopback_test_url "$manifest_url" || fail 'Release metadata contains an unsafe test fixture URL.'
  is_loopback_test_url "$binary_url" || fail 'Release metadata contains an unsafe test fixture URL.'
else
  case "$manifest_url/$binary_url" in https://*/*) ;; *) fail 'Release assets must use HTTPS URLs.' ;; esac
fi

# Se descargan las sumas y el binario, y se compara la huella SHA-256 esperada (la que da `SHA256SUMS`, que debe
# traer exactamente una línea válida (nombre igual al del binario y 64 caracteres hexadecimales en minúscula) para este binario) con la del archivo descargado.
download "$manifest_url" "$download_dir/SHA256SUMS" || fail 'Could not download SHA256SUMS.'
download "$binary_url" "$download_dir/$artifact" || fail "Could not download ${artifact}."
expected_digest="$(awk -v artifact="$artifact" '
  $2 == artifact && length($1) == 64 && $1 ~ /^[0-9a-f]+$/ { count += 1; digest = $1 }
  END { if (count != 1) exit 1; print digest }
' "$download_dir/SHA256SUMS")" || fail "SHA256SUMS does not contain one valid digest for ${artifact}."
if [ "$checksum_tool" = 'shasum' ]; then
  actual_digest="$(shasum -a 256 -- "$download_dir/$artifact" | awk '{print $1}')"
else
  actual_digest="$(sha256sum -- "$download_dir/$artifact" | awk '{print $1}')"
fi
[ "$expected_digest" = "$actual_digest" ] || fail "Checksum verification failed for ${artifact}."

# Se comprueba Engines (y se instala si hace falta) antes de crear nada de Workers.
ensure_engines
check_destination

# Se crean las carpetas que falten (la de `FORGE614_HOME` con permisos 700 solo si no existía) y `workers`, `workers/bin` y la carpeta de la versión se dejan siempre con permisos 700 (solo el dueño), existieran o no. Si la carpeta de la versión no existía, se marca para que `cleanup` la borre si la instalación no llega al final.
if [ ! -e "$forge_home" ]; then mkdir -p -- "$forge_home" && chmod 700 "$forge_home"; fi
mkdir -p -- "$workers_root" "$bin_dir" || fail 'Could not create the Workers installation folders.'
if [ ! -d "$target" ]; then created_target=1; fi
mkdir -p -- "$target" || fail 'Could not create the Workers version folder.'
chmod 700 "$workers_root" "$bin_dir" "$target"

# El binario se coloca con un renombrado atómico (que ocurre de una vez o no ocurre) dentro de su carpeta de versión, y el
# enlace activo se cambia también con un renombrado atómico, de modo que el comando activo nunca queda a medio escribir.
# `$$` es el número del proceso del script y evita que dos instalaciones simultáneas usen el mismo nombre para el enlace temporal; el binario temporal ya tiene un nombre único por `mktemp`.
staging="$(mktemp "$target/.forge614-workers.XXXXXX")"
cp -- "$download_dir/$artifact" "$staging"
chmod 755 "$staging"
mv -f -- "$staging" "$command_path"
staging=''
link_staging="$bin_dir/.forge614-workers.$$"
rm -f -- "$link_staging"
ln -s -- "$command_path" "$link_staging"
mv -f -- "$link_staging" "$link"
link_staging=''
# Con `completed=1`, `cleanup` ya no borra la carpeta de la versión.
completed=1

printf 'Installed Forge614 Workers v%s at %s\n' "$release_version" "$link"
printf '%s\n' 'Forge614 Workers is an internal dependency — it is not added to PATH.'
printf '%s\n' 'Other Forge614 products call it directly by this path.'
