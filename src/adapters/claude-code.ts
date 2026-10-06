/** Adaptador del asistente `claude-code`: reconoce su frase de cuota agotada y no agrega argumentos al comando de Engines. Lo registra `registry.ts` y lo prueba `claude-code.test.ts`. */
import type { EngineAdapter } from "./contract";

// El asistente imprime esta frase exacta cuando la cuenta agota su límite en modo no interactivo (`-p`). Antes
// de depender de ella en producción, se vuelve a confirmar contra la versión instalada como indica
// `docs/adding-a-new-engine-adapter.md`.
const QUOTA_PATTERN = "Claude AI usage limit reached";

export const claudeCodeAdapter: EngineAdapter = {
  agentId: "claude-code",
  detectQuotaExhausted(stderr, stdoutPrefix) {
    if (stderr.includes(QUOTA_PATTERN) || stdoutPrefix.includes(QUOTA_PATTERN)) {
      return { matched: true, pattern: QUOTA_PATTERN };
    }
    return { matched: false };
  },
  extraArgs() {
    return [];
  },
};
