import type { TaskSpec, TaskEvent } from "./types";
import { getAdapter } from "./adapters/registry";
import { QUOTA_STDOUT_PREFIX_BYTES } from "./adapters/contract";
import {
  resolveHeadlessCommand,
  engineSupportsReadOnly,
  type ResolveHeadlessCommand,
  type EngineSupportsReadOnly,
} from "./engines-client";
import { runProcess, type RunProcess } from "./process-runner";

export interface RunBatchOptions {
  enginesBin: string;
  maxOutputBytes: number;
  tasks: TaskSpec[];
}

/** The outside world `runBatch` talks to; tests replace these with doubles. */
export interface RunBatchDeps {
  resolveHeadlessCommand: ResolveHeadlessCommand;
  runProcess: RunProcess;
  /**
   * Confirms with Engines that the read-only lock is guaranteed for an agent.
   * Only consulted for tasks that set `readOnly`. Optional so a caller that
   * never runs read-only tasks does not have to provide it; when absent the
   * real {@link engineSupportsReadOnly} is used.
   */
  checkReadOnlySupport?: EngineSupportsReadOnly;
}

/** What `runBatch` reports back besides the events it emits. */
export interface RunBatchResult {
  pausedByQuota: boolean;
}

const defaultDeps: RunBatchDeps = {
  resolveHeadlessCommand,
  runProcess,
  checkReadOnlySupport: engineSupportsReadOnly,
};

/**
 * Runs the tasks of a batch one after another and reports each outcome through
 * `onEvent`, always ending with `run_completed`. A task that sets `readOnly`
 * only runs after Engines has confirmed the lock for its agent (asked once per
 * agent per batch); otherwise it fails as `engine_unsupported` with
 * `READ_ONLY_UNSUPPORTED` and no command is requested or launched.
 */
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

  /** Whether Engines guarantees the read-only lock for `agentId`; asked once per agent per batch and remembered, refusals included. */
  const readOnlyGuaranteed = new Map<string, boolean>();
  const checkReadOnlySupport = deps.checkReadOnlySupport ?? engineSupportsReadOnly;
  /** Answers from {@link readOnlyGuaranteed}, asking Engines only the first time; a failed check counts as not guaranteed. */
  async function isReadOnlyGuaranteed(agentId: string): Promise<boolean> {
    const known = readOnlyGuaranteed.get(agentId);
    if (known !== undefined) return known;
    let guaranteed: boolean;
    try {
      guaranteed = (await checkReadOnlySupport(options.enginesBin, agentId)) === true;
    } catch {
      guaranteed = false;
    }
    readOnlyGuaranteed.set(agentId, guaranteed);
    return guaranteed;
  }

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
      // The lock is confirmed BEFORE any command is requested: an Engines
      // that predates `--read-only` would ignore it without an error and the
      // helper would run with full access.
      if (task.readOnly && !(await isReadOnlyGuaranteed(task.agentId))) {
        failed++;
        const refusal =
          `READ_ONLY_UNSUPPORTED: Engines does not guarantee read-only execution ` +
          `for agent "${task.agentId}"; the task was not run`;
        onEvent({
          event: "task_failed",
          taskId: task.id,
          reason: "engine_unsupported",
          exitCode: null,
          stdout: "",
          stdoutBytes: 0,
          stdoutTruncated: false,
          stderr: refusal,
          stderrBytes: Buffer.byteLength(refusal, "utf8"),
          stderrTruncated: false,
        });
        continue;
      }

      const resolved = await deps.resolveHeadlessCommand({
        enginesBin: options.enginesBin,
        agentId: task.agentId,
        executable: task.executable,
        prompt: task.prompt,
        readableDir: task.readableDir,
        readOnly: task.readOnly,
        model: task.model,
        reasoningLevel: task.reasoningLevel,
      });

      if (!resolved.ok) {
        failed++;
        // engine_unsupported is reserved specifically for the codes that
        // mean "this agent cannot do what was asked": HEADLESS_UNSUPPORTED,
        // REASONING_LEVEL_UNSUPPORTED and READ_ONLY_UNSUPPORTED. Any other
        // code is a different kind of failure and must not be mislabeled as
        // unsupported, since a caller may permanently avoid a valid
        // combination based on that label. That includes
        // ENGINES_RESPONSE_INVALID (a malformed or crashed Engines response)
        // and the two input errors INVALID_REASONING_LEVEL and UNKNOWN_AGENT
        // returned by headless: the task named something that does not
        // exist, which is not a capability gap. (A readOnly task with an
        // unknown agent never gets that far: the capabilities check fails
        // first and it is reported as READ_ONLY_UNSUPPORTED.) All of them go
        // to generic_error, and the code is preserved in `stderr` so it isn't
        // lost for diagnostics.
        const reason =
          resolved.code === "HEADLESS_UNSUPPORTED" ||
          resolved.code === "REASONING_LEVEL_UNSUPPORTED" ||
          resolved.code === "READ_ONLY_UNSUPPORTED"
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
