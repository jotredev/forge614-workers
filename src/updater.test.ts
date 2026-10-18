/** Prueba el análisis de argumentos y la salida de la orden `update`. */
import { describe, expect, test } from "bun:test";
import { installedWorkersCommand, runUpdateCommand } from "./updater";

/** Recoge la salida normal y la de error que escribe el comando. */
function collectingIo(): { io: { writeLine(line: string): void; writeError(line: string): void }; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { writeLine: (line) => out.push(line), writeError: (line) => err.push(line) }, out, err };
}

describe("runUpdateCommand", () => {
  test("passes the normalized requested tag and prints JSON", async () => {
    const { io, out, err } = collectingIo();
    let selected: { versionTag?: string } | undefined;
    const code = await runUpdateCommand(["--version", "1.1.1", "--json"], "1.1.0", io, async (_current, options) => {
      selected = options;
      return { updated: true, previousVersion: "1.1.0", installedVersion: "1.1.1" };
    });
    expect(code).toBe(0);
    expect(selected).toEqual({ versionTag: "v1.1.1" });
    expect(out).toEqual(['{"schemaVersion":1,"updated":true,"previousVersion":"1.1.0","installedVersion":"1.1.1"}']);
    expect(err).toEqual([]);
  });

  test("rejects an invalid target without invoking the updater", async () => {
    const { io, out, err } = collectingIo();
    let called = false;
    const code = await runUpdateCommand(["--version", "latest"], "1.1.0", io, async () => {
      called = true;
      return { updated: false, previousVersion: "1.1.0", installedVersion: "1.1.0" };
    });
    expect(code).toBe(2);
    expect(called).toBe(false);
    expect(out).toEqual([]);
    expect(JSON.parse(err[0] ?? "{}")).toMatchObject({ schemaVersion: 1, code: "INVALID_ARGUMENTS" });
  });

  test("formats an update failure as structured JSON", async () => {
    const { io, out, err } = collectingIo();
    const code = await runUpdateCommand([], "1.1.0", io, async () => { throw new Error("network unavailable"); });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(JSON.parse(err[0] ?? "{}")).toMatchObject({ schemaVersion: 1, code: "UPDATE_FAILED" });
  });

  test("prints help without invoking the updater", async () => {
    const { io, out, err } = collectingIo();
    const code = await runUpdateCommand(["--help"], "1.1.0", io, async () => { throw new Error("unexpected call"); });
    expect(code).toBe(0);
    expect(out[0]).toContain("--version X.Y.Z");
    expect(err).toEqual([]);
  });
});

describe("installedWorkersCommand", () => {
  test("builds a native Windows launcher path", () => {
    expect(installedWorkersCommand({ FORGE614_HOME: "C:\\Users\\Runner\\.forge614" }, "win32"))
      .toBe("C:\\Users\\Runner\\.forge614\\workers\\bin\\forge614-workers.exe");
  });

  test("rejects a relative Windows home", () => {
    expect(() => installedWorkersCommand({ FORGE614_HOME: "relative\\forge614" }, "win32"))
      .toThrow("FORGE614_HOME must be an absolute path.");
  });
});
