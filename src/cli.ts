/**
 * Orquestación de una corrida desde la línea de comandos: valida el documento JSON que llega por stdin (entrada
 * estándar), comprueba que Engines sea ejecutable, corre el lote con `runBatch` y escribe un evento JSON por línea.
 * Existe para separar «qué pasa con una corrida y con qué código de salida termina» de la lectura de stdin y del
 * `process.exit`, que viven en `src/main.ts` (único que importa `runCli`); lo prueba `src/cli.test.ts`.
 * Pieza principal: `runCli`.
 */
import { accessSync, constants } from "node:fs";
import { parseRunInput, type TaskEvent } from "./types";
import { runBatch } from "./runner";

/** Resultado de una corrida desde la línea de comandos. */
export interface CliResult {
  /** Código con el que debe terminar el proceso: 0 corrida normal, 1 error inesperado, 2 entrada inválida o Engines no ejecutable, 75 lote pausado por cuota. */
  exitCode: number;
}

/**
 * Ejecuta una corrida completa: valida la entrada, comprueba Engines, corre el lote y escribe cada evento como
 * una línea JSON. Cuando algo impide correr el lote, escribe un evento `fatal_error` con el motivo (`invalid_input`,
 * `engines_bin_not_found` o `unexpected_error`) y devuelve el código de salida que corresponde.
 *
 * @param stdinText Texto completo leído de stdin; debe ser el documento JSON del lote (`enginesBin`, `tasks` y opcionales).
 * @param writeLine Función que recibe cada línea de salida ya serializada (un objeto JSON por línea); `main.ts` pasa `console.log`.
 * @returns `{ exitCode }`: 2 si el JSON o sus campos no son válidos o `enginesBin` no es un archivo ejecutable, 75 si el lote se pausó por cuota agotada, 1 si algo inesperado se escapó de `runBatch`, y 0 en cualquier otro caso (también si hubo tareas fallidas, que se informan como eventos).
 */
export async function runCli(
  stdinText: string,
  writeLine: (line: string) => void
): Promise<CliResult> {
  // Primero se valida el documento de entrada; si no es válido, se informa y se termina antes de lanzar nada.
  let input;
  try {
    input = parseRunInput(stdinText);
  } catch (err) {
    writeLine(
      JSON.stringify({
        event: "fatal_error",
        reason: "invalid_input",
        message: (err as Error).message,
      })
    );
    return { exitCode: 2 };
  }

  // Engines debe existir y poder ejecutarse (permiso X_OK, de ejecución); se comprueba una sola vez para todo el lote.
  try {
    accessSync(input.enginesBin, constants.X_OK);
  } catch {
    writeLine(
      JSON.stringify({
        event: "fatal_error",
        reason: "engines_bin_not_found",
        message: `enginesBin is not an executable file: ${input.enginesBin}`,
      })
    );
    return { exitCode: 2 };
  }

  // Cada evento que emite el lote sale como una línea JSON.
  const onEvent = (event: TaskEvent) => writeLine(JSON.stringify(event));

  // runBatch tiene su propia frontera de errores por tarea, así que este
  // bloque solo se activa si algo falla fuera de ella (por ejemplo, un
  // lanzamiento de la contabilidad interna de runBatch, fuera del
  // try/catch por tarea, o de `writeLine` al emitir task_started o
  // run_completed). Aun así, quien llama debe recibir ALGUNA señal final y no
  // una excepción sin atender.
  try {
    const result = await runBatch(
      { enginesBin: input.enginesBin, maxOutputBytes: input.maxOutputBytes, tasks: input.tasks },
      onEvent
    );

    // 75 avisa a quien llama que el lote se detuvo por cuota agotada; cualquier otra corrida que llegó al final termina en 0, haya o no tareas fallidas.
    return { exitCode: result.pausedByQuota ? 75 : 0 };
  } catch (err) {
    writeLine(
      JSON.stringify({
        event: "fatal_error",
        reason: "unexpected_error",
        message: (err as Error).message ?? String(err),
      })
    );
    return { exitCode: 1 };
  }
}
