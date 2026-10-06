/** Pruebas de las reglas de cuota y de la bandera para carpeta no confiable del adaptador `codex`. */
import { describe, test, expect } from "bun:test";
import { codexAdapter } from "./codex";

/** Agrupa la búsqueda sin distinguir mayúsculas de los dos patrones de cuota y el caso no relacionado. */
describe("codexAdapter.detectQuotaExhausted", () => {
  /** Comprueba que `usage limit` en stderr produce coincidencia e informa exactamente el patrón reconocido. */
  test("matches a usage-limit message in stderr", () => {
    const result = codexAdapter.detectQuotaExhausted("You have hit your usage limit for today", "");
    expect(result).toEqual({ matched: true, pattern: "usage limit" });
  });

  /** Comprueba que `Rate limit` también coincide en el prefijo de stdout pese a comenzar con mayúscula. */
  test("matches a rate-limit message in the stdout prefix", () => {
    const result = codexAdapter.detectQuotaExhausted("", "Rate limit reached for requests");
    expect(result.matched).toBe(true);
  });

  /** Comprueba que `invalid API key` no detiene el lote como cuota y queda clasificado como fallo genérico. */
  test("does not match on an unrelated error", () => {
    const result = codexAdapter.detectQuotaExhausted("invalid API key", "");
    expect(result).toEqual({ matched: false });
  });
});

/** Agrupa los argumentos que el adaptador agrega al comando resuelto por Engines. */
describe("codexAdapter.extraArgs", () => {
  /** Comprueba que siempre agrega `--skip-git-repo-check`, necesario en la carpeta temporal que no es repositorio. */
  test("adds --skip-git-repo-check since Workers always runs in an untrusted temp dir", () => {
    expect(codexAdapter.extraArgs()).toEqual(["--skip-git-repo-check"]);
  });
});
