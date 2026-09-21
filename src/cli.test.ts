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

  test("wraps a truly unexpected throw out of runBatch and still emits a terminal fatal_error event", async () => {
    // runBatch has its own per-task error boundary (see runner.test.ts), so
    // this exercises the outer, defensive boundary in runCli itself: a
    // throw that escapes runBatch entirely (here, simulated via a writeLine
    // that throws on the very first event runBatch emits, before
    // resolveHeadlessCommand is ever called) must still produce a terminal
    // signal instead of an unhandled exception.
    const lines: string[] = [];
    const writeLine = (line: string) => {
      const parsed = JSON.parse(line);
      if (parsed.event === "task_started") {
        throw new Error("boom: simulated writeLine failure");
      }
      lines.push(line);
    };
    // process.execPath is a real executable file, used only to pass the
    // enginesBin existence check; it is never invoked because writeLine
    // throws before resolveHeadlessCommand would be called.
    const input = JSON.stringify({
      enginesBin: process.execPath,
      tasks: [{ id: "t1", agentId: "claude-code", executable: "/bin/claude", prompt: "hi" }],
    });

    const { exitCode } = await runCli(input, writeLine);

    expect(exitCode).toBe(1);
    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.parse(lines[lines.length - 1])).toMatchObject({
      event: "fatal_error",
      reason: "unexpected_error",
    });
  });
});
