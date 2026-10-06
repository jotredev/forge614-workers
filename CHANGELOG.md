# Changelog

## 1.0.1

Sin cambios de comportamiento: el código, las pruebas, el instalador y los flujos de publicación quedan documentados por completo en español, y los manuales cubren los archivos de datos, el instalador, la resolución de errores y el glosario.

- **Código y pruebas documentados:** todo `src/`, `scripts/` y `test/` lleva comentarios en español (antes estaban en inglés): cada función con lo que hace, devuelve y lanza, cada prueba con lo que comprueba y por qué importa, y cada programa falso de `test/fixtures/` con la prueba que lo usa.
- **Manuales:** capítulos nuevos 09 (archivos de datos), 10 (instalador), 11 (resolución de errores) y 12 (glosario), en español y en inglés, y correcciones en el capítulo 03.
- **Contrato:** `CONTRACT.md` y `CONTRACT.en.md` con las órdenes públicas, los códigos de salida y de error y la compatibilidad.
- **Repositorio:** `verify.yml` y `release.yml` explican con comentarios cada trabajo y cada paso.

## 1.0.0

Primera versión publicada de Forge614 Workers: ya se instala con un solo comando, se actualiza con otro y se verifica en cada cambio.

- **Ejecución de tareas:** recibe un lote JSON por stdin, resuelve cada tarea con Forge614 Engines y las ejecuta una por una, con salida NDJSON, pausa inmediata por cuota agotada y tiempo máximo por tarea (primero `SIGTERM` y luego `SIGKILL`).
- **Candado de solo lectura:** una tarea con `readOnly` no se lanza si Engines no garantiza el candado; el campo opcional `readableDir` se reenvía a Engines.
- **Niveles de razonamiento:** acepta los cinco niveles de Engines (`low`, `medium`, `high`, `xhigh` y `max`) y es Engines quien comprueba cuáles admite cada asistente.
- **`--version`, `--help` y `update`:** responden sin leer stdin; `update` descarga el instalador de la última versión publicada y lo ejecuta con `--force`.
- **Instalación:** `install.sh` verifica el sha256 del binario, deja instalado Forge614 Engines 1.17.0 o posterior (lo instala si falta, es anterior o no garantiza el candado de solo lectura) antes de tocar nada de Workers, guarda cada versión en `~/.forge614/workers/<versión>/` con el enlace activo en `~/.forge614/workers/bin/forge614-workers` y no modifica el PATH.
- **Publicación:** binarios para macOS arm64 y x64 y Linux x64 y arm64 con `SHA256SUMS` e `install.sh`; cada push y cada PR se verifican con Forge614 Engines 1.17.0 fijo, y la publicación comprueba que la etiqueta, `package.json` y este archivo digan la misma versión.
- **Repositorio:** `README.md`, `README.en.md`, `SECURITY.md`, `LICENSE` y `CHANGELOG.md`.
