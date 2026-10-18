/**
 * Punto de entrada del ejecutable `forge614-workers`: decide qué hacer según los argumentos (`--version`,
 * `--help`, `update` o correr un lote leído de stdin (entrada estándar)) y termina el proceso con el código
 * que corresponde. Es el archivo que compilan `bun run build` y el flujo de publicación (`release.yml`) con
 * `bun build --compile`, y el que ejecuta `test/e2e.test.ts`; la lógica vive en `src/cli.ts` y `src/updater.ts`.
 * Al importarlo se ejecuta todo lo que está al nivel superior, por eso no exporta nada.
 */
import { runCli } from "./cli";
import pkg from "../package.json";
import { runUpdateCommand } from "./updater";
import { runUninstallCommand } from "./uninstall";

/** Ayuda corta que imprime `--help`: qué es Workers y cómo se maneja. */
const HELP = `forge614-workers ${pkg.version}

Runs a batch of non-interactive agent tasks, one at a time, and prints one JSON event per line.

The batch is read from stdin as a single JSON document:
  {"enginesBin": "<path>", "tasks": [{"id": "...", "agentId": "...", "executable": "...", "prompt": "..."}]}

Optional fields of each task: "model", "reasoningLevel" (low, medium, high, xhigh or max;
Engines checks it per agent), "timeoutMs", "readableDir" (extra folder the helper may access)
and "readOnly" (true: the helper may only read; the task is refused if Engines does not
guarantee the lock).

Usage:
  forge614-workers < batch.json
  forge614-workers update [--version X.Y.Z] [--json]  Update Workers through the verified installer.
  forge614-workers uninstall [--json] [--self]       Remove Workers from FORGE614_HOME.
  forge614-workers --version [--json]                Print the version and exit (also -v).
  forge614-workers --help      Print this help and exit (also -h).
`;

/**
 * Responde a `--version`/`-v` y a `--help`/`-h` (solo si es el primer argumento) y devuelve el texto que se
 * imprime, o `undefined` para cualquier otro argumento. Se llama antes de tocar stdin, de modo que pedir la
 * versión nunca espera a que llegue un lote.
 *
 * @param args Argumentos del programa, sin el ejecutable ni el script; solo se mira el primero.
 * @returns El texto de la versión (`forge614-workers <versión>` con salto de línea) o la ayuda completa; `undefined` si el primer argumento es otro o no hay.
 */
function infoFor(args: string[]): { stdout?: string; stderr?: string; exitCode: number } | undefined {
  if (args[0] === "--version" || args[0] === "-v") {
    if (args.length === 1) return { stdout: `forge614-workers ${pkg.version}\n`, exitCode: 0 };
    if (args.length === 2 && args[1] === "--json") {
      return { stdout: `${JSON.stringify({ schemaVersion: 1, name: "forge614-workers", version: pkg.version })}\n`, exitCode: 0 };
    }
    return {
      stderr: `${JSON.stringify({ schemaVersion: 1, code: "INVALID_ARGUMENTS", error: "--version accepts only the optional --json flag." })}\n`,
      exitCode: 2,
    };
  }
  if (args[0] === "--help" || args[0] === "-h") return { stdout: HELP, exitCode: 0 };
  return undefined;
}

/**
 * Lee todo stdin hasta que se cierra y lo devuelve como texto.
 *
 * @returns El contenido completo de stdin; es el documento JSON del lote.
 */
async function readStdin(): Promise<string> {
  return await new Response(Bun.stdin.stream()).text();
}

// `Bun.argv` trae primero el ejecutable y el script; los argumentos del usuario empiezan en la posición 2.
const args = Bun.argv.slice(2);
// Versión y ayuda se contestan primero y terminan el proceso con código 0, sin leer stdin.
const info = infoFor(args);
if (info !== undefined) {
  if (info.stdout !== undefined) process.stdout.write(info.stdout);
  if (info.stderr !== undefined) process.stderr.write(info.stderr);
  process.exit(info.exitCode);
}

// Como --version, `update` se contesta antes de tocar stdin: nunca espera a un lote.
if (args[0] === "update") {
  // Los argumentos que siguen a `update` se pasan para que `runUpdateCommand` rechace cualquiera que llegue.
  const exitCode = await runUpdateCommand(args.slice(1), pkg.version, {
    writeLine: (line) => console.log(line),
    writeError: (line) => console.error(line),
  });
  process.exit(exitCode);
}

// `uninstall` también se contesta antes de leer stdin; el instalador común llama `uninstall --self`.
if (args[0] === "uninstall") {
  const exitCode = await runUninstallCommand(args.slice(1));
  // Deja que Bun vacíe el sobre JSON antes de terminar, en especial tras mover el .exe activo en Windows.
  process.exitCode = exitCode;
} else {
  // Cualquier otro caso es una corrida: se lee el lote de stdin y se termina con el código que devuelve `runCli`.
  const stdinText = await readStdin();
  const { exitCode } = await runCli(stdinText, (line) => console.log(line));
  process.exit(exitCode);
}
