import type { ReasoningLevel } from "./types";

export interface HeadlessCommand {
  command: string;
  args: string[];
  stdin?: boolean;
}

/** What Workers asks Engines' `headless` command to build. */
export interface ResolveHeadlessOptions {
  enginesBin: string;
  agentId: string;
  executable: string;
  prompt: string;
  /** Extra folder the helper may access, forwarded to Engines as `--readable-dir`. It grants access; it does not make anything read-only (see `readOnly`). */
  readableDir?: string;
  /** When `true`, `--read-only` is added so Engines builds the read-only lock. */
  readOnly?: boolean;
  model?: string;
  reasoningLevel?: ReasoningLevel | null;
}

/** Outcome of {@link resolveHeadlessCommand}: the command to run, or Engines' own rejection code and message. */
export type ResolveHeadlessResult =
  | { ok: true; command: HeadlessCommand }
  | { ok: false; code: string; message: string };

/**
 * Asks Engines for the command that runs one task headlessly (`headless`).
 * Never throws for an answer Engines gave: a rejection comes back as
 * `{ ok: false, code, message }` with Engines' own code
 * (e.g. `UNKNOWN_AGENT`, `INVALID_REASONING_LEVEL`, `READ_ONLY_UNSUPPORTED`),
 * and an unreadable answer as `ENGINES_RESPONSE_INVALID`.
 */
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
  if (options.readableDir) args.push("--readable-dir", options.readableDir);
  if (options.readOnly) args.push("--read-only");

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

/** Shape of {@link resolveHeadlessCommand}, so the runner can take a double in tests. */
export type ResolveHeadlessCommand =typeof resolveHeadlessCommand;

/**
 * Asks Engines (`capabilities --agent <id>`) whether it guarantees the
 * read-only lock for this agent: resolves `true` only when the answer is JSON
 * with `supportsReadOnly === true`. Every other outcome resolves `false`
 * instead of throwing: the field missing (an Engines older than 1.17.0, which
 * would also ignore `--read-only` without an error), `false`, an Engines error
 * such as an unknown agent, output that is not JSON, or a binary that cannot
 * be launched. A lock that cannot be confirmed counts as not guaranteed.
 * It has no timeout of its own: a capabilities call that never answers blocks
 * the batch before any command runs.
 */
export async function engineSupportsReadOnly(enginesBin: string, agentId: string): Promise<boolean> {
  try {
    // stderr is ignored for the same reason as in resolveHeadlessCommand.
    const proc = Bun.spawn([enginesBin, "capabilities", "--agent", agentId], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    const candidate = JSON.parse(stdout) as unknown;
    return (
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { supportsReadOnly?: unknown }).supportsReadOnly === true
    );
  } catch {
    return false;
  }
}

/** Shape of {@link engineSupportsReadOnly}, so the runner can take a double in tests. */
export type EngineSupportsReadOnly = typeof engineSupportsReadOnly;
