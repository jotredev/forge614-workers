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
  const args = [
    "headless",
    "--agent", options.agentId,
    "--executable", options.executable,
    "--prompt", options.prompt,
    "--stdin-prompt",
  ];
  if (options.model) args.push("--model", options.model);
  if (options.reasoningLevel) args.push("--reasoning-level", options.reasoningLevel);

  const proc = Bun.spawn([options.enginesBin, ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  const parsed = JSON.parse(stdout) as
    | { headless: HeadlessCommand }
    | { error: { code: string; message: string } };

  if ("error" in parsed) {
    return { ok: false, code: parsed.error.code, message: parsed.error.message };
  }
  return { ok: true, command: parsed.headless };
}

export type ResolveHeadlessCommand = typeof resolveHeadlessCommand;
