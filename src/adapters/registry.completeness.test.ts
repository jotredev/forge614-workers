/** Prueba de integridad entre los asistentes ejecutables sin interfaz que Engines publica y los adaptadores que Workers registra. */
import { describe, test, expect } from "bun:test";
import { listAdapterIds } from "./registry";
import { resolveEnginesBinForTests } from "../../test/support/resolve-engines-bin";

/** Parte de la respuesta de `agents list` necesaria para decidir qué asistentes requieren adaptador. */
interface AgentsListResponse {
  /** Identificador y capacidad de ejecución sin interfaz de cada asistente conocido por Engines. */
  agents: { id: string; supportsHeadlessExec: boolean }[];
}

/** Agrupa la comprobación que evita publicar en Engines un asistente ejecutable sin sus reglas locales de cuota. */
describe("adapter registry completeness", () => {
  /** Consulta el ejecutable real y comprueba que cada asistente con `supportsHeadlessExec` aparezca en el registro de Workers. */
  test("every agent with supportsHeadlessExec has a registered adapter", async () => {
    const enginesBin = resolveEnginesBinForTests();
    const proc = Bun.spawn([enginesBin, "agents", "list"], { stdout: "pipe", stderr: "ignore" });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    // Solo los asistentes que Engines puede ejecutar sin interfaz necesitan reglas en este registro.
    const parsed = JSON.parse(stdout) as AgentsListResponse;
    const requiredIds = parsed.agents.filter((a) => a.supportsHeadlessExec).map((a) => a.id);
    const registered = listAdapterIds();

    // Se comprueba cada identificador exigido por separado para que el fallo nombre el registro ausente.
    for (const id of requiredIds) {
      expect(registered).toContain(id);
    }
  });
});
