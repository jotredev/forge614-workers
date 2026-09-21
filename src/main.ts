import { runCli } from "./cli";

async function readStdin(): Promise<string> {
  return await new Response(Bun.stdin.stream()).text();
}

const stdinText = await readStdin();
const { exitCode } = await runCli(stdinText, (line) => console.log(line));
process.exit(exitCode);
