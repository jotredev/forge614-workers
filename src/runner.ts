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

    // Every task's body is wrapped so that an unexpected throw anywhere
    // (a bug elsewhere, OOM, EMFILE, anything not already modeled as a
    // typed failure from resolveHeadlessCommand/runProcess) marks this one
    // task as failed and lets the batch continue, instead of propagating
    // out of runBatch and silently skipping the run_completed event that
    // callers rely on as the always-emitted final line.
    try {
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
        // engine_unsupported is reserved specifically for the codes that
        // mean "this engine/model/reasoning-level combination is not
        // supported". Any other code (e.g. ENGINES_RESPONSE_INVALID from a
        // malformed/crashed Engines response, or an unrecognized code like
        // UNKNOWN_AGENT) is a different kind of failure and must not be
        // mislabeled as unsupported, since a caller may permanently avoid a
        // valid combination based on that label. The code is preserved in
        // `stderr` either way so it isn't lost for diagnostics.
        const reason =
          resolved.code === "HEADLESS_UNSUPPORTED" || resolved.code === "REASONING_LEVEL_UNSUPPORTED"
            ? "engine_unsupported"
            : "generic_error";
        const stderrMessage = `${resolved.code}: ${resolved.message}`;
        onEvent({
          event: "task_failed",
          taskId: task.id,
          reason,
          exitCode: null,
          stdout: "",
          stdoutBytes: 0,
          stdoutTruncated: false,
          stderr: stderrMessage,
          stderrBytes: Buffer.byteLength(stderrMessage, "utf8"),
          stderrTruncated: false,
        });
        continue;
      }

      const adapter = getAdapter(task.agentId);
      const result = await deps.runProcess({
        command: resolved.command.command,
        args: [...resolved.command.args, ...(adapter?.extraArgs() ?? [])],
        stdin: task.prompt,
        timeoutMs: task.timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
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
          stderrBytes: Buffer.byteLength(result.message, "utf8"),
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

      if (result.exitCode !== 0) {
        // Quota detection only makes sense for a non-zero exit: a task that
        // exits 0 (success) should never be treated as quota-exhausted no
        // matter what its output contains (e.g. a code review that merely
        // discusses "rate limiting" in its output text). Check the exit
        // code first, and only run quota-pattern detection in this
        // non-zero-exit path, folded in before generic_error since
        // quota_exhausted and generic_error are both "non-zero exit"
        // outcomes that differ only in whether the adapter recognizes a
        // quota pattern.
        //
        // Slice by true UTF-8 bytes, not UTF-16 code units: `String.slice`
        // counts code units, which diverges from the spec's "exactly N
        // bytes" contract once stdout contains multi-byte characters
        // before the cutoff point.
        const stdoutPrefix = Buffer.from(result.stdout.text, "utf8")
          .subarray(0, QUOTA_STDOUT_PREFIX_BYTES)
          .toString("utf8");
        const quota =
          adapter?.detectQuotaExhausted(result.stderr.text, stdoutPrefix) ?? { matched: false };

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
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      onEvent({
        event: "task_failed",
        taskId: task.id,
        reason: "generic_error",
        exitCode: null,
        stdout: "",
        stdoutBytes: 0,
        stdoutTruncated: false,
        stderr: message,
        stderrBytes: Buffer.byteLength(message, "utf8"),
        stderrTruncated: false,
      });
      continue;
    }
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
