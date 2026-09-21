import type { EngineAdapter } from "./contract";
import { claudeCodeAdapter } from "./claude-code";
import { codexAdapter } from "./codex";

const adapters: EngineAdapter[] = [claudeCodeAdapter, codexAdapter];
const byId = new Map(adapters.map((a) => [a.agentId, a]));

export function getAdapter(agentId: string): EngineAdapter | undefined {
  return byId.get(agentId);
}

export function listAdapterIds(): string[] {
  return adapters.map((a) => a.agentId);
}
