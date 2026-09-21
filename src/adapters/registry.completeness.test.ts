import { describe, test, expect } from "bun:test";
import { listAdapterIds } from "./registry";
import { resolveEnginesBinForTests } from "../../test/support/resolve-engines-bin";

interface AgentsListResponse {
  agents: { id: string; supportsHeadlessExec: boolean }[];
}

describe("adapter registry completeness", () => {
  test("every agent with supportsHeadlessExec has a registered adapter", async () => {
    const enginesBin = resolveEnginesBinForTests();
    const proc = Bun.spawn([enginesBin, "agents", "list"], { stdout: "pipe", stderr: "ignore" });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const parsed = JSON.parse(stdout) as AgentsListResponse;
    const requiredIds = parsed.agents.filter((a) => a.supportsHeadlessExec).map((a) => a.id);
    const registered = listAdapterIds();

    for (const id of requiredIds) {
      expect(registered).toContain(id);
    }
  });
});
