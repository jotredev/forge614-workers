# 08. Índice exhaustivo de fuentes

## Producto y contratos

- `README.md` y `README.en.md`: entrada del proyecto (qué es, instalación, entrada/salida y documentación) en español e inglés.
- `package.json`: versión `1.1.0`, scripts de verificación, compilación y publicación y dependencias.
- `tsconfig.json`: tipado estricto de `src`, `test` y `scripts`.
- `CHANGELOG.md`: historial de versiones (una entrada `## <versión>` por release).
- `LICENSE` y `SECURITY.md`: licencia y política de seguridad.
- `forge614.node.json`: identidad del nodo, huella del estándar y contrato de instalación.
- `install.sh` e `install.ps1`: porteros Unix y Windows que cargan la plantilla compartida `install.mjs`.
- `install.mjs` y `scripts/prepare-release-assets.mjs`: plantillas comunes copiadas sin cambios.
- `scripts/build-target.mjs`, `scripts/smoke-target.mjs` y `scripts/release-publish.mjs`: herramientas de compilación, humo y publicación.
- `.github/workflows/verify.yml` y `.github/workflows/release.yml`: verificación en cada push y PR, y publicación de binarios.
- `.forge614/project.json`: identidad portátil del proyecto en Engram (id del proyecto y del grupo `forge614`).
- `docs/superpowers/specs/2026-09-20-forge614-workers-design.md`: especificación aprobada.
- `docs/superpowers/plans/2026-09-20-forge614-workers-implementation.md`: plan de implementación.

## Código de producción

- `src/types.ts`: entrada, defaults, validación, tipos de eventos y razones.
- `src/engines-client.ts`: cliente subprocess de Engines (`headless` y `capabilities`).
- `src/process-runner.ts`: spawn, stdin, cwd, timeout, captura y limpieza.
- `src/runner.ts`: orquestación secuencial y resumen.
- `src/adapters/contract.ts`: interfaz `EngineAdapter`.
- `src/adapters/claude-code.ts`: cuota Claude; sin argumentos extra.
- `src/adapters/codex.ts`: cuota Codex y `--skip-git-repo-check`.
- `src/adapters/registry.ts`: registro de adapters.
- `src/adapters/_template.ts`: plantilla de extensión.
- `src/cli.ts`: frontera de entrada/salida y fatal errors.
- `src/installer-actions.ts`: descarga y verifica el portero; actualiza, desinstala y gestiona la copia ejecutable de Windows.
- `src/updater.ts`: analizador de `update`, salida de texto/JSON y ruta del lanzador instalado.
- `src/uninstall.ts`: confirmación, cancelación y salida de `uninstall`/`uninstall --self`.
- `src/main.ts`: punto de entrada del binario; atiende `--version`/`--help`/`update`/`uninstall` antes de leer stdin y toma la versión de `package.json`.

## Tests y fixtures

Los tests `src/**/*.test.ts` cubren tipos, adapters, registro, Engines client, runner, proceso, instalación, actualización, desinstalación y CLI. `test/versions.test.ts` exige versiones alineadas. `test/e2e.test.ts` cubre CLI y lotes; `tests/e2e/` instala desde una publicación local, migra 1.0.2, actualiza y desinstala. `tests/e2e/windows-installer.e2e.test.ts` cubre Windows en CI. `test/fixtures/` contiene procesos falsos para tareas y Engines.

## Documentación de mantenimiento

- `docs/adding-a-new-engine-adapter.md`: procedimiento operativo completo.
- `docs/00`–`docs/08`: fuente revisada bilingüe y navegable.
- `docs/09-data-files.md` y `docs/09-data-files.en.md`: campos de archivos de datos, configuración, fixtures y apoyos de pruebas.
- `docs/10-installer.md` y `docs/10-installer.en.md`: instalador, `update` y flujos de verificación/publicación.
- `docs/11-troubleshooting.md` y `docs/11-troubleshooting.en.md`: códigos, mensajes y acciones de diagnóstico.
- `docs/12-glossary.md` y `docs/12-glossary.en.md`: vocabulario del contrato de Workers.
- `CONTRACT.md` y `CONTRACT.en.md`: contrato público de Workers (comandos, códigos de salida, razones de fallo).
- `docs/notion-map.json`: mapa local ↔ Notion con la huella sha256 de cada manual 00–08 (09–12 y `CONTRACT.md` aún no figuran).
