export function resolveEnginesBinForTests(): string {
  const fromEnv = process.env.FORGE614_ENGINES_BIN;
  if (fromEnv) return fromEnv;

  const onPath = Bun.which("forge614-engines");
  if (onPath) return onPath;

  throw new Error(
    "Could not find the forge614-engines binary. Install it, or set " +
      "FORGE614_ENGINES_BIN to its path, before running this test suite."
  );
}
