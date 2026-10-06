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
    // El asistente rechaza una carpeta que no reconoce como repositorio confiable. Workers ejecuta cada tarea
    // en una carpeta temporal nueva que no es repositorio, por lo que esta bandera se necesita siempre; se
    // comprobó que sin ella el proceso sale pidiendo `--skip-git-repo-check`.
    return ["--skip-git-repo-check"];
  },
};
