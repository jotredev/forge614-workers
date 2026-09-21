import type { ReasoningLevel } from "./types";

export interface HeadlessCommand {
  command: string;
  args: string[];
  stdin?: boolean;
}

export interface ResolveHeadlessOptions {
  enginesBin: string;
  agentId: string;
  executable: string;
  prompt: string;
  model?: string;
  reasoningLevel?: ReasoningLevel | null;
}

export type ResolveHeadlessResult =
  | { ok: true; command: HeadlessCommand }
  | { ok: false; code: string; message: string };

export async function resolveHeadlessCommand(
  options: ResolveHeadlessOptions
): Promise<ResolveHeadlessResult> {
  // The prompt is deliberately NOT passed as a `--prompt` CLI arg: Workers
  // always requests `--stdin-prompt`, and forge614-engines fully ignores
  // `--prompt`'s value when `--stdin-prompt` is also passed (verified live:
  // output is byte-identical with or without it). Passing it anyway would
  // (a) risk E2BIG from Bun.spawn for prompts near/over the OS ARG_MAX
  // (as low as ~128KiB on Linux), crashing the whole batch, and (b) leave
  // the prompt visible in forge614-engines's own argv (e.g. `ps` output)
  // for the duration of this invocation, defeating the point of
  // `--stdin-prompt` in the first place.
  const args = [
    "headless",
    "--agent", options.agentId,
    "--executable", options.executable,
    "--stdin-prompt",
  ];
  if (options.model) args.push("--model", options.model);
  if (options.reasoningLevel) args.push("--reasoning-level", options.reasoningLevel);

  // stderr is ignored (not piped) so a chatty child process can never fill the
  // OS pipe buffer and deadlock while we're only awaiting stdout/exited.
  const proc = Bun.spawn([options.enginesBin, ...args], { stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  let parsed: { headless: HeadlessCommand } | { error: { code: string; message: string } };
  try {
    const candidate = JSON.parse(stdout) as unknown;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      (!("headless" in candidate) && !("error" in candidate))
    ) {
      throw new Error('response JSON did not contain a "headless" or "error" field');
    }
    parsed = candidate as { headless: HeadlessCommand } | { error: { code: string; message: string } };
  } catch (err) {
    const snippet = stdout.slice(0, 200);
    return {
      ok: false,
      code: "ENGINES_RESPONSE_INVALID",
      message:
        `Failed to parse forge614-engines headless output as JSON: ${(err as Error).message}. ` +
        `Raw stdout (truncated): ${JSON.stringify(snippet)}`,
    };
  }

  if ("error" in parsed) {
    return { ok: false, code: parsed.error.code, message: parsed.error.message };
  }
  return { ok: true, command: parsed.headless };
}

export type ResolveHeadlessCommand = typeof resolveHeadlessCommand;
