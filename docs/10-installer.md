# 10. Instalador, actualización y publicación

> **Traducción hermana:** [10 (EN). Installer, update, and release](10-installer.en.md).

## Instalar

El portero Unix se instala con `curl -fsSL https://github.com/jotredev/forge614-workers/releases/latest/download/install.sh | bash`; en Windows x64 se descarga `install.ps1` y se ejecuta con `powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1`. Ambos requieren Node.js 22.19.0 o posterior y verifican los activos con `SHA256SUMS` GNU. `install.mjs` es la plantilla común y queda copiado sin cambios en cada release.

La ficha [forge614.node.json](../forge614.node.json) fija las plataformas, el repositorio, los activos y Engines 1.17.0 con `supportsReadOnly`. La puerta guarda el binario en `FORGE614_HOME/workers/<versión>/` y publica el lanzador en `workers/bin/`. En Windows x64 el lanzador activo es una copia `.exe`; en Unix es un enlace simbólico. La migración desde 1.0.2 conserva el enlace anterior bajo `legacy-*` y deja las carpetas antiguas de versión.

## Actualizar

`forge614-workers update` descarga el portero de la release más reciente, comprueba la huella y lo ejecuta con la etiqueta resuelta. `update --version 1.1.1` elige una versión concreta; `--json` emite un objeto JSON. Workers lee la versión instalada con `workers/bin/forge614-workers --version`; si el instalador termina sin cambiarla, devuelve `updated: false`. En Windows aparca la copia `.exe` activa antes de reemplazarla y la restaura si falla el instalador. Si la actualización tiene éxito, conserva esa imagen como `forge614-workers.exe.old-*` hasta la siguiente orden `update` o `uninstall`, que intenta eliminarla; Windows no permite borrar el ejecutable que sigue corriendo.

## Desinstalar

`forge614-workers uninstall` confirma antes de borrar la carpeta completa `FORGE614_HOME/workers`; Engines queda intacto. `--json` omite la pregunta interactiva. Rechaza la operación si el directorio actual está dentro de la carpeta que se borraría. `n`, Ctrl+C, Ctrl+D y fin de entrada cancelan con código 130. `uninstall --self` informa que Workers no tiene integraciones propias y lo usa el instalador común al limpiar.

## Release y CI

La release compila cinco ejecutables nativos: macOS arm64/x64, Linux arm64/x64 y Windows x64. Cada runner prueba `--version` y `--version --json`. `scripts/prepare-release-assets.mjs` copia sin cambios los dos porteros, `install.mjs` y `forge614.node.json`, y crea una única suma GNU que cubre los cinco binarios y esos cuatro archivos: diez activos al contar `SHA256SUMS`. `release:publish` solo acepta `vX.Y.Z` igual a `package.json`.

La CI verifica en Ubuntu, macOS y `windows-latest`. Windows se comprueba únicamente en CI, no en una máquina real. La suite de instalación, actualización y desinstalación usa entornos temporales y un servidor local de loopback.
