/**
 * Cliente de Engines: construye llamadas sin interfaz (`headless`) para obtener el comando de una tarea y
 * consulta si un asistente garantiza el bloqueo de solo lectura. `src/runner.ts` usa ambas operaciones y
 * `src/engines-client.test.ts` las prueba contra el ejecutable real y contra respuestas inválidas.
 */
import type { ReasoningLevel } from "./types";

/** Comando que Engines resolvió para ejecutar una tarea y la forma en que debe recibir su instrucción. */
export interface HeadlessCommand {
  /** Ruta o nombre del programa que Workers debe lanzar. */
  command: string;
  /** Argumentos del programa, en el orden exacto que Engines determinó. */
  args: string[];
  /** Si vale `true`, el programa espera que la instrucción llegue por stdin (entrada estándar). */
  stdin?: boolean;
}

/** Datos que Workers entrega al comando `headless` de Engines para construir la ejecución de una tarea. */
export interface ResolveHeadlessOptions {
  /** Ruta o nombre del ejecutable de Engines que se invoca. */
  enginesBin: string;
  /** Identificador del asistente cuyo comando se solicita. */
  agentId: string;
  /** Ejecutable del asistente que Engines debe incorporar al comando resuelto. */
  executable: string;
  /** Instrucción de la tarea; no se pasa a Engines y luego se entrega al asistente por stdin. */
  prompt: string;
  /** Carpeta adicional a la que puede acceder el ayudante, enviada como `--readable-dir`; concede acceso, pero no impone solo lectura (véase `readOnly`). */
  readableDir?: string;
  /** Si vale `true`, se agrega `--read-only` para que Engines construya el bloqueo de solo lectura. */
  readOnly?: boolean;
  /** Modelo solicitado; si falta, Engines elige el predeterminado del asistente. */
  model?: string;
  /** Nivel de razonamiento solicitado o `null` cuando la tarea no fija ninguno. */
  reasoningLevel?: ReasoningLevel | null;
}

/** Resultado de {@link resolveHeadlessCommand}: el comando ejecutable o el código y mensaje con que Engines rechazó la solicitud. */
export type ResolveHeadlessResult =
  | { ok: true; command: HeadlessCommand }
  | { ok: false; code: string; message: string };

/**
 * Pide a Engines el comando para ejecutar una tarea sin interfaz (`headless`). Una respuesta de rechazo nunca
 * lanza: devuelve `{ ok: false, code, message }` con el código de Engines, por ejemplo `UNKNOWN_AGENT`,
 * `INVALID_REASONING_LEVEL` o `READ_ONLY_UNSUPPORTED`; una respuesta ilegible devuelve
 * `ENGINES_RESPONSE_INVALID` con los primeros 200 caracteres de stdout (salida normal).
 *
 * @param options Ejecutable de Engines y datos de la tarea usados para formar sus argumentos.
 * @returns El comando resuelto o el rechazo normalizado con el código y mensaje correspondientes.
 * @throws El error de lanzamiento o de lectura si no se puede iniciar Engines o leer la salida del proceso; las respuestas que Engines sí entrega se convierten en resultados y no lanzan.
 */
export async function resolveHeadlessCommand(
  options: ResolveHeadlessOptions
): Promise<ResolveHeadlessResult> {
  // El prompt no se pasa como argumento `--prompt`: Workers siempre pide `--stdin-prompt` y Engines ignora por
  // completo el valor de `--prompt` cuando ambos aparecen (se comprobó que la salida es idéntica byte a byte).
  // Pasarlo también arriesgaría un error `E2BIG` para instrucciones cercanas a `ARG_MAX` (límite de bytes de los
  // argumentos del sistema operativo, que puede ser de unos 128 KiB) y dejaría el contenido visible en `argv`
  // (lista de argumentos del proceso) durante la llamada. Por eso la instrucción viaja después al asistente por stdin.
  const args = [
    "headless",
    "--agent", options.agentId,
    "--executable", options.executable,
    "--stdin-prompt",
  ];
  if (options.model) args.push("--model", options.model);
  if (options.reasoningLevel) args.push("--reasoning-level", options.reasoningLevel);
  if (options.readableDir) args.push("--readable-dir", options.readableDir);
  if (options.readOnly) args.push("--read-only");

  // stderr (salida de errores) se ignora, sin abrir una tubería, para que un proceso que escriba mucho allí no
  // llene el búfer del sistema y quede bloqueado mientras Workers solo espera stdout y la terminación.
  const proc = Bun.spawn([options.enginesBin, ...args], { stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  let parsed: { headless: HeadlessCommand } | { error: { code: string; message: string } };
  try {
    const candidate = JSON.parse(stdout) as unknown;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      (!("headless" in candidate) && !("error" in candidate))
    ) {
      throw new Error('response JSON did not contain a "headless" or "error" field');
    }
    parsed = candidate as { headless: HeadlessCommand } | { error: { code: string; message: string } };
  } catch (err) {
    const snippet = stdout.slice(0, 200);
    return {
      ok: false,
      code: "ENGINES_RESPONSE_INVALID",
      message:
        `Failed to parse forge614-engines headless output as JSON: ${(err as Error).message}. ` +
        `Raw stdout (truncated): ${JSON.stringify(snippet)}`,
    };
  }

  if ("error" in parsed) {
    return { ok: false, code: parsed.error.code, message: parsed.error.message };
  }
  return { ok: true, command: parsed.headless };
}

/** Firma de {@link resolveHeadlessCommand}; permite que el ejecutor reciba un doble en las pruebas. */
export type ResolveHeadlessCommand =typeof resolveHeadlessCommand;

/**
 * Pregunta a Engines (`capabilities --agent <id>`) si garantiza el bloqueo de solo lectura para un asistente.
 * Solo responde `true` si el JSON trae `supportsReadOnly === true`; un campo ausente, `false`, un error de
 * Engines, una salida que no sea JSON o un ejecutable que no arranque producen `false` en vez de lanzar. Así,
 * un bloqueo que no se puede confirmar se considera no garantizado. La consulta no tiene tiempo límite propio:
 * si nunca responde, detiene el lote antes de pedir ningún comando.
 *
 * @param enginesBin Ruta o nombre del ejecutable de Engines que se consulta.
 * @param agentId Identificador del asistente cuya capacidad de solo lectura se comprueba.
 * @returns `true` solo ante una respuesta JSON con `supportsReadOnly` exactamente en `true`; `false` en cualquier otro caso.
 */
export async function engineSupportsReadOnly(enginesBin: string, agentId: string): Promise<boolean> {
  try {
    // stderr se ignora por la misma razón que en `resolveHeadlessCommand`: evita llenar una tubería que no se leería.
    const proc = Bun.spawn([enginesBin, "capabilities", "--agent", agentId], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    const candidate = JSON.parse(stdout) as unknown;
    return (
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as { supportsReadOnly?: unknown }).supportsReadOnly === true
    );
  } catch {
    return false;
  }
}

/** Firma de {@link engineSupportsReadOnly}; permite que el ejecutor reciba un doble en las pruebas. */
export type EngineSupportsReadOnly = typeof engineSupportsReadOnly;
