#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' \
    'Install a verified Forge614 Workers release binary.' \
    'Usage: bash scripts/install.sh [--version TAG] [--force]' \
    'Destination: $FORGE614_HOME (default $HOME/.forge614)/workers/<version>/forge614-workers,' \
    'with the active version linked at workers/bin/forge614-workers.' \
    '--force reinstalls the same version or replaces a command that is not a link.' \
    'Requires Forge614 Engines 1.17.0 or newer; it is installed first when missing or too old.' \
    'Nothing is installed when a requirement cannot be met.'
}

fail() { printf '%s\n' "$1" >&2; exit 1; }

# Oldest Forge614 Engines that guarantees the read-only lock Workers relies on.
min_engines_major=1
min_engines_minor=17
min_engines_patch=0
engines_hint='Install or update it with: curl -fsSL https://github.com/jotredev/forge614-engines/releases/latest/download/install.sh | bash'

is_loopback_test_url() {
  local url="$1"
  local port
  [[ "$url" =~ ^http://(127\.0\.0\.1|localhost):([0-9]+)(/[^\?#]*)?$ ]] || return 1
  port="${BASH_REMATCH[2]}"
  (( 10#$port >= 1 && 10#$port <= 65535 ))
}

# Succeeds only when the installed Engines runs, is at least the minimum version and
# reports `supportsReadOnly: true` for Claude Code.
engines_is_compatible() {
  local version_output capabilities major minor patch
  local version_pattern='^forge614-engines ([0-9]+)\.([0-9]+)\.([0-9]+)'
  [ -x "$engines_binary" ] || return 1
  version_output="$("$engines_binary" --version 2>/dev/null)" || return 1
  [[ "$version_output" =~ $version_pattern ]] || return 1
  major="${BASH_REMATCH[1]}"
  minor="${BASH_REMATCH[2]}"
  patch="${BASH_REMATCH[3]}"
  (( 10#$major > min_engines_major \
    || (10#$major == min_engines_major && (10#$minor > min_engines_minor \
    || (10#$minor == min_engines_minor && 10#$patch >= min_engines_patch))) )) || return 1
  capabilities="$("$engines_binary" capabilities --agent claude-code 2>/dev/null)" || return 1
  grep -Eq '"supportsReadOnly"[[:space:]]*:[[:space:]]*true' <<< "$capabilities"
}

# Makes sure a compatible Engines is installed, installing the latest one when it is
# missing or does not qualify. Runs before anything of Workers is created.
ensure_engines() {
  local installer_url installer engines_proto
  if engines_is_compatible; then
    printf 'Forge614 Engines is compatible: %s\n' "$engines_binary"
    return 0
  fi

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
    || fail "Could not download the Forge614 Engines installer. $engines_hint. Forge614 Workers was not installed."
  FORGE614_HOME="$forge_home" bash "$installer" < /dev/null \
    || fail "Forge614 Engines could not be installed. $engines_hint. Forge614 Workers was not installed."
  engines_is_compatible \
    || fail "Forge614 Engines is still missing or older than 1.17.0, or does not guarantee the read-only lock. $engines_hint. Forge614 Workers was not installed."
}

# Refuses a destination that cannot be used safely; run before and after Engines is ensured.
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

version=''
force=0
seen_version=0

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

if [ -n "$version" ] && ! [[ "$version" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z][0-9A-Za-z.-]*)?$ ]]; then
  fail 'Invalid release tag. Use a semantic version tag such as v1.2.3.'
fi

repo='jotredev/forge614-workers'
forge_home="${FORGE614_HOME:-${HOME:?HOME must be set}/.forge614}"
case "$forge_home" in /*) ;; *) fail 'FORGE614_HOME must be an absolute path.' ;; esac
workers_root="$forge_home/workers"
bin_dir="$workers_root/bin"
link="$bin_dir/forge614-workers"
engines_binary="$forge_home/engines/bin/forge614-engines"

case "$(uname -s)/$(uname -m)" in
  Darwin/x86_64) artifact='forge614-workers-darwin-x64' ;;
  Darwin/arm64) artifact='forge614-workers-darwin-arm64' ;;
  Linux/x86_64) artifact='forge614-workers-linux-x64' ;;
  Linux/aarch64) artifact='forge614-workers-linux-arm64' ;;
  *) fail 'Unsupported operating system or architecture. Supported: macOS x64/arm64 and Linux x64/arm64.' ;;
esac

command -v curl >/dev/null 2>&1 || fail 'curl is required to download a release.'
if command -v shasum >/dev/null 2>&1; then
  checksum_tool='shasum'
elif command -v sha256sum >/dev/null 2>&1; then
  checksum_tool='sha256sum'
else
  fail 'A SHA-256 command is required: shasum or sha256sum.'
fi

check_destination

selector='latest'
if [ -n "$version" ]; then selector="tags/$version"; fi
release_json_url="https://api.github.com/repos/${repo}/releases/${selector}"
curl_protocol='=https'
test_endpoint=0

# This endpoint is intentionally available only to the disposable installer tests.
# It is neither a supported installation option nor part of the user help.
if [ -n "${FORGE614_WORKERS_TEST_RELEASE_BASE_URL:-}" ]; then
  [ "${FORGE614_WORKERS_INSTALLER_TEST:-}" = '1' ] || fail 'The release endpoint override is reserved for test fixtures.'
  test_base_url="${FORGE614_WORKERS_TEST_RELEASE_BASE_URL%/}"
  is_loopback_test_url "$test_base_url" || fail 'The test release endpoint must be a loopback HTTP URL with an explicit numeric port.'
  release_json_url="${test_base_url}/repos/${repo}/releases/${selector}"
  curl_protocol='=http,https'
  test_endpoint=1
fi

download_dir="$(mktemp -d "${TMPDIR:-/tmp}/forge614-workers-release.XXXXXX")"
staging=''
link_staging=''
target=''
created_target=0
completed=0
cleanup() {
  [ -z "$staging" ] || rm -f -- "$staging"
  [ -z "$link_staging" ] || rm -f -- "$link_staging"
  # A version folder created by this run is removed again when the run did not finish.
  if [ "$created_target" -eq 1 ] && [ "$completed" -ne 1 ] && [ -n "$target" ]; then rm -rf -- "$target"; fi
  rm -rf -- "$download_dir"
}
trap cleanup EXIT

download() {
  curl --fail --location --proto "$curl_protocol" --tlsv1.2 --silent --show-error "$1" --output "$2"
}

asset_url() {
  local asset_name="$1"
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

download "$release_json_url" "$download_dir/release.json" || fail 'Could not download release metadata.'
tag="$(sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$download_dir/release.json" | head -n 1)"
release_version="${tag#v}"
[[ "$release_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z][0-9A-Za-z.-]*)?$ ]] || fail 'The release metadata does not carry a valid version tag.'
target="$workers_root/$release_version"
command_path="$target/forge614-workers"

if [ "$force" -ne 1 ] && [ -L "$link" ] && [ "$(readlink "$link")" = "$command_path" ] && [ -x "$command_path" ]; then
  printf 'Forge614 Workers v%s is already active.\n' "$release_version"
  exit 0
fi

manifest_url="$(asset_url SHA256SUMS)" || fail 'The release is missing SHA256SUMS.'
binary_url="$(asset_url "$artifact")" || fail "The release is missing the ${artifact} binary."
if [ "$test_endpoint" -eq 1 ]; then
  is_loopback_test_url "$manifest_url" || fail 'Release metadata contains an unsafe test fixture URL.'
  is_loopback_test_url "$binary_url" || fail 'Release metadata contains an unsafe test fixture URL.'
else
  case "$manifest_url/$binary_url" in https://*/*) ;; *) fail 'Release assets must use HTTPS URLs.' ;; esac
fi

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

# Engines is checked (and installed when needed) before anything of Workers is created.
ensure_engines
check_destination

if [ ! -e "$forge_home" ]; then mkdir -p -- "$forge_home" && chmod 700 "$forge_home"; fi
mkdir -p -- "$workers_root" "$bin_dir" || fail 'Could not create the Workers installation folders.'
if [ ! -d "$target" ]; then created_target=1; fi
mkdir -p -- "$target" || fail 'Could not create the Workers version folder.'
chmod 700 "$workers_root" "$bin_dir" "$target"

# The binary is placed with an atomic rename inside its version folder, and the active
# link is switched with an atomic rename too, so the active command is never half-written.
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
completed=1

printf 'Installed Forge614 Workers v%s at %s\n' "$release_version" "$link"
printf '%s\n' 'Forge614 Workers is an internal dependency — it is not added to PATH.'
printf '%s\n' 'Other Forge614 products call it directly by this path.'
