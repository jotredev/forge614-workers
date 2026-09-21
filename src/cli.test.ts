import { describe, test, expect } from "bun:test";
import { runCli } from "./cli";

describe("runCli", () => {
  test("returns exit code 2 and a fatal_error event on malformed JSON", async () => {
    const lines: string[] = [];
    const { exitCode } = await runCli("{not json", (l) => lines.push(l));

    expect(exitCode).toBe(2);
    expect(JSON.parse(lines[0])).toMatchObject({ event: "fatal_error", reason: "invalid_input" });
  });

  test("returns exit code 2 and a fatal_error event when enginesBin does not exist", async () => {
    const lines: string[] = [];
    const input = JSON.stringify({ enginesBin: "/definitely/does/not/exist", tasks: [] });
    const { exitCode } = await runCli(input, (l) => lines.push(l));

    expect(exitCode).toBe(2);
    expect(JSON.parse(lines[0])).toMatchObject({
      event: "fatal_error",
      reason: "engines_bin_not_found",
    });
  });

  test("returns exit code 0 for an empty task list against a real executable enginesBin", async () => {
    const lines: string[] = [];
    // process.execPath is always a real, executable file — used here only to
    // pass the enginesBin existence/executable check; it is never invoked
    // because there are no tasks to run.
    const input = JSON.stringify({ enginesBin: process.execPath, tasks: [] });
    const { exitCode } = await runCli(input, (l) => lines.push(l));

    expect(exitCode).toBe(0);
    const finalEvent = JSON.parse(lines[lines.length - 1]);
    expect(finalEvent).toMatchObject({ event: "run_completed", totalTasks: 0, pausedByQuota: false });
  });
});
