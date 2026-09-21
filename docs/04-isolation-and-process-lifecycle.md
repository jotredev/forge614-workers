# 04. Aislamiento, autenticación y ciclo de procesos

## La decisión crítica

El aislamiento correcto es como prestar una sala vacía, no como quitarle al trabajador su credencial. Cada tarea recibe un `cwd` temporal, exclusivo y vacío; el entorno completo del padre se hereda sin modificar. Workers nunca sobrescribe `HOME`, `CODEX_HOME` ni otra variable.

Redirigir `HOME`/`CODEX_HOME` a un directorio vacío rompió sesiones autenticadas reales: Claude Code quedó en “Not logged in” y Codex respondió 401. La identidad vive en Keychain o archivos bajo el home real; la memoria del proyecto que se debe ocultar vive en el `cwd` (`CLAUDE.md`, `.claude/`, `.mcp.json`).

## Ciclo

El prompt se escribe únicamente en stdin. Al vencer `timeoutMs`, se envía `SIGTERM`, se espera el margen configurable (5 s por default) y luego `SIGKILL`. stdout y stderr se capturan hasta `maxOutputBytes` cada uno. Al terminar, el directorio temporal se elimina.

Codex requiere `--skip-git-repo-check` porque el cwd vacío no es un repositorio confiable. Claude Code no requiere argumento adicional.

## Nota operacional

Con HOME real, cada tarea puede dejar sesiones bajo `~/.claude/projects/<cwd-codificado>/...` o `~/.codex/sessions/`. Workers no las limpia todavía; la acumulación ilimitada entre lotes es un riesgo operacional conocido, no un bug corregido en el código.
