/**
 * Ejecutor de lotes (batch: la lista de tareas que Atlas manda en una sola corrida): recorre las tareas una tras
 * otra, le pide a Engines (forge614-engines, el programa que arma el comando de cada asistente) el comando de
 * cada una, lo lanza como proceso y emite un evento por cada resultado. Existe para que una tarea que falle o
 * se cuelgue no tumbe el lote (si una agota la cuota, el lote se detiene a propósito y las tareas que faltan no
 * se inician), y para que el último evento sea siempre `run_completed`, salvo que `onEvent` lance un error.
 * Lo importa `src/cli.ts`; lo prueba `src/runner.test.ts`. Piezas: `RunBatchOptions`, `RunBatchDeps`,
 * `RunBatchResult` y la función `runBatch`.
 */
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

/** Datos de una corrida: lo que `runBatch` necesita saber del lote que le llega ya validado. */
export interface RunBatchOptions {
  /** Ruta del ejecutable de Engines al que se le piden los comandos (`headless`) y la comprobación de solo lectura (`capabilities`). */
  enginesBin: string;
  /** Tope de bytes que se guardan de stdout y de stderr (salida normal y de errores del proceso) por tarea; lo que sobra se descarta y se marca como truncado. */
  maxOutputBytes: number;
  /** Tareas del lote, en el orden en que se ejecutan; se corren de una en una, nunca en paralelo. */
  tasks: TaskSpec[];
}

/** El mundo exterior con el que habla `runBatch`; las pruebas lo reemplazan por dobles (versiones falsas que no lanzan procesos reales). */
export interface RunBatchDeps {
  /** Pide a Engines el comando que ejecuta una tarea sin interfaz (`headless`); devuelve el comando o el código de rechazo de Engines. */
  resolveHeadlessCommand: ResolveHeadlessCommand;
  /** Lanza el comando como proceso hijo, con tiempo límite y tope de salida, y devuelve cómo terminó. */
  runProcess: RunProcess;
  /**
   * Confirma con Engines que el bloqueo de solo lectura está garantizado para
   * un asistente. Solo se consulta para las tareas que traen `readOnly`. Es
   * opcional para que quien nunca ejecuta tareas de solo lectura no tenga que
   * darlo; si falta se usa el {@link engineSupportsReadOnly} real.
   */
  checkReadOnlySupport?: EngineSupportsReadOnly;
}

/** Lo que `runBatch` devuelve además de los eventos que emite. */
export interface RunBatchResult {
  /** `true` si el lote se detuvo porque una tarea agotó la cuota del asistente; las tareas que seguían no se iniciaron. */
  pausedByQuota: boolean;
}

const defaultDeps: RunBatchDeps = {
  resolveHeadlessCommand,
  runProcess,
  checkReadOnlySupport: engineSupportsReadOnly,
};

