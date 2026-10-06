# 10. Installer, update, and release

> **Product version:** that of `package.json`
> **Sibling translation:** [10 (ES). Instalador, actualización y publicación](10-installer.md)

## Purpose

The installer downloads a published binary, verifies its digest, ensures compatible Engines, and activates the version through a symbolic link (`scripts/install.sh:237-305`). It supports only macOS and Linux, x64 and arm64 (`scripts/install.sh:149-156`).

## Requirements and options

It requires Bash with `set -euo pipefail`, `curl`, and either `shasum` or `sha256sum`; Engines must be 1.17.0 or newer and report `supportsReadOnly: true` for `claude-code`, the only agent the installer queries (`scripts/install.sh:7,24-28,43-64,158-166`).

| Option | Result | Source |
|---|---|---|
| `--version TAG` | Selects `tags/TAG`; requires a semantic tag and may appear only once. | `scripts/install.sh:13,124-137,171-174` |
| `--force` | Reinstalls the same version and permits replacing an active command that is not a link. | `scripts/install.sh:16,109-110,130,245-249` |
| `--help`, `-h` | Prints help and exits 0. | `scripts/install.sh:9-19,123` |

## `FORGE614_HOME`

When `FORGE614_HOME` is set and non-empty it must be absolute; when missing or empty, `$HOME/.forge614` is used. Each version's binary is placed at `<home>/workers/<version>/forge614-workers`, the active command at `<home>/workers/bin/forge614-workers`, and Engines at `<home>/engines/bin/forge614-engines` (`scripts/install.sh:140-147,242-243`). The `update` command uses the same default path but does not validate that a defined `FORGE614_HOME` is absolute (`src/updater.ts:36-47`).

## Installer functions

| Function | Input | What it does | Exit code |
|---|---|---|---|
| `usage` | Nothing | Prints options, destination, and the Engines requirement. | Last `printf`, normally 0 (`scripts/install.sh:9-19`). |
| `fail` | Message in `$1` | Writes it to stderr and exits the script. | Always 1 (`scripts/install.sh:21-22`). |
| `is_loopback_test_url` | URL in `$1` | Accepts only local HTTP with port 1–65535 and a path without query or fragment. | 0 on match; 1 otherwise (`scripts/install.sh:30-40`). |
| `engines_is_compatible` | Global path and minimum-version variables | Runs `--version`, compares all three numbers, and queries `capabilities --agent claude-code` (`scripts/install.sh:62`). | 0 only with a sufficient version and `supportsReadOnly: true`; 1 on any failure (`scripts/install.sh:43-64`). |
| `ensure_engines` | Global variables | Reuses compatible Engines or downloads and runs its installer, then checks again. | 0 when compatible; 1 through `fail` on rejection (`scripts/install.sh:66-95`). |
| `check_destination` | Global destination variables and `force` | Rejects linked folders, non-folders, and unsafe active commands. | 0 when safe; 1 through `fail` (`scripts/install.sh:97-112`). |
| `cleanup` | Global temporary variables | Removes staging, temporary link, downloads, and an incomplete version folder. | Does not call `exit`; preserves the prior code (`scripts/install.sh:189-206`). |
| `download` | URL and destination file | Runs `curl` with the allowed protocol, TLS 1.2, redirects, and HTTP failure handling. | `curl`'s code (`scripts/install.sh:208-213`). |
| `asset_url` | Expected URL-ending text | Extracts `browser_download_url` and requires exactly one URL ending with the text. | 0 plus URL for one match; 1 for zero or multiple (`scripts/install.sh:215-235`). |

## Step-by-step flow

