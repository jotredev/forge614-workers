# 05. Errores, cuotas y códigos de salida

## Clasificación

| Resultado | Condición | ¿Detiene lote? |
|---|---|---|
| `quota_exhausted` | Salida no cero y adapter detecta patrón de cuota/sesión | Sí |
| `timeout` | Vence el timeout | No |
| `engine_unsupported` | Engines devuelve `HEADLESS_UNSUPPORTED` o `REASONING_LEVEL_UNSUPPORTED` | No |
| `spawn_error` | El sistema no puede lanzar el ejecutable | No |
| `generic_error` | Cualquier otro rechazo, salida no cero o excepción de tarea | No |

Un proceso con exit code 0 nunca es cuota agotada aunque su texto mencione límites. Si hay cuota, no se inician tareas posteriores y se emite `run_completed`.

## Exit codes del binario

- `0`: lote completo, incluso con fallos individuales.
- `75`: pausa por cuota agotada.
- `2`: JSON inválido o `enginesBin` inexistente/no ejecutable; ninguna tarea corrió.
- `1`: `fatal_error` inesperado que pudo ocurrir después de progreso parcial.

## Diagnóstico

Conservar `stderr` y los tamaños reales. En rechazos genéricos de Engines, el código original queda en `stderr` del evento de tarea. No convertir errores en reintentos automáticos: Atlas decide cómo reanudar.
