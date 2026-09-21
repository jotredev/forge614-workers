import type { TaskSpec, TaskEvent } from "./types";
import { getAdapter } from "./adapters/registry";
import { QUOTA_STDOUT_PREFIX_BYTES } from "./adapters/contract";
import { resolveHeadlessCommand, type ResolveHeadlessCommand } from "./engines-client";
import { runProcess, type RunProcess } from "./process-runner";

export interface RunBatchOptions {
  enginesBin: string;
  maxOutputBytes: number;
  tasks: TaskSpec[];
}

export interface RunBatchDeps {
  resolveHeadlessCommand: ResolveHeadlessCommand;
  runProcess: RunProcess;
}

export interface RunBatchResult {
  pausedByQuota: boolean;
}

const defaultDeps: RunBatchDeps = { resolveHeadlessCommand, runProcess };

export async function runBatch(
  options: RunBatchOptions,
  onEvent: (event: TaskEvent) => void,
  deps: RunBatchDeps = defaultDeps
): Promise<RunBatchResult> {
  const batchStart = Date.now();
  let completed = 0;
  let failed = 0;
  let pausedByQuota = false;
  let tasksRun = 0;

  for (const task of options.tasks) {
    tasksRun++;
    onEvent({
      event: "task_started",
      taskId: task.id,
      agentId: task.agentId,
      startedAt: new Date().toISOString(),
    });

    const resolved = await deps.resolveHeadlessCommand({
      enginesBin: options.enginesBin,
      agentId: task.agentId,
      executable: task.executable,
      prompt: task.prompt,
      model: task.model,
      reasoningLevel: task.reasoningLevel,
    });

    if (!resolved.ok) {
      failed++;
      onEvent({
        event: "task_failed",
        taskId: task.id,
        reason: "engine_unsupported",
        exitCode: null,
        stdout: "",
        stdoutBytes: 0,
        stdoutTruncated: false,
        stderr: resolved.message,
        stderrBytes: resolved.message.length,
        stderrTruncated: false,
      });
      continue;
    }

    const adapter = getAdapter(task.agentId);
    const result = await deps.runProcess({
      command: resolved.command.command,
      args: resolved.command.args,
      stdin: task.prompt,
      timeoutMs: task.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
      buildExtraEnv: adapter ? (tempDir) => adapter.isolationEnv(tempDir) : undefined,
    });

    if (!result.ok && result.reason === "spawn_error") {
      failed++;
      onEvent({
        event: "task_failed",
        taskId: task.id,
        reason: "spawn_error",
        exitCode: null,
        stdout: "",
        stdoutBytes: 0,
        stdoutTruncated: false,
        stderr: result.message,
        stderrBytes: result.message.length,
        stderrTruncated: false,
      });
      continue;
    }

    if (!result.ok && result.reason === "timeout") {
      failed++;
      onEvent({
        event: "task_failed",
        taskId: task.id,
        reason: "timeout",
        exitCode: null,
        stdout: result.stdout.text,
        stdoutBytes: result.stdout.bytes,
        stdoutTruncated: result.stdout.truncated,
        stderr: result.stderr.text,
        stderrBytes: result.stderr.bytes,
        stderrTruncated: result.stderr.truncated,
      });
      continue;
    }

    if (!result.ok) continue; // exhaustiveness guard; all failure branches handled above

    // Slice by true UTF-8 bytes, not UTF-16 code units: `String.slice` counts
    // code units, which diverges from the spec's "exactly N bytes" contract
    // once stdout contains multi-byte characters before the cutoff point.
    const stdoutPrefix = Buffer.from(result.stdout.text, "utf8")
      .subarray(0, QUOTA_STDOUT_PREFIX_BYTES)
      .toString("utf8");
    const quota = adapter?.detectQuotaExhausted(result.stderr.text, stdoutPrefix) ?? { matched: false };

    if (quota.matched) {
      pausedByQuota = true;
      onEvent({
        event: "quota_exhausted",
        taskId: task.id,
        agentId: task.agentId,
        matchedPattern: quota.pattern ?? "",
        stdout: result.stdout.text,
        stdoutBytes: result.stdout.bytes,
        stdoutTruncated: result.stdout.truncated,
        stderr: result.stderr.text,
        stderrBytes: result.stderr.bytes,
        stderrTruncated: result.stderr.truncated,
      });
      break;
    }

    if (result.exitCode !== 0) {
      failed++;
      onEvent({
        event: "task_failed",
        taskId: task.id,
        reason: "generic_error",
        exitCode: result.exitCode,
        stdout: result.stdout.text,
        stdoutBytes: result.stdout.bytes,
        stdoutTruncated: result.stdout.truncated,
        stderr: result.stderr.text,
        stderrBytes: result.stderr.bytes,
        stderrTruncated: result.stderr.truncated,
      });
      continue;
    }

    completed++;
    onEvent({
      event: "task_completed",
      taskId: task.id,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: result.stdout.text,
      stdoutBytes: result.stdout.bytes,
      stdoutTruncated: result.stdout.truncated,
      stderr: result.stderr.text,
      stderrBytes: result.stderr.bytes,
      stderrTruncated: result.stderr.truncated,
    });
  }

  onEvent({
    event: "run_completed",
    totalTasks: options.tasks.length,
    completed,
    failed,
    notStarted: options.tasks.length - tasksRun,
    pausedByQuota,
    totalDurationMs: Date.now() - batchStart,
  });

  return { pausedByQuota };
}
