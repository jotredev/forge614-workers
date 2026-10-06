/** Registro de adaptadores disponibles: el ejecutor consulta uno por asistente y la prueba de integridad enumera sus identificadores. */
import type { EngineAdapter } from "./contract";
import { claudeCodeAdapter } from "./claude-code";
import { codexAdapter } from "./codex";

const adapters: EngineAdapter[] = [claudeCodeAdapter, codexAdapter];
const byId = new Map(adapters.map((a) => [a.agentId, a]));

/**
 * Busca las reglas propias de un asistente registrado.
 * @param agentId Identificador de Engines que debe coincidir con el `agentId` del adaptador.
 * @returns El adaptador correspondiente o `undefined` si Workers no tiene reglas para ese asistente.
 */
export function getAdapter(agentId: string): EngineAdapter | undefined {
  return byId.get(agentId);
}

/**
 * Enumera los asistentes para los que Workers tiene adaptador.
 * @returns Una lista nueva con `claude-code` y `codex`, en el orden del registro.
 */
export function listAdapterIds(): string[] {
  return adapters.map((a) => a.agentId);
}
