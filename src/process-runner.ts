/**
 * Lanzador de procesos: ejecuta un comando como proceso hijo (un programa que arranca este y del que espera
 * el resultado) dentro de una carpeta temporal vacía, le manda el prompt por stdin (entrada estándar), guarda
 * su stdout (salida normal) y su stderr (salida de errores) con un tope de bytes, y lo detiene si pasa el
 * tiempo límite. Existe para que `runBatch` lance cada tarea sin ocuparse de tuberías, temporizadores ni limpieza.
 * Lo importa `src/runner.ts` (como dependencia por defecto); lo prueba `src/process-runner.test.ts`.
 * Piezas: `CapturedOutput`, `RunProcessOptions`, `RunProcessResult`, `captureStream` y `runProcess`.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Lo que se guardó de una de las dos salidas del proceso (stdout o stderr). */
export interface CapturedOutput {
  /** Texto guardado, decodificado como UTF-8 a partir de como máximo `maxOutputBytes` bytes de la salida real; si el corte cae a mitad de un carácter de varios bytes, el texto termina con un carácter de reemplazo. */
  text: string;
  /** Bytes que el proceso escribió en total, incluidos los que no se guardaron por pasar el tope. */
  bytes: number;
  /** `true` si el proceso escribió más bytes que el tope y el texto guardado quedó incompleto. */
  truncated: boolean;
}

/** Datos para lanzar un proceso con `runProcess`. */
export interface RunProcessOptions {
  /** Programa que se ejecuta (ruta o nombre); es el `command` que Engines devolvió para la tarea. */
  command: string;
  /** Argumentos del programa, uno por elemento, sin pasar por un intérprete de comandos. */
  args: string[];
  /** Texto que se escribe en el stdin del proceso y después se cierra; es el prompt de la tarea. */
  stdin: string;
  /** Milisegundos que el proceso puede tardar; al cumplirse se le pide terminar con SIGTERM (señal de terminación). */
  timeoutMs: number;
  /** Tope de bytes que se guardan de cada salida (stdout y stderr por separado); lo que sobra se cuenta pero no se guarda. */
  maxOutputBytes: number;
  /** Milisegundos de gracia tras el SIGTERM antes de matarlo con SIGKILL (señal de muerte que el proceso no puede ignorar); si falta, 5000. */
  sigkillGraceMs?: number;
}

/** Cómo terminó el proceso: por su cuenta (`ok: true`, con cualquier código de salida), pasándose del tiempo límite o sin poder arrancar. */
export type RunProcessResult =
  /** El proceso terminó por su cuenta; `exitCode` es su código de salida (0 suele significar éxito) y `durationMs` lo que tardó hasta leer sus dos salidas. */
  | { ok: true; exitCode: number; durationMs: number; stdout: CapturedOutput; stderr: CapturedOutput }
  /** Se pasó de `timeoutMs` y se le envió SIGTERM (y SIGKILL si no obedeció); se devuelve lo que alcanzó a escribir. */
  | { ok: false; reason: "timeout"; stdout: CapturedOutput; stderr: CapturedOutput }
  /** El sistema no pudo arrancar el programa (por ejemplo, no existe); `message` es el error del sistema. */
  | { ok: false; reason: "spawn_error"; message: string };

const DEFAULT_SIGKILL_GRACE_MS = 5000;

/**
 * Lee una salida del proceso hasta que se cierra y guarda como mucho `maxBytes` bytes de ella. Sigue leyendo
 * y contando aunque ya no guarde nada, para que el proceso nunca se bloquee por una tubería (canal entre
 * procesos) llena.
 *
 * @param stream Salida del proceso (stdout o stderr) como flujo de bytes; `null` si no hay.
 * @param maxBytes Máximo de bytes que se guardan; el trozo que cruza el tope se corta justo en él.
 * @returns El texto guardado, el total de bytes leídos y si hubo truncado; con `null` devuelve texto vacío, 0 bytes y sin truncar.
 */
async function captureStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<CapturedOutput> {
  if (!stream) return { text: "", bytes: 0, truncated: false };
  const reader = stream.getReader();
  const kept: Uint8Array[] = [];
  let keptBytes = 0;
  let totalBytes = 0;

  // Se lee trozo a trozo hasta que el proceso cierra la salida.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // El total cuenta todo lo que llega, se guarde o no.
    totalBytes += value.byteLength;
    // Solo se guarda mientras quede espacio bajo el tope; el trozo que lo cruza se recorta.
    if (keptBytes < maxBytes) {
      const room = maxBytes - keptBytes;
      const slice = value.byteLength > room ? value.subarray(0, room) : value;
      kept.push(slice);
      keptBytes += slice.byteLength;
    }
  }

  return {
    text: Buffer.concat(kept).toString("utf8"),
    bytes: totalBytes,
    truncated: totalBytes > maxBytes,
  };
}

