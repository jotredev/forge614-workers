/** Orden de interfaz para desinstalar Workers o confirmar que no hay integraciones propias. */
import { createInterface } from "node:readline/promises";
import { InstallerActionError, sanitizeInstallerDetail, uninstallInstalledWorkers } from "./installer-actions";

/** Salidas de la orden `uninstall` y adaptadores de confirmación. */
export interface UninstallCommandIO {
  /** Escribe una línea de éxito. */
  writeLine(line: string): void;
  /** Escribe una línea de error estructurado. */
  writeError(line: string): void;
  /** Indica si stdin es una terminal interactiva. */
  isTerminal?(): boolean;
  /** Solicita la respuesta a la pregunta de confirmación. */
  confirm?(prompt: string): Promise<string>;
}

/** Informa si un error de readline corresponde a cancelar o a fin de entrada. */
function isCancellation(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || (error as NodeJS.ErrnoException).code === "ERR_USE_AFTER_CLOSE");
}

/** Pregunta antes de borrar Workers cuando stdin y stdout son terminales. */
async function confirmUninstall(prompt: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try { return await terminal.question(prompt); } finally { terminal.close(); }
}

/** Analiza y ejecuta `uninstall`, sin preguntar en modo JSON ni cuando stdin no es una terminal. */
export async function runUninstallCommand(
  args: string[],
  io: UninstallCommandIO = {
    writeLine: (line) => process.stdout.write(`${line}\n`),
    writeError: (line) => process.stderr.write(`${line}\n`),
    isTerminal: () => process.stdin.isTTY === true && process.stdout.isTTY === true,
    confirm: confirmUninstall,
  },
  uninstall: () => Promise<void> = () => uninstallInstalledWorkers(),
): Promise<number> {
  let json = false;
  let self = false;
  let help = false;
  for (const arg of args) {
    if (arg === "--json" && !json) json = true;
    else if (arg === "--self" && !self) self = true;
    else if (arg === "--help" && !help) help = true;
    else return invalidArguments(io, `unexpected argument '${arg}'`);
  }
  if (help) {
    io.writeLine("forge614-workers uninstall [--json] [--self]");
    return 0;
  }
  if (self) {
    if (json) io.writeLine(JSON.stringify({ schemaVersion: 1, result: { integrationsRemoved: true } }));
    else io.writeLine("forge614-workers no tiene integraciones de asistentes que retirar.");
    return 0;
  }
  const isTerminal = io.isTerminal?.() ?? false;
  if (isTerminal && !json) {
    let answer: string;
    try { answer = await (io.confirm ?? confirmUninstall)("¿Desinstalar forge614-workers y borrar FORGE614_HOME/workers? [s/N]"); }
    catch (error) {
      if (isCancellation(error)) return 130;
      const detail = error instanceof Error ? error.message : "confirmation failed";
      io.writeError(JSON.stringify({ schemaVersion: 1, code: "UNINSTALL_FAILED", error: `No se pudo confirmar la desinstalación. ${sanitizeInstallerDetail(detail)}` }));
      return 1;
    }
    if (!["s", "y"].includes(answer.trim().toLocaleLowerCase("en-US"))) return 130;
  }
  try {
    await uninstall();
    if (json) io.writeLine(JSON.stringify({ schemaVersion: 1, result: { removed: true } }));
    else io.writeLine("forge614-workers se desinstaló.");
    return 0;
  } catch (error) {
    const code = error instanceof InstallerActionError ? error.code : "UNINSTALL_FAILED";
    const detail = error instanceof Error ? error.message : "uninstall failed";
    const safe = sanitizeInstallerDetail(detail);
    io.writeError(JSON.stringify({ schemaVersion: 1, code, error: `No se pudo desinstalar Forge614 Workers. ${safe}` }));
    return 1;
  }
}

/** Escribe el sobre estándar de argumentos inválidos y devuelve el código 2. */
function invalidArguments(io: UninstallCommandIO, detail: string): number {
  io.writeError(JSON.stringify({ schemaVersion: 1, code: "INVALID_ARGUMENTS", error: detail }));
  return 2;
}
