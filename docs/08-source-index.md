# 08. Índice exhaustivo de fuentes

## Producto y contratos

- `README.md`: entrada del proyecto (pendiente de ampliar).
- `package.json`: versión `0.1.0`, scripts de test/typecheck/build y dependencias.
- `FORGE614_ECOSYSTEM_CONTRACT.md`: límites y contratos entre productos.
- `docs/superpowers/specs/2026-09-20-forge614-workers-design.md`: especificación aprobada.
- `docs/superpowers/plans/2026-09-20-forge614-workers-implementation.md`: plan de implementación.

## Código de producción

- `src/types.ts`: entrada, defaults, validación, tipos de eventos y razones.
- `src/engines-client.ts`: cliente subprocess de Engines.
- `src/process-runner.ts`: spawn, stdin, cwd, timeout, captura y limpieza.
- `src/runner.ts`: orquestación secuencial y resumen.
- `src/adapters/contract.ts`: interfaz `EngineAdapter`.
- `src/adapters/claude-code.ts`: cuota Claude; sin argumentos extra.
- `src/adapters/codex.ts`: cuota Codex y `--skip-git-repo-check`.
- `src/adapters/registry.ts`: registro de adapters.
- `src/adapters/_template.ts`: plantilla de extensión.
- `src/cli.ts`: frontera de entrada/salida y fatal errors.
- `src/main.ts`: punto de entrada del binario.
- `src/version.ts`: versión pública.

## Tests y fixtures

Los tests `src/**/*.test.ts` cubren tipos, adapters, registro, Engines client, runner, process runner, CLI y versión. `test/e2e.test.ts` conecta el flujo completo con dobles. `test/fixtures/` contiene procesos que hacen echo de stdin, producen cuota, exceden salida, ignoran SIGTERM, imprimen cwd/env y simulan Engines.

## Documentación de mantenimiento

- `docs/adding-a-new-engine-adapter.md`: procedimiento operativo completo.
- `docs/00`–`docs/08`: fuente revisada bilingüe y navegable.
