/** Pruebas de búsqueda y enumeración del registro local de adaptadores. */
import { describe, test, expect } from "bun:test";
import { getAdapter, listAdapterIds } from "./registry";

/** Agrupa los dos asistentes registrados, el caso desconocido y la lista completa de identificadores. */
describe("adapter registry", () => {
  /** Comprueba que la clave `claude-code` devuelve el adaptador cuyo identificador coincide. */
  test("returns the claude-code adapter", () => {
    expect(getAdapter("claude-code")?.agentId).toBe("claude-code");
  });

  /** Comprueba que la clave `codex` devuelve el segundo adaptador registrado. */
  test("returns the codex adapter", () => {
    expect(getAdapter("codex")?.agentId).toBe("codex");
  });

  /** Comprueba que un asistente no registrado devuelve `undefined`, para que el ejecutor no aplique reglas ajenas. */
  test("returns undefined for an unregistered agent", () => {
    expect(getAdapter("not-a-real-agent")).toBeUndefined();
  });

  /** Comprueba que la enumeración contiene exactamente `claude-code` y `codex`, sin registros faltantes ni sobrantes. */
  test("lists all registered adapter ids", () => {
    expect(listAdapterIds().sort()).toEqual(["claude-code", "codex"]);
  });
});
