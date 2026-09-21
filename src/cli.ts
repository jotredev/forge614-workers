import { accessSync, constants } from "node:fs";
import { parseRunInput, type TaskEvent } from "./types";
import { runBatch } from "./runner";

export interface CliResult {
  exitCode: number;
}

export async function runCli(
  stdinText: string,
  writeLine: (line: string) => void
): Promise<CliResult> {
  let input;
  try {
    input = parseRunInput(stdinText);
  } catch (err) {
    writeLine(
      JSON.stringify({
        event: "fatal_error",
        reason: "invalid_input",
        message: (err as Error).message,
      })
    );
    return { exitCode: 2 };
  }

  try {
    accessSync(input.enginesBin, constants.X_OK);
  } catch {
    writeLine(
      JSON.stringify({
        event: "fatal_error",
        reason: "engines_bin_not_found",
        message: `enginesBin is not an executable file: ${input.enginesBin}`,
      })
    );
    return { exitCode: 2 };
  }

  const onEvent = (event: TaskEvent) => writeLine(JSON.stringify(event));

  // runBatch now has its own per-task error boundary, so this should only
  // ever fire if something is fundamentally broken (e.g. a throw from
  // runBatch's own bookkeeping, outside the per-task try/catch). Even then,
  // the caller must get SOME terminal signal rather than an unhandled
  // exception.
  try {
    const result = await runBatch(
      { enginesBin: input.enginesBin, maxOutputBytes: input.maxOutputBytes, tasks: input.tasks },
      onEvent
    );

    return { exitCode: result.pausedByQuota ? 75 : 0 };
  } catch (err) {
    writeLine(
      JSON.stringify({
        event: "fatal_error",
        reason: "unexpected_error",
        message: (err as Error).message ?? String(err),
      })
    );
    return { exitCode: 1 };
  }
}