/**
 * Ejecuta las tareas de un lote una tras otra e informa cada resultado por
 * `onEvent`, terminando siempre con `run_completed`. Una tarea con `readOnly`
 * solo corre después de que Engines confirme el bloqueo para su asistente (se
 * pregunta una vez por asistente en cada lote); si no, falla como
 * `engine_unsupported` con `READ_ONLY_UNSUPPORTED` y no se pide ni se lanza
 * ningún comando.
 *
 * @param options Datos del lote: ruta de Engines, tope de salida por tarea y la lista de tareas.
 * @param onEvent Función que recibe cada evento (`task_started`, `task_completed`, `task_failed`, `quota_exhausted`, `run_completed`) en cuanto ocurre; quien llama decide qué hacer con él.
 * @param deps Dependencias externas; por defecto las reales, y las pruebas pasan dobles.
 * @returns `{ pausedByQuota }`: `true` si una tarea agotó la cuota y el lote se cortó ahí.
 * @throws Lo que lance `onEvent` al emitir `task_started` o `run_completed` (fuera del `try` de cada tarea) o al emitir el `task_failed` del `catch`; si `onEvent` lanza en otro evento, el `catch` lo trata como fallo de esa tarea. Un fallo de una tarea nunca lanza: se convierte en un evento `task_failed`.
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

  /** Si Engines garantiza el bloqueo de solo lectura para `agentId`; se pregunta una vez por asistente en cada lote y se recuerda la respuesta, también los rechazos. */
  const readOnlyGuaranteed = new Map<string, boolean>();
  const checkReadOnlySupport = deps.checkReadOnlySupport ?? engineSupportsReadOnly;
  /**
   * Responde con lo guardado en {@link readOnlyGuaranteed} y solo consulta a
   * Engines la primera vez; una comprobación que falla cuenta como no garantizado.
   *
   * @param agentId Identificador del asistente (por ejemplo `codex`) cuyo bloqueo se confirma.
   * @returns `true` solo si Engines respondió exactamente `true`; si respondió otra cosa o lanzó un error, `false`.
   */
  async function isReadOnlyGuaranteed(agentId: string): Promise<boolean> {
    // Si ya se preguntó por este asistente en este lote, se reutiliza la respuesta (sea sí o no).
    const known = readOnlyGuaranteed.get(agentId);
    if (known !== undefined) return known;
    let guaranteed: boolean;
    try {
      guaranteed = (await checkReadOnlySupport(options.enginesBin, agentId)) === true;
    } catch {
      // Un error al preguntar no se propaga: un bloqueo que no se pudo confirmar cuenta como no garantizado.
      guaranteed = false;
    }
    readOnlyGuaranteed.set(agentId, guaranteed);
    return guaranteed;
  }

  // Un solo ciclo recorre las tareas en orden; cada vuelta emite como mucho un evento final de esa tarea.
  for (const task of options.tasks) {
    tasksRun++;
    onEvent({
      event: "task_started",
      taskId: task.id,
      agentId: task.agentId,
      startedAt: new Date().toISOString(),
    });

    // El cuerpo de cada tarea va envuelto para que una excepción inesperada
    // en cualquier punto (un error en otra parte, falta de memoria, EMFILE
    // (demasiados archivos abiertos), cualquier cosa que no esté ya modelada
    // como fallo tipado de resolveHeadlessCommand o runProcess) marque solo
    // esta tarea como fallida y deje seguir al lote, en lugar de salir de
    // runBatch y saltarse en silencio el evento run_completed que quienes
    // llaman esperan como última línea siempre emitida.
    try {
      // El bloqueo se confirma ANTES de pedir cualquier comando: un Engines
      // anterior a `--read-only` lo ignoraría sin dar error y el ayudante
      // correría con acceso completo.
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

      // Se le pide a Engines el comando de esta tarea con su asistente, ejecutable, modelo, nivel de razonamiento, carpeta legible y solo lectura; el prompt no se le manda a Engines: viaja por stdin al lanzar el proceso.
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
        // engine_unsupported se reserva solo para los códigos que significan
        // «este asistente no puede hacer lo pedido»: HEADLESS_UNSUPPORTED,
        // REASONING_LEVEL_UNSUPPORTED y READ_ONLY_UNSUPPORTED. Cualquier otro
        // código es otra clase de fallo y no debe etiquetarse como no
        // soportado, porque quien llama podría evitar para siempre una
        // combinación válida según esa etiqueta. Eso incluye
        // ENGINES_RESPONSE_INVALID (una respuesta de Engines mal formada o de
        // un Engines que se cayó) y los dos errores de entrada
        // INVALID_REASONING_LEVEL y UNKNOWN_AGENT que devuelve headless: la
        // tarea nombró algo que no existe, y eso no es una carencia de
        // capacidad. (Una tarea readOnly con un asistente desconocido nunca
        // llega hasta aquí: la comprobación de capacidades falla antes y se
        // informa como READ_ONLY_UNSUPPORTED.) Todos esos casos van a
        // generic_error, y el código se conserva en `stderr` para no
        // perderlo en el diagnóstico.
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

      // El adaptador (reglas propias de cada asistente) puede faltar si el asistente no está registrado; entonces no se agregan argumentos y tampoco se detecta cuota (un fallo con salida distinta de cero sale como generic_error).
      const adapter = getAdapter(task.agentId);
      // El prompt viaja por stdin (la entrada estándar del proceso), no como argumento de línea de comandos.
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

      if (!result.ok) continue; // Guarda para el compilador: `spawn_error` y `timeout` ya se trataron arriba, así que aquí `result` solo puede ser `ok: true` y esta línea no se ejecuta; si se agregara otro motivo de fallo, la tarea se saltaría sin emitir ningún evento final.

      if (result.exitCode !== 0) {
        // La detección de cuota solo tiene sentido con una salida distinta de
        // cero: una tarea que sale con 0 (éxito) nunca debe tratarse como
        // cuota agotada, sin importar lo que diga su salida (por ejemplo una
        // revisión de código que solo menciona «rate limiting» (límite de
        // peticiones) en su texto). Se mira primero el código de salida y la
        // detección por patrones de cuota solo corre en este camino de salida
        // distinta de cero, antes de generic_error, porque quota_exhausted y
        // generic_error son ambos resultados de «salida distinta de cero» que
        // solo se distinguen por si el adaptador reconoce un patrón de cuota.
        //
        // Se corta por bytes UTF-8 reales, no por unidades de código UTF-16: `String.slice` cuenta unidades de código, lo que se aparta de los «exactamente 4096 bytes» (`QUOTA_STDOUT_PREFIX_BYTES`) en cuanto el stdout trae caracteres de varios bytes antes del punto de corte.
        const stdoutPrefix = Buffer.from(result.stdout.text, "utf8")
          .subarray(0, QUOTA_STDOUT_PREFIX_BYTES)
          .toString("utf8");
        const quota =
          adapter?.detectQuotaExhausted(result.stderr.text, stdoutPrefix) ?? { matched: false };

        if (quota.matched) {
          // Cuota agotada: se avisa, se marca el lote como pausado y se sale del ciclo; las tareas que faltan quedan sin iniciar.
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

      // Salida 0 sin tiempo agotado: la tarea terminó bien.
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
      // Excepción inesperada dentro de la tarea: se cuenta como fallo de esta tarea y el lote sigue con la siguiente.
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

  // Evento final: `notStarted` son las tareas que no llegaron a iniciarse porque el lote se cortó por cuota.
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
