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

  test("marks a task as generic_error when the process exits non-zero without a quota match", async () => {
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/bin/claude", args: [], stdin: true },
      }),
      runProcess: async (): Promise<RunProcessResult> => ({
        ok: true,
        exitCode: 1,
        durationMs: 5,
        stdout: { text: "", bytes: 0, truncated: false },
        stderr: { text: "boom", bytes: 4, truncated: false },
      }),
    };

    await runBatch(
      { enginesBin: "/bin/engines", maxOutputBytes: 1024, tasks: [makeTask()] },
      (e) => events.push(e),
      deps
    );

    const failedEvent = events.find((e) => e.event === "task_failed");
    expect(failedEvent).toMatchObject({ reason: "generic_error", exitCode: 1 });
  });

  test("marks a task as engine_unsupported when Engines rejects it with HEADLESS_UNSUPPORTED/REASONING_LEVEL_UNSUPPORTED and never calls runProcess", async () => {
    const events: TaskEvent[] = [];
    let runProcessCalled = false;
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: false,
        code: "REASONING_LEVEL_UNSUPPORTED",
        message: "claude-code does not support reasoning levels",
      }),
      runProcess: async (): Promise<RunProcessResult> => {
        runProcessCalled = true;
        throw new Error("should not be called");
      },
    };

    await runBatch(
      { enginesBin: "/bin/engines", maxOutputBytes: 1024, tasks: [makeTask()] },
      (e) => events.push(e),
      deps
    );

    expect(runProcessCalled).toBe(false);
    const failedEvent = events.find((e) => e.event === "task_failed");
    expect(failedEvent).toMatchObject({ reason: "engine_unsupported" });
    if (failedEvent?.event === "task_failed") {
      expect(failedEvent.stderr).toContain("REASONING_LEVEL_UNSUPPORTED");
    }
  });

  test("marks a task as generic_error (not engine_unsupported) when Engines rejects it with a non-unsupported code, preserving the code in stderr", async () => {
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: false,
        code: "ENGINES_RESPONSE_INVALID",
        message: "Failed to parse forge614-engines headless output as JSON",
      }),
      runProcess: async (): Promise<RunProcessResult> => {
        throw new Error("should not be called");
      },
    };

    await runBatch(
      { enginesBin: "/bin/engines", maxOutputBytes: 1024, tasks: [makeTask()] },
      (e) => events.push(e),
      deps
    );

    const failedEvent = events.find((e) => e.event === "task_failed");
    expect(failedEvent).toMatchObject({ reason: "generic_error" });
    if (failedEvent?.event === "task_failed") {
      expect(failedEvent.stderr).toContain("ENGINES_RESPONSE_INVALID");
    }
  });

  test("marks a task as spawn_error and continues with the next task", async () => {
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/does/not/exist", args: [], stdin: true },
      }),
      runProcess: async (): Promise<RunProcessResult> => ({
        ok: false,
        reason: "spawn_error",
        message: "ENOENT",
      }),
    };

    const result = await runBatch(
      {
        enginesBin: "/bin/engines",
        maxOutputBytes: 1024,
        tasks: [makeTask({ id: "t1" }), makeTask({ id: "t2" })],
      },
      (e) => events.push(e),
      deps
    );

    expect(result.pausedByQuota).toBe(false);
    expect(events.filter((e) => e.event === "task_failed")).toHaveLength(2);
    const runCompleted = events.find((e) => e.event === "run_completed");
    expect(runCompleted).toMatchObject({ totalTasks: 2, failed: 2, completed: 0, notStarted: 0 });
  });

  test("does not treat a zero-exit task as quota_exhausted even if its output contains a quota pattern", async () => {
    // Reproduces the reviewer's end-to-end scenario: a fake agent exits 0
    // (success) while printing text that happens to contain a real quota
    // pattern (e.g. discussing rate limiting as part of a code review).
    // Quota detection must only run for a non-zero exit code.
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/bin/claude", args: [], stdin: true },
      }),
      runProcess: async (): Promise<RunProcessResult> => ({
        ok: true,
        exitCode: 0,
        durationMs: 5,
        stdout: {
          text: "Reviewing the code... note the API's rate limiting middleware. Claude AI usage limit reached in a comment example.",
          bytes: 200,
          truncated: false,
        },
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
  });

  test("marks a task as failed and continues the batch when runProcess throws synchronously", async () => {
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/bin/claude", args: [], stdin: true },
      }),
      runProcess: async (): Promise<RunProcessResult> => {
        throw new Error("boom: unexpected runProcess failure");
      },
    };

    const result = await runBatch(
      {
        enginesBin: "/bin/engines",
        maxOutputBytes: 1024,
        tasks: [makeTask({ id: "t1" }), makeTask({ id: "t2" })],
      },
      (e) => events.push(e),
      deps
    );

    expect(result.pausedByQuota).toBe(false);
    const failedEvents = events.filter((e) => e.event === "task_failed");
    expect(failedEvents).toHaveLength(2);
    for (const failedEvent of failedEvents) {
      expect(failedEvent).toMatchObject({ reason: "generic_error" });
      if (failedEvent.event === "task_failed") {
        expect(failedEvent.stderr).toContain("boom: unexpected runProcess failure");
      }
    }
    const runCompleted = events.find((e) => e.event === "run_completed");
    expect(runCompleted).toMatchObject({ totalTasks: 2, failed: 2, completed: 0, notStarted: 0 });
  });

  test("marks a task as failed and continues the batch when resolveHeadlessCommand throws synchronously", async () => {
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => {
        throw new Error("boom: unexpected resolveHeadlessCommand failure");
      },
      runProcess: async (): Promise<RunProcessResult> => {
        throw new Error("should not be called");
      },
    };

    const result = await runBatch(
      {
        enginesBin: "/bin/engines",
        maxOutputBytes: 1024,
        tasks: [makeTask({ id: "t1" }), makeTask({ id: "t2" })],
      },
      (e) => events.push(e),
      deps
    );

    expect(result.pausedByQuota).toBe(false);
    const failedEvents = events.filter((e) => e.event === "task_failed");
    expect(failedEvents).toHaveLength(2);
    for (const failedEvent of failedEvents) {
      expect(failedEvent).toMatchObject({ reason: "generic_error" });
      if (failedEvent.event === "task_failed") {
        expect(failedEvent.stderr).toContain("boom: unexpected resolveHeadlessCommand failure");
      }
    }
    const runCompleted = events.find((e) => e.event === "run_completed");
    expect(runCompleted).toMatchObject({ totalTasks: 2, failed: 2, completed: 0, notStarted: 0 });
  });

  test("stops the batch immediately on quota_exhausted and leaves later tasks not started", async () => {
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/bin/claude", args: [], stdin: true },
      }),
      runProcess: async (): Promise<RunProcessResult> => ({
        ok: true,
        exitCode: 1,
        durationMs: 5,
        stdout: { text: "", bytes: 0, truncated: false },
        stderr: { text: "Claude AI usage limit reached", bytes: 30, truncated: false },
      }),
    };

    const result = await runBatch(
      {
        enginesBin: "/bin/engines",
        maxOutputBytes: 1024,
        tasks: [makeTask({ id: "t1" }), makeTask({ id: "t2" })],
      },
      (e) => events.push(e),
      deps
    );

    expect(result.pausedByQuota).toBe(true);
    expect(events.map((e) => e.event)).toEqual(["task_started", "quota_exhausted", "run_completed"]);
    const runCompleted = events[2];
    if (runCompleted.event === "run_completed") {
      expect(runCompleted).toMatchObject({ notStarted: 1, pausedByQuota: true, completed: 0, failed: 0 });
    }
  });
});
