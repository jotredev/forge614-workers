# 06. Testing y operación

## Estrategia

La mayoría de pruebas inyectan dependencias y simulan solo los procesos costosos de Claude/Codex. Esto mantiene las pruebas rápidas y deterministas. `engines-client.test.ts` y el test de completitud del registro usan el binario real instalado de `forge614-engines`: resolver un comando es barato y no invoca una IA.

## Comandos

```bash
bun test
bun run typecheck
bun run build
```

`bun build --compile` genera `dist/forge614-workers`.

El binario responde `forge614-workers --version` (o `-v`), que imprime `forge614-workers <versión>`, y `--help` (o `-h`), que imprime una ayuda corta; ambos salen con código 0 sin esperar la entrada estándar. Con cualquier otro argumento sigue esperando el lote por stdin. La versión se lee de `package.json`, la única fuente.

## Qué debe cubrirse

- Orden estrictamente secuencial y pausa inmediata por cuota.
- `run_completed` en todo camino no fatal.
- Timeout con `SIGTERM` y posterior `SIGKILL`.
- Truncamiento con conteo real de bytes.
- cwd vacío, herencia completa de entorno y limpieza temporal.
- spawn error, JSON inválido y binario Engines no ejecutable.
- Registro completo: todo agente headless de Engines tiene adapter.
- Candado de solo lectura: una tarea `readOnly` sin candado confirmado no lanza ninguna orden.
- `--version` y `--help` sin leer stdin.

No se deben lanzar CLIs de IA reales en la suite normal.
