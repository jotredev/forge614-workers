/** Adaptador de `codex`: reconoce sus mensajes de cuota sin distinguir mayúsculas y permite ejecutarlo en la carpeta temporal de Workers. Lo registra `registry.ts` y lo prueba `codex.test.ts`. */
import type { EngineAdapter } from "./contract";

// La interfaz de línea de comandos muestra los fallos de cuota o frecuencia con una de estas subcadenas en
// stderr o al inicio de stdout. Antes de depender de ellas en producción, se vuelven a confirmar contra la
// versión instalada como indica `docs/adding-a-new-engine-adapter.md`.
const QUOTA_PATTERNS = ["usage limit", "rate limit"];

export const codexAdapter: EngineAdapter = {
  agentId: "codex",
  detectQuotaExhausted(stderr, stdoutPrefix) {
    const haystacks = [stderr.toLowerCase(), stdoutPrefix.toLowerCase()];
    for (const pattern of QUOTA_PATTERNS) {
      if (haystacks.some((text) => text.includes(pattern))) {
        return { matched: true, pattern };
      }
    }
    return { matched: false };
  },
  extraArgs() {
    // El asistente rechaza una carpeta que no reconoce como repositorio de git confiable. Workers ejecuta cada tarea
    // en una carpeta temporal nueva, aislada y que no es repositorio, por diseño, por lo que esta bandera se necesita
    // en cada invocación; se comprobó empíricamente que sin ella sale con «Not inside a trusted directory and
    // --skip-git-repo-check was not specified.»
    return ["--skip-git-repo-check"];
  },
};