/**
 * Ejecuta un comando como proceso hijo en una carpeta temporal nueva, le escribe `stdin`, guarda sus salidas y
 * lo detiene si pasa `timeoutMs`. La carpeta temporal se borra siempre al terminar, también si el proceso no arranca.
 *
 * @param options Comando, argumentos, texto de stdin, tiempo límite, tope de salida y gracia antes del SIGKILL.
 * @returns El resultado según cómo terminó: `ok: true` con código de salida y salidas, `reason: "timeout"` con lo escrito hasta entonces, o `reason: "spawn_error"` con el mensaje del sistema.
 * @throws Un error del sistema de archivos si no se puede crear la carpeta temporal o, al final, borrarla; un fallo al arrancar el programa no lanza, se devuelve como `spawn_error`.
 */
export async function runProcess(options: RunProcessOptions): Promise<RunProcessResult> {
  // Carpeta de trabajo propia del proceso: nueva y vacía, para que no corra dentro de ningún repositorio (solo cambia su carpeta actual; el entorno y el resto del disco no se aíslan).
  const tempDir = await mkdtemp(join(tmpdir(), "forge614-workers-"));
  try {
    let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
    try {
      proc = Bun.spawn([options.command, ...options.args], {
        cwd: tempDir,
        // Se pasa process.env de forma explícita (en lugar de omitir `env`,
        // que Bun resuelve desde una copia interna tomada al arrancar Bun y
        // que NO refleja cambios hechos después a process.env) para que el
        // hijo herede siempre el entorno real, vivo y sin tocar del padre.
        env: process.env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (err) {
      // El programa no pudo arrancar (por ejemplo no existe): se informa como resultado, no como excepción.
      return { ok: false, reason: "spawn_error", message: (err as Error).message };
    }

    // Se escribe el stdin y se cierra como una operación en segundo plano
    // que nadie espera. Deliberadamente NO se espera antes de armar los
    // temporizadores del tiempo límite ni de empezar a leer stdout/stderr
    // más abajo: si el hijo tarda en leer su stdin (por ejemplo, escribe
    // mucho stdout primero y el búfer de la tubería del sistema se llena
    // antes de que se ponga a leer), esperar aquí bloquearía sin fin con los
    // temporizadores sin armar, anulando timeoutMs para toda esa clase
    // plausible de comportamiento del hijo. Aun así se engancha un .catch()
    // síncrono para que un fallo al escribir o cerrar (por ejemplo EPIPE
    // (tubería rota), de un hijo que cierra o nunca lee su stdin, también
    // una condición normal y válida) nunca aparezca como un rechazo sin
    // atender; no significa que el proceso haya fallado, solo que falló la
    // escritura en su tubería de stdin.
    void Promise.resolve()
      .then(() => proc.stdin.write(options.stdin))
      .then(() => proc.stdin.end())
      .catch(() => {
        // Se ignora: ver el comentario de arriba.
      });

    // Desde aquí corre el reloj de la duración, y las dos salidas se leen a la vez, sin esperar a que el proceso termine.
    const start = Date.now();
    const stdoutPromise = captureStream(proc.stdout, options.maxOutputBytes);
    const stderrPromise = captureStream(proc.stderr, options.maxOutputBytes);

    // Dos temporizadores: al cumplirse el tiempo se pide terminar (SIGTERM) y se marca el tiempo agotado; si el proceso sigue vivo pasada la gracia, se mata (SIGKILL).
    let timedOut = false;
    const graceMs = options.sigkillGraceMs ?? DEFAULT_SIGKILL_GRACE_MS;
    const termTimer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, options.timeoutMs);
    const killTimer = setTimeout(() => {
      if (timedOut) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // ya había terminado
        }
      }
    }, options.timeoutMs + graceMs);

    // Se espera la salida del proceso y se cancelan los temporizadores; después se recogen las dos salidas ya completas.
    const exitCode = await proc.exited;
    clearTimeout(termTimer);
    clearTimeout(killTimer);
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

    // Si el temporizador de tiempo se disparó, el resultado es `timeout` aunque el proceso haya terminado después de la señal.
    if (timedOut) {
      return { ok: false, reason: "timeout", stdout, stderr };
    }
    return { ok: true, exitCode, durationMs: Date.now() - start, stdout, stderr };
  } finally {
    // Se borra la carpeta temporal en todos los caminos (éxito, tiempo agotado o error de arranque).
    await rm(tempDir, { recursive: true, force: true });
  }
}

/** Forma de {@link runProcess}, para que el ejecutor de lotes pueda recibir un doble en las pruebas. */
export type RunProcess = typeof runProcess;
