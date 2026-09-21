# 07. Agregar un adapter de motor

El runbook completo está en [`adding-a-new-engine-adapter.md`](adding-a-new-engine-adapter.md). El adapter es una frontera por motor: reconoce cuota/sesión agotada en stderr o en el prefijo de 4 KiB de stdout y devuelve argumentos extra para un cwd aislado.

1. Confirma con `forge614-engines agents list` que el agente tiene `supportsHeadlessExec: true`.
2. Copia `src/adapters/_template.ts` a `src/adapters/<agentId>.ts`.
3. Con el CLI real y una sesión autenticada, fuerza un error de cuota y registra patrones exactos.
4. En el mismo paso prueba el CLI en un directorio vacío con cwd aislado; nunca supongas que la autenticación funciona por analogía.
5. Añade `extraArgs()` solo si el CLI necesita una bandera documentada, como Codex y `--skip-git-repo-check`.
6. Registra el adapter en `src/adapters/registry.ts`.
7. Añade pruebas de cuota y error genérico; ejecuta `bun test`.

Nunca inventes un método para mover credenciales. Si el aislamiento falla, documenta la evidencia y realiza una investigación separada.
