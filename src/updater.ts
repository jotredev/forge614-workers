/** Analiza los argumentos y coordina la actualización de Workers. */
import { InstallerActionError, updateInstalledWorkers, type UpdateWorkersResult } from "./installer-actions";
import { homedir } from "node:os";
import { join, win32 } from "node:path";

/** Dirección histórica conservada para consumidores que la importan en pruebas. */
export const LATEST_INSTALLER_URL = "https://github.com/jotredev/forge614-workers/releases/latest/download/install.sh";

/** Opciones de salida de la orden `update`. */
export interface UpdateCommandIO {
  /** Escribe una línea de resultado normal. */
  writeLine(line: string): void;
  /** Escribe una línea de error estructurado. */
  writeError(line: string): void;
}

/** Devuelve la ruta del lanzador según `FORGE614_HOME` y el sistema operativo. */
export function installedWorkersCommand(env: Record<string, string | undefined> = process.env, platform = process.platform): string {
  const pathApi = platform === "win32" ? win32 : undefined;
  const home = env.FORGE614_HOME || (pathApi ?? { join }).join(env.HOME || env.USERPROFILE || homedir(), ".forge614");
  const absolute = pathApi ? pathApi.isAbsolute(home) : /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(home);
  if (!absolute) throw new Error("FORGE614_HOME must be an absolute path.");
  return (pathApi ?? { join }).join(home, "workers", "bin", `forge614-workers${platform === "win32" ? ".exe" : ""}`);
}

/** Analiza `update`, ejecuta la actualización y presenta texto o JSON según `--json`. */
export async function runUpdateCommand(
  args: string[],
  currentVersion: string,
  io: UpdateCommandIO,
  update: (currentVersion: string, options?: { versionTag?: string }) => Promise<UpdateWorkersResult> = updateInstalledWorkers,
): Promise<number> {
  let json = false;
  let versionTag: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json" && !json) {
      json = true;
      continue;
    }
    if (arg === "--version" && versionTag === undefined && index + 1 < args.length) {
      const version = args[index + 1]!;
      if (!/^v?\d+\.\d+\.\d+$/.test(version)) return invalidArguments(io, `invalid version '${version}'`);
      versionTag = `v${version.replace(/^v/, "")}`;
      index += 1;
      continue;
    }
    if (arg === "--help" && args.length === 1) {
      io.writeLine("forge614-workers update [--version X.Y.Z] [--json]");
      return 0;
    }
    return invalidArguments(io, `unexpected argument '${arg ?? ""}'`);
  }
  try {
    const result = await update(currentVersion, versionTag === undefined ? {} : { versionTag });
    if (json) io.writeLine(JSON.stringify({ schemaVersion: 1, ...result }));
    else io.writeLine(result.updated
      ? `forge614-workers se actualizó de ${result.previousVersion} a ${result.installedVersion}.`
      : `forge614-workers ya está al día (${result.installedVersion}).`);
    return 0;
  } catch (error) {
    const code = error instanceof InstallerActionError ? error.code : "UPDATE_FAILED";
    const detail = error instanceof Error ? error.message : "update failed";
    io.writeError(JSON.stringify({ schemaVersion: 1, code, error: `No se pudo actualizar Forge614 Workers. ${detail}` }));
    return 1;
  }
}

/** Escribe el sobre estándar de argumentos inválidos y devuelve el código 2. */
function invalidArguments(io: UpdateCommandIO, detail: string): number {
  io.writeError(JSON.stringify({ schemaVersion: 1, code: "INVALID_ARGUMENTS", error: detail }));
  return 2;
}
