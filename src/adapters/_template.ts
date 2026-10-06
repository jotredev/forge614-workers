/** Plantilla copiable para crear un adaptador nuevo con detección de cuota y argumentos propios de la carpeta temporal. */
import type { EngineAdapter } from "./contract";

// Se copia como `<agentId>.ts`, se sustituyen el identificador y los patrones de cuota por los confirmados en
// la interfaz de línea de comandos del asistente según `docs/adding-a-new-engine-adapter.md`, y después se
// registra el adaptador en `registry.ts`.
const QUOTA_PATTERN = "REPLACE_WITH_REAL_PATTERN";

export const templateAdapter: EngineAdapter = {
  agentId: "REPLACE_WITH_AGENT_ID",
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
