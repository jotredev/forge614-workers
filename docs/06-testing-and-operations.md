# 06. Testing y operación

## Estrategia

La mayoría de pruebas inyectan dependencias y simulan solo los procesos costosos de Claude/Codex. Esto mantiene las pruebas rápidas y deterministas. `engines-client.test.ts` y el test de completitud del registro usan el binario real instalado de `forge614-engines`: resolver un comando es barato y no invoca una IA. Esas pruebas necesitan forge614-engines 1.17.0 o posterior (candado de solo lectura y `supportsReadOnly`); `FORGE614_ENGINES_BIN` permite apuntar a otro binario.

## Comandos

```bash
bun test
bun run typecheck
bun run build
```

`bun build --compile` genera `dist/forge614-workers`. Para release se usan `bun run build:target` y `bun run smoke:target` con `FORGE614_TARGET`.

`--version`, `--version --json`, `update [--version X.Y.Z] [--json]` y `uninstall [--json|--self]` se procesan antes de leer stdin. Los comandos de gestión emiten JSON en modo `--json` y códigos de error estables. Windows x64 usa terminación directa de proceso al vencer un tiempo límite; la prueba que exige ignorar SIGTERM solo corre en Unix.

## Integración continua

`.github/workflows/verify.yml` verifica Ubuntu y Windows con Bun 1.4.2, y fija Forge614 Engines 1.17.0 para las pruebas de integración. Windows se prueba en CI solamente, no en una máquina real.

## Instalación y publicación

Los porteros `install.sh` e `install.ps1` descargan y verifican `install.mjs`, la ficha y los binarios según `forge614.node.json`. Se requiere Node.js 22.19.0. El instalador comprueba Engines antes de instalar Workers; Windows publica una copia `.exe` en `workers/bin/`, mientras Unix usa un enlace. La e2e usa `HOME` y `FORGE614_HOME` temporales y servidor de loopback.

`.github/workflows/release.yml` compila cinco binarios nativos (macOS/Linux x64 y arm64, Windows x64), ejecuta `smoke:target`, prepara diez activos y publica solo el tag que coincide con `package.json` mediante `release:publish`.

## Qué debe cubrirse

- Orden estrictamente secuencial y pausa inmediata por cuota.
- `run_completed` en todo camino no fatal.
- Timeout con terminación forzada; la prueba que ignora `SIGTERM` solo corre en Unix.
- Truncamiento con conteo real de bytes.
- cwd vacío, herencia completa de entorno y limpieza temporal.
- spawn error, JSON inválido y binario Engines no ejecutable.
- Registro completo: todo agente headless de Engines tiene adapter.
- Candado de solo lectura: una tarea `readOnly` sin candado confirmado no lanza ninguna orden.
- Validación de `readOnly` (solo `true`/`false`/ausente) y de los cinco niveles de razonamiento.
- `--version --json`, `update` con un portero local verificado y `uninstall` sin borrar Engines.
- E2E de instalación, actualización y desinstalación mediante loopback y homes temporales.
- Windows x64 instala, actualiza desde el ejecutable activo y desinstala en CI.
- `FORGE614_HOME` absoluto respetado y relativo rechazado.
- Versiones alineadas entre `package.json`, `docs/08` (es/en) y `CHANGELOG.md`.

No se deben lanzar CLIs de IA reales en la suite normal.
