/** Prueba los argumentos, confirmaciones y códigos de salida de `uninstall`. */
import { describe, expect, test } from "bun:test";
import { runUninstallCommand } from "./uninstall";

/** Recoge la salida normal y errores serializados del comando. */
function collectingIo(isTerminal = false, confirm: () => Promise<string> = async () => "s") {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { writeLine: (line: string) => out.push(line), writeError: (line: string) => err.push(line), isTerminal: () => isTerminal, confirm },
    out,
    err,
  };
}

describe("runUninstallCommand", () => {
  test("cancels an interactive uninstall without invoking it", async () => {
    const { io, out, err } = collectingIo(true, async () => "n");
    let invoked = false;
    const code = await runUninstallCommand([], io, async () => { invoked = true; });
    expect(code).toBe(130);
    expect(invoked).toBe(false);
    expect(out).toEqual([]);
    expect(err).toEqual([]);
  });

  test("maps an interrupted confirmation to cancellation code 130", async () => {
    const { io } = collectingIo(true, async () => { throw new DOMException("cancelled", "AbortError"); });
    let invoked = false;
    expect(await runUninstallCommand([], io, async () => { invoked = true; })).toBe(130);
    expect(invoked).toBe(false);
  });

  test("does not prompt when stdin is not a terminal", async () => {
    const { io, out, err } = collectingIo(false, async () => { throw new Error("must not prompt"); });
    const code = await runUninstallCommand([], io, async () => {});
    expect(code).toBe(0);
    expect(out).toEqual(["forge614-workers se desinstaló."]);
    expect(err).toEqual([]);
  });

  test("prints the exact self-uninstall result", async () => {
    const { io, out, err } = collectingIo();
    const code = await runUninstallCommand(["--self", "--json"], io, async () => { throw new Error("must not uninstall"); });
    expect(code).toBe(0);
    expect(out).toEqual(['{"schemaVersion":1,"result":{"integrationsRemoved":true}}']);
    expect(err).toEqual([]);
  });
});
