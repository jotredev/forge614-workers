# 08. Índice exhaustivo de fuentes

## Producto y contratos

- `README.md` y `README.en.md`: entrada del proyecto (qué es, instalación, entrada/salida y documentación) en español e inglés.
- `package.json`: versión `1.0.0`, scripts de test/typecheck/build y dependencias.
- `tsconfig.json`: tipado estricto de `src`, `test` y `scripts`.
- `CHANGELOG.md`: historial de versiones (una entrada `## <versión>` por release).
- `LICENSE` y `SECURITY.md`: licencia y política de seguridad.
- `scripts/install.sh`: instalador verificado (sha256, Engines compatible, carpeta por versión y enlace activo).
- `.github/workflows/verify.yml` y `.github/workflows/release.yml`: verificación en cada push y PR, y publicación de binarios.
- `FORGE614_ECOSYSTEM_CONTRACT.md`: límites y contratos entre productos.
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
- `src/updater.ts`: comando `update` (descarga del instalador de la última release y ejecución con `--force`, con descarga y proceso inyectables).
- `src/main.ts`: punto de entrada del binario; atiende `--version`/`--help`/`update` antes de leer stdin y toma la versión de `package.json`.

## Tests y fixtures

Los tests `src/**/*.test.ts` cubren tipos, adapters, registro, Engines client, runner, process runner y CLI. `src/updater.test.ts` cubre `update` con dobles. `scripts/__tests__/install.sh.test.ts` prueba el instalador con un HOME temporal. `test/versions.test.ts` exige versiones alineadas. `test/e2e.test.ts` conecta el flujo completo con dobles y comprueba `--version`, `--help` y `update` (con `test/support/fake-update-preload.ts`). `test/fixtures/` contiene procesos que hacen echo de stdin, producen cuota, exceden salida, ignoran SIGTERM, imprimen cwd/env y simulan Engines.

## Documentación de mantenimiento

- `docs/adding-a-new-engine-adapter.md`: procedimiento operativo completo.
- `docs/00`–`docs/08`: fuente revisada bilingüe y navegable.
- `docs/notion-map.json`: mapa local ↔ Notion con la huella sha256 de cada manual.
