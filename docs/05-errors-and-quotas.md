# 05. Errores, cuotas y códigos de salida

## Clasificación

| Resultado | Condición | ¿Detiene lote? |
|---|---|---|
| `quota_exhausted` | Salida no cero y adapter detecta patrón de cuota/sesión | Sí |
| `timeout` | Vence el timeout | No |
| `engine_unsupported` | Engines devuelve `HEADLESS_UNSUPPORTED`, `REASONING_LEVEL_UNSUPPORTED` o `READ_ONLY_UNSUPPORTED`, o una tarea con `readOnly` no puede confirmar el candado (`stderr`: `READ_ONLY_UNSUPPORTED: <mensaje>`, sin correr ninguna orden) | No |
| `spawn_error` | El sistema no puede lanzar el ejecutable | No |
| `generic_error` | Cualquier otro rechazo (incluidos `INVALID_REASONING_LEVEL` y `UNKNOWN_AGENT`; en una tarea con `readOnly`, un agente desconocido falla antes, en la comprobación del candado, como `READ_ONLY_UNSUPPORTED`), salida no cero o excepción de tarea | No |

Un proceso con exit code 0 nunca es cuota agotada aunque su texto mencione límites. Si hay cuota, no se inician tareas posteriores y se emite `run_completed`.

## Exit codes del binario

- `0`: lote completo, incluso con fallos individuales.
- `75`: pausa por cuota agotada.
- `2`: entrada inválida (JSON roto, `readOnly` que no sea `true`/`false`, `reasoningLevel` fuera de `low`/`medium`/`high`/`xhigh`/`max`, etc.) o `enginesBin` inexistente/no ejecutable; ninguna tarea corrió.
- `1`: `fatal_error` inesperado que pudo ocurrir después de progreso parcial.
- La orden `update` reutiliza estos códigos con su propio sentido: `0` actualizado o ya al día, `2` si recibe argumentos y `1` si fallan la descarga, el instalador o la lectura de la versión instalada (ver `06`).

## Diagnóstico

Conservar `stderr` y los tamaños reales. En rechazos genéricos de Engines, el código original queda en `stderr` del evento de tarea. `INVALID_REASONING_LEVEL` y `UNKNOWN_AGENT` son errores de entrada (la tarea nombró algo que no existe), no una falta de capacidad del motor, por eso no son `engine_unsupported` (con `readOnly`, un agente desconocido se detecta antes y sale como `READ_ONLY_UNSUPPORTED`). No convertir errores en reintentos automáticos: Atlas decide cómo reanudar.
