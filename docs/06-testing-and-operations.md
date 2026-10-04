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

No se deben lanzar CLIs de IA reales en la suite normal.
