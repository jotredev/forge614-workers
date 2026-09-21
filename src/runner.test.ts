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
});
