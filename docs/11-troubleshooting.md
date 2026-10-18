# 11. Resolución de errores

> **Traducción hermana:** [11 (EN). Troubleshooting](11-troubleshooting.en.md).

## Requisitos e instalación

| Síntoma | Causa y solución |
|---|---|
| El portero indica que falta Node o que la versión no alcanza | Instala Node.js 22.19.0 o posterior y vuelve a ejecutar `install.sh` o `install.ps1`. |
| No se admite el sistema o arquitectura | La release cubre macOS/Linux x64 y arm64 y Windows x64. |
| `SHA256SUMS` no es válido o no coincide | Detén la instalación y vuelve a descargar los activos de la misma release; no omitas la verificación. |
| Engines falta o no cumple | El instalador requiere Engines 1.17.0 o posterior y `supportsReadOnly: true` para Claude Code. Workers no se instala hasta cumplirlo. |

## Actualización

Los errores de `update` salen en stderr como JSON `{ "schemaVersion": 1, "code": "UPDATE_FAILED", "error": "…" }` y terminan con 1. `INVALID_ARGUMENTS` termina con 2. Comprueba la conexión, la etiqueta solicitada y que el portero de esa release esté acompañado por un `SHA256SUMS` GNU válido. El comando verifica después la versión que responde el lanzador instalado.

En Windows, el ejecutable de `workers/bin/` puede estar en uso mientras Atlas procesa un lote. Workers lo aparca antes de actualizar y lo restaura si falla la instalación. Si otra herramienta mantiene archivos bloqueados, espera a que termine el lote y vuelve a intentar `update`.

## Desinstalación

`uninstall` conserva Engines y solo informa que quitó Workers después de comprobar que `FORGE614_HOME/workers` ya no existe. La cancelación interactiva sale con 130 y no cambia archivos. `uninstall` se rechaza si el directorio actual está dentro de `workers`; cambia a otro directorio y repite la orden. La comprobación resuelve rutas reales para contemplar alias cortos de Windows.

Los fallos se emiten como JSON en stderr con código `UNINSTALL_FAILED`; argumentos inválidos usan `INVALID_ARGUMENTS`. `uninstall --self` es la respuesta requerida por `install.mjs` y no borra archivos.

En Windows, tras `uninstall`, puede quedar `FORGE614_HOME\.forge614-workers-old-*.exe` porque el proceso PowerShell diferido puede terminar junto con Workers. Cierra Workers y sus procesos activos, abre PowerShell y borra esos ejecutables aparcados con:

```powershell
Get-ChildItem -LiteralPath $env:FORGE614_HOME -Filter '.forge614-workers-old-*.exe' -File | Remove-Item -Force
```

## Lote NDJSON

Los códigos del lote siguen siendo `0`, `1`, `2` y `75`; los errores de argumentos y los nuevos comandos no cambian el formato de eventos NDJSON. Consulta [05. Errores, cuotas y códigos de salida](05-errors-and-quotas.md) para códigos como `timeout`, `spawn_error` y `generic_error`.
