import { runCli } from "./cli";
import pkg from "../package.json";
import { runUpdateCommand } from "./updater";

/** Short help printed by `--help`: what Workers is and how it is driven. */
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
  forge614-workers update      Download the installer of the latest release and run it with --force.
  forge614-workers --version   Print the version and exit (also -v).
  forge614-workers --help      Print this help and exit (also -h).
`;

/**
 * Answers `--version`/`-v` and `--help`/`-h` (first argument only) and returns
 * the text to print, or `undefined` for any other arguments. Called before
 * stdin is touched, so asking for the version never waits for a batch.
 */
function infoFor(args: string[]): string | undefined {
  if (args[0] === "--version" || args[0] === "-v") return `forge614-workers ${pkg.version}\n`;
  if (args[0] === "--help" || args[0] === "-h") return HELP;
  return undefined;
}

async function readStdin(): Promise<string> {
  return await new Response(Bun.stdin.stream()).text();
}

const args = Bun.argv.slice(2);
const info = infoFor(args);
if (info !== undefined) {
  process.stdout.write(info);
  process.exit(0);
}

// Like --version, `update` is answered before stdin is touched: it never waits for a batch.
if (args[0] === "update") {
  const exitCode = await runUpdateCommand(args.slice(1), pkg.version, {
    writeLine: (line) => console.log(line),
    writeError: (line) => console.error(line),
  });
  process.exit(exitCode);
}

const stdinText = await readStdin();
const { exitCode } = await runCli(stdinText, (line) => console.log(line));
process.exit(exitCode);
