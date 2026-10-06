/**
 * Apoyo de pruebas: encuentra el ejecutable real de `forge614-engines` contra el que corren algunas pruebas.
 * Lo importan `src/engines-client.test.ts` y `src/adapters/registry.completeness.test.ts`.
 */

/**
 * Busca el ejecutable de Engines: primero la variable de entorno `FORGE614_ENGINES_BIN` (se devuelve tal cual,
 * sin comprobar que el archivo exista) y, si no está definida o está vacía, `forge614-engines` en el `PATH`.
 *
 * @returns La ruta del ejecutable de Engines.
 * @throws Error («Could not find the forge614-engines binary…») si ni la variable ni el `PATH` lo dan.
 */
export function resolveEnginesBinForTests(): string {
  // La variable de entorno manda sobre el PATH, para probar contra un Engines que no es el instalado.
  const fromEnv = process.env.FORGE614_ENGINES_BIN;
  if (fromEnv) return fromEnv;

  // `Bun.which` busca el nombre en el PATH, igual que lo haría la terminal, y devuelve `null` si no lo encuentra.
  const onPath = Bun.which("forge614-engines");
  if (onPath) return onPath;

  // Sin ejecutable no hay prueba posible: se falla con un mensaje que dice cómo resolverlo.
  throw new Error(
    "Could not find the forge614-engines binary. Install it, or set " +
      "FORGE614_ENGINES_BIN to its path, before running this test suite."
  );
}
