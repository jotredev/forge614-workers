/** Pruebas de las reglas de cuota y argumentos adicionales del adaptador `claude-code`. */
import { describe, test, expect } from "bun:test";
import { claudeCodeAdapter } from "./claude-code";

/** Agrupa la detección de la frase exacta de cuota en ambas salidas y el caso sin coincidencia. */
describe("claudeCodeAdapter.detectQuotaExhausted", () => {
  /** Comprueba que la frase al inicio de stderr devuelve coincidencia y conserva el patrón informado en el evento. */
  test("matches the quota pattern in stderr", () => {
    const result = claudeCodeAdapter.detectQuotaExhausted(
      "Claude AI usage limit reached|1732000000",
      ""
    );
    expect(result).toEqual({ matched: true, pattern: "Claude AI usage limit reached" });
  });

  /** Comprueba que la misma frase también se reconoce en el prefijo de stdout cuando stderr está vacío. */
  test("matches the quota pattern in the stdout prefix", () => {
    const result = claudeCodeAdapter.detectQuotaExhausted(
      "",
      "Claude AI usage limit reached|1732000000"
    );
    expect(result.matched).toBe(true);
  });

  /** Comprueba que `network timeout` no se confunde con cuota agotada y queda disponible para clasificarse como fallo genérico. */
  test("does not match on an unrelated error", () => {
    const result = claudeCodeAdapter.detectQuotaExhausted("network timeout", "");
    expect(result).toEqual({ matched: false });
  });
});

/** Agrupa la comprobación de que este adaptador no agrega argumentos propios de la carpeta temporal. */
describe("claudeCodeAdapter.extraArgs", () => {
  /** Comprueba que devuelve una lista vacía porque el comando resuelto no necesita ninguna bandera adicional. */
  test("needs no extra CLI flags", () => {
    expect(claudeCodeAdapter.extraArgs()).toEqual([]);
  });
});
