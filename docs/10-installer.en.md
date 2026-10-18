# 10. Installer, update, and release

> **Sibling translation:** [10 (ES). Instalador, actualización y publicación](10-installer.md).

## Install

Install on Unix with `curl -fsSL https://github.com/jotredev/forge614-workers/releases/latest/download/install.sh | bash`; on Windows x64, download `install.ps1` and run `powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1`. Both require Node.js 22.19.0 or later and verify release files against GNU-format `SHA256SUMS`. `install.mjs` is the shared template and is copied unchanged into every release.

The [forge614.node.json](../forge614.node.json) pointer declares platforms, repository, assets, and the Engines 1.17.0 `supportsReadOnly` requirement. The gatekeeper stores the binary in `FORGE614_HOME/workers/<version>/` and publishes its launcher in `workers/bin/`. On Windows x64 the active launcher is a copied `.exe`; on Unix it is a symbolic link. Migration from 1.0.2 retains the old link under `legacy-*` and leaves old version folders in place.

## Update

`forge614-workers update` downloads the gatekeeper for the latest release, verifies its checksum, and invokes it with the resolved tag. `update --version 1.1.1` selects a specific version; `--json` emits a JSON object. Workers reads the installed version with `workers/bin/forge614-workers --version`; if the installer exits without changing it, the result is `updated: false`. On Windows it parks the active `.exe` copy before replacement and restores it if the installer fails. After a successful update, that image remains as `forge614-workers.exe.old-*` until the next `update` or `uninstall`, which attempts to remove it; Windows cannot delete the executable that is still running.

## Uninstall

`forge614-workers uninstall` asks before deleting the full `FORGE614_HOME/workers` directory; Engines remains intact. `--json` skips the interactive prompt. The command refuses to run when the current directory is inside the directory it would delete. `n`, Ctrl+C, Ctrl+D, and end of input cancel with exit code 130. `uninstall --self` reports that Workers has no integrations of its own and is called by the shared installer during cleanup.

## Release and CI

The release compiles five native executables: macOS arm64/x64, Linux arm64/x64, and Windows x64. Each native runner checks `--version` and `--version --json`. `scripts/prepare-release-assets.mjs` copies both gatekeepers, `install.mjs`, and `forge614.node.json` unchanged, then creates one GNU checksum file covering the five binaries and those four files: ten assets including `SHA256SUMS`. `release:publish` accepts only a `vX.Y.Z` tag matching `package.json`.

CI verifies on Ubuntu, macOS, and `windows-latest`. Windows is tested in CI only, not on a physical machine. Installation, update, and uninstall tests use temporary environments and a local loopback server.
