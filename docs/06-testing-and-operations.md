# 06. Testing y operación

## Estrategia

La mayoría de pruebas inyectan dependencias y simulan solo los procesos costosos de Claude/Codex. Esto mantiene las pruebas rápidas y deterministas. `engines-client.test.ts` y el test de completitud del registro usan el binario real instalado de `forge614-engines`: resolver un comando es barato y no invoca una IA. Esas pruebas necesitan forge614-engines 1.17.0 o posterior (candado de solo lectura y `supportsReadOnly`); `FORGE614_ENGINES_BIN` permite apuntar a otro binario.

## Comandos

```bash
bun test
bun run typecheck
bun run build
```

`bun build --compile` genera `dist/forge614-workers`.

El binario responde `forge614-workers --version` (o `-v`), que imprime `forge614-workers <versión>`, y `--help` (o `-h`), que imprime una ayuda corta; ambos salen con código 0 sin esperar la entrada estándar. El binario también responde `forge614-workers update`: descarga el `install.sh` de la última release (`https://github.com/jotredev/forge614-workers/releases/latest/download/install.sh`) y lo corre con `--force`, como hace `forge614-engram update`. Se atiende antes de leer stdin, no acepta argumentos (con alguno sale con 2), imprime una línea con la versión anterior y la nueva (o que ya está al día) y sale con 1 si la descarga o el instalador fallan. Con cualquier otro primer argumento sigue esperando el lote por stdin. La versión se lee de `package.json`, la única fuente.

## Integración continua

`.github/workflows/verify.yml` corre en cada push y en cada pull request, en Ubuntu y macOS con Bun 1.4.2: `bun test`, `bun run typecheck` y `git diff --check`. Las pruebas que usan Engines real reciben un Forge614 Engines **1.17.0 fijo**: el workflow descarga su release, verifica su `.sha256`, comprueba que `capabilities --agent claude-code` trae `"supportsReadOnly": true` y apunta `FORGE614_ENGINES_BIN` al binario. No se salta ninguna prueba; subir esa versión fija es una decisión deliberada.

## Instalación y publicación

`scripts/install.sh` instala una release verificada. Comprueba el sha256 contra `SHA256SUMS`, y **antes** de tocar la carpeta de Workers se asegura de que haya un Engines compatible (ejecutable, `--version` 1.17.0 o posterior y `supportsReadOnly: true`); si falta o no sirve, instala el último con el `install.sh` publicado de Engines y vuelve a comprobar, y si aun así no sirve no instala nada de Workers. Deja el binario en `$FORGE614_HOME/workers/<versión>/forge614-workers` (por defecto `~/.forge614/workers/<versión>/forge614-workers`) y cambia de forma atómica el enlace `workers/bin/forge614-workers` a esa versión; las versiones anteriores se conservan. Sin `--force`, reinstalar la versión activa solo dice que ya está activa. No modifica el PATH: Workers es una dependencia interna que Atlas llama por la ruta absoluta `~/.forge614/workers/bin/forge614-workers` (Atlas no lee `FORGE614_HOME`). Sus pruebas (`scripts/__tests__/install.sh.test.ts`) usan un HOME temporal y dobles de la API de releases y de Engines, nunca el HOME real.

`.github/workflows/release.yml` verifica, compila los binarios de macOS arm64 y x64 y de Linux x64 y arm64 (prueba rápida de cada uno: `--version` igual a `package.json` y un lote vacío que termina con `run_completed`), genera `SHA256SUMS` y publica solo con una etiqueta `v*`. También corre, sin publicar, en los pull requests que tocan `release.yml` o `install.sh`. Antes de publicar comprueba que la etiqueta coincida con `package.json` y que `CHANGELOG.md` tenga la entrada `## <versión>`. No hay script de publicación: subir de versión es editar `package.json`, `CHANGELOG.md` y la línea de versión de `docs/08` (es/en), y la prueba `test/versions.test.ts` exige que digan lo mismo.

## Qué debe cubrirse

- Orden estrictamente secuencial y pausa inmediata por cuota.
- `run_completed` en todo camino no fatal.
- Timeout con `SIGTERM` y posterior `SIGKILL`.
- Truncamiento con conteo real de bytes.
- cwd vacío, herencia completa de entorno y limpieza temporal.
- spawn error, JSON inválido y binario Engines no ejecutable.
- Registro completo: todo agente headless de Engines tiene adapter.
- Candado de solo lectura: una tarea `readOnly` sin candado confirmado no lanza ninguna orden.
- Validación de `readOnly` (solo `true`/`false`/ausente) y de los cinco niveles de razonamiento.
- `--version`, `--help` y `update` sin leer stdin.
- `update` con dobles (sin red ni instalador real): descarga fallida con mensaje claro y salida no cero, instalador ejecutado con `--force` y archivo descargado limpiado.

- Instalador: instalación limpia, reinstalar sin `--force`, `--force`, Engines ausente, viejo o sin candado, sha256 que no coincide y PATH intacto.
- Versiones alineadas entre `package.json`, `docs/08` (es/en) y `CHANGELOG.md`.

No se deben lanzar CLIs de IA reales en la suite normal.
