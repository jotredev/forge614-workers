export type ReasoningLevel = "low" | "medium" | "high";

export interface TaskSpec {
  id: string;
  agentId: string;
  executable: string;
  prompt: string;
  model?: string;
  reasoningLevel: ReasoningLevel | null;
  timeoutMs: number;
}

export interface RunInput {
  enginesBin: string;
  maxOutputBytes: number;
  tasks: TaskSpec[];
}

export type TaskFailureReason =
  | "timeout"
  | "engine_unsupported"
  | "spawn_error"
  | "generic_error";

export type TaskEvent =
  | { event: "task_started"; taskId: string; agentId: string; startedAt: string }
  | {
      event: "task_completed";
      taskId: string;
      exitCode: number;
      durationMs: number;
      stdout: string;
      stdoutBytes: number;
      stdoutTruncated: boolean;
      stderr: string;
      stderrBytes: number;
      stderrTruncated: boolean;
    }
  | {
      event: "task_failed";
      taskId: string;
      reason: TaskFailureReason;
      exitCode: number | null;
      stdout: string;
      stdoutBytes: number;
      stdoutTruncated: boolean;
      stderr: string;
      stderrBytes: number;
      stderrTruncated: boolean;
    }
  | {
      event: "quota_exhausted";
      taskId: string;
      agentId: string;
      matchedPattern: string;
      stdout: string;
      stdoutBytes: number;
      stdoutTruncated: boolean;
      stderr: string;
      stderrBytes: number;
      stderrTruncated: boolean;
    }
  | {
      event: "run_completed";
      totalTasks: number;
      completed: number;
      failed: number;
      notStarted: number;
      pausedByQuota: boolean;
      totalDurationMs: number;
    }
  | {
      event: "fatal_error";
      reason: "invalid_input" | "engines_bin_not_found" | "unexpected_error";
      message: string;
    };

export const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000;

export class InvalidInputError extends Error {}

export function parseRunInput(raw: string): RunInput {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new InvalidInputError(`Input is not valid JSON: ${(err as Error).message}`);
  }

  if (typeof data !== "object" || data === null) {
    throw new InvalidInputError("Input must be a JSON object");
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj.enginesBin !== "string" || obj.enginesBin.length === 0) {
    throw new InvalidInputError('"enginesBin" is required and must be a non-empty string');
  }
  if (!Array.isArray(obj.tasks)) {
    throw new InvalidInputError('"tasks" is required and must be an array');
  }

  const maxOutputBytes =
    obj.maxOutputBytes === undefined ? DEFAULT_MAX_OUTPUT_BYTES : Number(obj.maxOutputBytes);
  if (!Number.isFinite(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new InvalidInputError('"maxOutputBytes" must be a positive number');
  }

  const tasks = obj.tasks.map((rawTask, index) => parseTask(rawTask, index));

  return { enginesBin: obj.enginesBin, maxOutputBytes, tasks };
}

function parseTask(raw: unknown, index: number): TaskSpec {
  if (typeof raw !== "object" || raw === null) {
    throw new InvalidInputError(`tasks[${index}] must be an object`);
  }
  const t = raw as Record<string, unknown>;
  for (const field of ["id", "agentId", "executable", "prompt"] as const) {
    if (typeof t[field] !== "string" || (t[field] as string).length === 0) {
      throw new InvalidInputError(
        `tasks[${index}].${field} is required and must be a non-empty string`
      );
    }
  }
  const timeoutMs = t.timeoutMs === undefined ? DEFAULT_TASK_TIMEOUT_MS : Number(t.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new InvalidInputError(`tasks[${index}].timeoutMs must be a positive number`);
  }

  let reasoningLevel: ReasoningLevel | null = null;
  if (t.reasoningLevel !== undefined && t.reasoningLevel !== null) {
    if (!["low", "medium", "high"].includes(t.reasoningLevel as string)) {
      throw new InvalidInputError(
        `tasks[${index}].reasoningLevel must be one of "low", "medium", "high"`
      );
    }
    reasoningLevel = t.reasoningLevel as ReasoningLevel;
  }

  return {
    id: t.id as string,
    agentId: t.agentId as string,
    executable: t.executable as string,
    prompt: t.prompt as string,
    model: typeof t.model === "string" ? t.model : undefined,
    reasoningLevel,
    timeoutMs,
  };
}
