import { runCli } from "./cli";
import pkg from "../package.json";

/** Short help printed by `--help`: what Workers is and how it is driven. */
const HELP = `forge614-workers ${pkg.version}

Runs a batch of non-interactive agent tasks, one at a time, and prints one JSON event per line.

The batch is read from stdin as a single JSON document:
  {"enginesBin": "<path>", "tasks": [{"id": "...", "agentId": "...", "executable": "...", "prompt": "..."}]}

Usage:
  forge614-workers < batch.json
  forge614-workers --version   Print the version and exit.
  forge614-workers --help      Print this help and exit.
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

const info = infoFor(Bun.argv.slice(2));
if (info !== undefined) {
  process.stdout.write(info);
  process.exit(0);
}

const stdinText = await readStdin();
const { exitCode } = await runCli(stdinText, (line) => console.log(line));
process.exit(exitCode);