1. Parses options and validates the tag (`scripts/install.sh:114-138`).
2. Resolves `FORGE614_HOME`, platform, architecture, and digest tools (`scripts/install.sh:140-166`).
3. Checks the destination before downloading (`scripts/install.sh:168-169`).
4. Selects latest release or a tag. In tests, it accepts only an authorized local HTTP endpoint (`scripts/install.sh:171-187`).
5. Creates a download directory and registers `cleanup` for every exit (`scripts/install.sh:189-206`).
6. Downloads `release.json`, validates `tag_name` and, if the version is already active and `--force` was not passed, prints `Forge614 Workers v<version> is already active.` and exits 0 (`scripts/install.sh:237-249`).
7. Locates `SHA256SUMS` and the binary, restricts their URLs, downloads both, and compares exactly one lowercase SHA-256 digest (`scripts/install.sh:251-274`).
8. Ensures Engines and checks the destination again before creating Workers (`scripts/install.sh:276-278`).
9. Creates the missing folders (the `FORGE614_HOME` one with mode 700 only if it did not exist), leaves `workers`, `workers/bin`, and the version folder at mode 700, copies the binary to a temporary `mktemp` file with mode 755 and moves it with `mv`, and atomically changes the active link (`scripts/install.sh:280-301`).
10. Prints the installed path and states that Workers is not added to `PATH` (`scripts/install.sh:303-305`).

## Test-only variables

| Variable | Read at | Effect |
|---|---|---|
| `FORGE614_WORKERS_INSTALLER_TEST` | `scripts/install.sh:81,181` | Must equal `1` to enable either test override. |
| `FORGE614_WORKERS_TEST_RELEASE_BASE_URL` | `scripts/install.sh:180-186` | Replaces the release API with a local HTTP server with an explicit port. |
| `FORGE614_WORKERS_ENGINES_INSTALLER_TEST_URL` | `scripts/install.sh:80-84` | Replaces the Engines installer with a local `file:///` URL. |
| `FORGE614_ENGINES_BIN` | `test/support/resolve-engines-bin.ts:13-20` | Makes client and registry tests use that executable instead of searching `PATH`. |
| `FAKE_UPDATE_MARKER` | `test/support/fake-update-preload.ts:10` | Names the file where the fake `fetch` and the fake installer record their calls; without it the preload throws (`test/support/fake-update-preload.ts:11`). Set by `test/e2e.test.ts:146`. |

## `update` command

`forge614-workers update` is handled before stdin is read (`src/main.ts:64-71`). It accepts no arguments: any argument produces `forge614-workers update takes no arguments.` and exit 2 (`src/updater.ts:133-143`). It downloads the `latest` installer into a private temporary folder, runs `bash <installer> --force`, removes the installer's temporary folder on every path once downloaded (if writing the file fails, the already-created folder remains), and confirms the version by executing the installed command with `--version` (`src/updater.ts:14-15,50-80,83-119`). Success exits 0; every failure is prefixed with `Could not update forge614-workers:` and exits 1 (`src/updater.ts:144-157`).

## GitHub workflows

### `verify.yml`

The `unix` job runs on Linux and macOS, installs Bun and locked dependencies, downloads Engines 1.17.0, and verifies its digest and the read-only lock for `claude-code`. It then runs the full suite, typecheck, `git diff --check`, and the syntax check for `scripts/install.sh` (`.github/workflows/verify.yml:11-65`). It publishes nothing and has only `contents: read` permission (`.github/workflows/verify.yml:7-8`). It runs on every `pull_request` and every `push` (`.github/workflows/verify.yml:3-5`), with a 20-minute limit and without cancelling the other platform when one fails (`.github/workflows/verify.yml:15,17`).

### `release.yml`

- `verify` repeats the checks, requires a changelog entry for `package.json.version`, and, for a tag, requires `v<version>` (`.github/workflows/release.yml:17-85`).
- `build` compiles four native artifacts, tests `--version` and an empty batch, preserves mode in a `.tar.gz`, and uploads each result (`.github/workflows/release.yml:87-146`).
- `assemble` collects the four binaries, creates `SHA256SUMS`, requires each binary to be non-empty and executable and `SHA256SUMS` to have exactly 4 lines with 64 lowercase hexadecimal digits and the binary name, and verifies the digests again (`.github/workflows/release.yml:148-209`).
- `publish` runs only for a tag push after `verify` and `assemble`; it publishes only the four validated binaries, `SHA256SUMS`, and `install.sh` (`.github/workflows/release.yml:211-248`). A tag containing `-` is published as a prerelease (`.github/workflows/release.yml:235-238`).

A pull request changing the workflow or installer and a manual run verify without publishing; pushing a `v*` tag may reach `publish` (`.github/workflows/release.yml:3-11,215`).
