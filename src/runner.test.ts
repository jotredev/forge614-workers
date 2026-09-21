import { describe, test, expect } from "bun:test";
import { runBatch } from "./runner";
import type { TaskSpec, TaskEvent } from "./types";
import type { ResolveHeadlessResult } from "./engines-client";
import type { RunProcessResult } from "./process-runner";

function makeTask(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: "t1",
    agentId: "claude-code",
    executable: "/bin/claude",
    prompt: "hi",
    model: undefined,
    reasoningLevel: null,
    timeoutMs: 60000,
    ...overrides,
  };
}

describe("runBatch", () => {
  test("emits task_started, task_completed, and run_completed for a successful task", async () => {
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/bin/claude", args: ["-p"], stdin: true },
      }),
      runProcess: async (): Promise<RunProcessResult> => ({
        ok: true,
        exitCode: 0,
        durationMs: 10,
        stdout: { text: "ok", bytes: 2, truncated: false },
        stderr: { text: "", bytes: 0, truncated: false },
      }),
    };

    const result = await runBatch(
      { enginesBin: "/bin/engines", maxOutputBytes: 1024, tasks: [makeTask()] },
      (e) => events.push(e),
      deps
    );

    expect(result.pausedByQuota).toBe(false);
    expect(events.map((e) => e.event)).toEqual(["task_started", "task_completed", "run_completed"]);
    const finalEvent = events[2];
    if (finalEvent.event === "run_completed") {
      expect(finalEvent).toMatchObject({ totalTasks: 1, completed: 1, failed: 0, notStarted: 0 });
    }
  });

  test("byte-slices the quota-detection stdout prefix instead of char-slicing", async () => {
    // "🎉" (U+1F389) is 4 bytes in UTF-8 but only 2 UTF-16 code units (a
    // surrogate pair) in a JS string. 1500 of them is 6000 true UTF-8 bytes
    // but only 3000 UTF-16 code units — past QUOTA_STDOUT_PREFIX_BYTES (4096)
    // in bytes, but well within it in code units. Placing the quota pattern
    // right after this filler means:
    //   - a correct byte-accurate 4096-byte prefix stops at exactly 1024
    //     emoji (1024 * 4 = 4096 bytes) and never reaches the pattern.
    //   - a buggy `.slice(0, 4096)` (code-unit) prefix would include the
    //     whole 3012-unit string, wrongly matching the pattern.
    const filler = "\u{1F389}".repeat(1500);
    const stdout = filler + "usage limit";
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/bin/codex", args: ["-p"], stdin: true },
      }),
      runProcess: async (): Promise<RunProcessResult> => ({
        ok: true,
        exitCode: 0,
        durationMs: 10,
        stdout: { text: stdout, bytes: Buffer.byteLength(stdout, "utf8"), truncated: false },
        stderr: { text: "", bytes: 0, truncated: false },
      }),
    };

    const result = await runBatch(
      {
        enginesBin: "/bin/engines",
        maxOutputBytes: 1024 * 1024,
        tasks: [makeTask({ agentId: "codex", executable: "/bin/codex" })],
      },
      (e) => events.push(e),
      deps
    );

    expect(result.pausedByQuota).toBe(false);
    expect(events.map((e) => e.event)).toEqual(["task_started", "task_completed", "run_completed"]);
  });
});
