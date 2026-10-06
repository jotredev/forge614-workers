/**
 * Contratos de entrada y salida de Workers: describe las tareas que llegan por stdin (entrada estándar), los
 * eventos que devuelve el lote y la validación del documento JSON (texto de datos estructurados). Lo usan el
 * cliente de Engines, el ejecutor y la interfaz de línea de comandos; `src/types.test.ts` prueba la validación.
 * Los cinco niveles de razonamiento son los que Engines conoce. Workers solo comprueba que el texto esté en
 * esta lista; Engines decide si un asistente acepta un nivel y devuelve `INVALID_REASONING_LEVEL` si no.
 */
export const REASONING_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

/** Uno de los valores de {@link REASONING_LEVELS}; el compilador rechaza otros textos, y en ejecución solo `parseTask` los rechaza. */
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

/** Una unidad de trabajo de un lote, tal como Atlas la describe por stdin. */
export interface TaskSpec {
  /** Identificador de la tarea, repetido como `taskId` en cada evento de esa tarea (`task_started`, `task_completed`, `task_failed`, `quota_exhausted`) para asociar el resultado con la entrada. */
  id: string;
  /** Identificador del asistente que Engines debe resolver. */
  agentId: string;
  /** Nombre o ruta del ejecutable que Engines usará al construir el comando. */
  executable: string;
  /** Instrucción completa que se entrega al proceso del asistente por stdin. */
  prompt: string;
  /** Carpeta adicional a la que puede acceder el ayudante, enviada a Engines como `--readable-dir`; concede acceso, pero no impone solo lectura (véase `readOnly`). */
  readableDir?: string;
  /**
   * Si vale `true`, el ayudante debe correr en solo lectura. Workers lo envía a Engines como `--read-only` y
   * rechaza la tarea (`engine_unsupported`, `READ_ONLY_UNSUPPORTED`) salvo que Engines garantice el bloqueo.
   */
  readOnly?: boolean;
  /** Modelo solicitado; si falta, Engines aplica su valor predeterminado para el asistente. */
  model?: string;
  /** Nivel de razonamiento solicitado o `null` cuando la tarea no fija ninguno. */
  reasoningLevel: ReasoningLevel | null;
  /** Tiempo máximo de ejecución de la tarea, en milisegundos. */
  timeoutMs: number;
}

/** Documento de una corrida ya validado, con la ruta de Engines, el tope de salida y las tareas en orden. */
export interface RunInput {
  /** Ruta o nombre del ejecutable de Engines. */
  enginesBin: string;
  /** Máximo de bytes que se conservan de cada salida de una tarea (stdout y stderr por separado); lo que sobra se descarta y se marca como truncado. */
  maxOutputBytes: number;
  /** Tareas del lote en el orden en que deben ejecutarse. */
  tasks: TaskSpec[];
}

/** Motivo por el que una tarea falló sin completarse; `engine_unsupported` cubre `HEADLESS_UNSUPPORTED`, `REASONING_LEVEL_UNSUPPORTED`, `READ_ONLY_UNSUPPORTED` y un bloqueo de solo lectura que Workers no pudo confirmar, mientras los errores de entrada de Engines van a `generic_error`. */
export type TaskFailureReason =
  | "timeout"
  | "engine_unsupported"
  | "spawn_error"
  | "generic_error";

/** Evento que Workers emite: inicio o resultado de una tarea, cuota agotada, resumen del lote o error fatal (`invalid_input` y `engines_bin_not_found` salen antes de correr el lote; `unexpected_error` puede salir después de que ya corrieron tareas). */
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

/** Tope predeterminado de bytes guardados por cada salida (stdout y stderr por separado) cuando el documento no trae `maxOutputBytes`: 10 MiB. */
export const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
/** Tiempo límite predeterminado de una tarea cuando no trae `timeoutMs`: 10 minutos, en milisegundos. */
export const DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000;

/** Error de validación que identifica un documento de entrada roto antes de iniciar ninguna tarea. */
export class InvalidInputError extends Error {}

/**
 * Convierte el documento de stdin en un {@link RunInput}; aplica los topes predeterminados y valida todos los
 * campos antes de iniciar una tarea.
 *
 * @param raw Texto JSON completo recibido por stdin.
 * @returns La entrada validada, con `maxOutputBytes`, `reasoningLevel` y `timeoutMs` ya normalizados.
 * @throws {@link InvalidInputError} si el JSON está roto, la raíz es `null` o no es un objeto (un arreglo pasa esta comprobación y falla después por no traer `enginesBin`), `enginesBin` falta o es un texto vacío, `tasks` no es un arreglo, `maxOutputBytes` no se convierte (con `Number`) en un número finito positivo o alguna tarea tiene un campo inválido.
 */
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

/**
 * Valida una entrada de `tasks` y copia solo los campos que Workers conoce; los opcionales de texto con otro
 * tipo se omiten, pero un `readOnly` inválido se rechaza para no perder el bloqueo en silencio.
 *
 * @param raw Valor sin validar de la entrada de `tasks`.
 * @param index Posición de la tarea, usada para nombrar con precisión el campo inválido.
 * @returns La tarea normalizada, con valores predeterminados para el tiempo límite y el nivel de razonamiento.
 * @throws {@link InvalidInputError} con `tasks[index]` si la entrada no es un objeto, falta un texto obligatorio (`id`, `agentId`, `executable`, `prompt`) o está vacío, `timeoutMs` no se convierte (con `Number`) en un número finito positivo, `reasoningLevel` no está permitido o `readOnly` no es booleano; el lote completo falla entonces antes de iniciar cualquier tarea.
 */
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
    if (!(REASONING_LEVELS as readonly unknown[]).includes(t.reasoningLevel)) {
      throw new InvalidInputError(
        `tasks[${index}].reasoningLevel must be one of ${REASONING_LEVELS.map((l) => `"${l}"`).join(", ")}`
      );
    }
    reasoningLevel = t.reasoningLevel as ReasoningLevel;
  }

  // A diferencia de `readableDir` y `model`, un `readOnly` erróneo nunca se descarta: ignorar el bloqueo en
  // silencio ejecutaría con acceso completo un ayudante que debía limitarse a solo lectura.
  if (t.readOnly !== undefined && typeof t.readOnly !== "boolean") {
    throw new InvalidInputError(`tasks[${index}].readOnly must be true, false or absent`);
  }

  return {
    id: t.id as string,
    agentId: t.agentId as string,
    executable: t.executable as string,
    prompt: t.prompt as string,
    readableDir: typeof t.readableDir === "string" ? t.readableDir : undefined,
    readOnly: t.readOnly,
    model: typeof t.model === "string" ? t.model : undefined,
    reasoningLevel,
    timeoutMs,
  };
}
