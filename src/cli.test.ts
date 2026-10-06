/**
 * Pruebas de `runCli` (`src/cli.ts`): los códigos de salida y los eventos `fatal_error` ante una entrada rota,
 * un Engines que no existe y un fallo inesperado, y la corrida mínima sin tareas.
 */
import { describe, test, expect } from "bun:test";
import { runCli } from "./cli";

/** Agrupa las pruebas de `runCli`, que valida la entrada, corre el lote y devuelve el código de salida del proceso. */
describe("runCli", () => {
  /**
   * Manda `{not json` (JSON roto) y comprueba que sale con código 2 y que la primera línea escrita es un
   * `fatal_error` con motivo `invalid_input`. Importa porque quien lanza Workers debe poder distinguir una entrada mal armada de un fallo de ejecución.
   */
  test("returns exit code 2 and a fatal_error event on malformed JSON", async () => {
    const lines: string[] = [];
    const { exitCode } = await runCli("{not json", (l) => lines.push(l));

    expect(exitCode).toBe(2);
    expect(JSON.parse(lines[0])).toMatchObject({ event: "fatal_error", reason: "invalid_input" });
  });

  /**
   * Con un `enginesBin` que apunta a una ruta inexistente (`/definitely/does/not/exist`) y sin tareas, comprueba
   * código 2 y un `fatal_error` con motivo `engines_bin_not_found`. Importa porque sin Engines ninguna tarea podría armar su comando.
   */
  test("returns exit code 2 and a fatal_error event when enginesBin does not exist", async () => {
    const lines: string[] = [];
    const input = JSON.stringify({ enginesBin: "/definitely/does/not/exist", tasks: [] });
    const { exitCode } = await runCli(input, (l) => lines.push(l));

    expect(exitCode).toBe(2);
    expect(JSON.parse(lines[0])).toMatchObject({
      event: "fatal_error",
      reason: "engines_bin_not_found",
    });
  });

  /**
   * Con una lista de tareas vacía y un `enginesBin` ejecutable de verdad, comprueba código 0 y que la última
   * línea es `run_completed` con `totalTasks: 0` y `pausedByQuota: false`. Importa porque un lote vacío es válido y debe cerrarse limpio.
   */
  test("returns exit code 0 for an empty task list against a real executable enginesBin", async () => {
    const lines: string[] = [];
    // process.execPath siempre es un archivo real y ejecutable: aquí se usa solo
    // para pasar la comprobación de que enginesBin existe y es ejecutable; nunca
    // se invoca porque no hay tareas que correr.
    const input = JSON.stringify({ enginesBin: process.execPath, tasks: [] });
    const { exitCode } = await runCli(input, (l) => lines.push(l));

    expect(exitCode).toBe(0);
    const finalEvent = JSON.parse(lines[lines.length - 1]);
    expect(finalEvent).toMatchObject({ event: "run_completed", totalTasks: 0, pausedByQuota: false });
  });

  /**
   * Hace que `writeLine` lance un error justo al recibir `task_started` y comprueba que `runCli` no lo deja
   * escapar: sale con código 1 y la última línea es un `fatal_error` con motivo `unexpected_error`. Importa porque es la defensa de último recurso para que quien lanza Workers reciba siempre una señal final.
   */
  test("wraps a truly unexpected throw out of runBatch and still emits a terminal fatal_error event", async () => {
    // runBatch tiene su propia frontera de errores por tarea (ver
    // runner.test.ts), así que esta prueba ejercita la frontera exterior y
    // defensiva del propio runCli: una excepción que se escapa de runBatch
    // por completo (aquí, simulado con un writeLine que lanza en el primerísimo
    // evento que emite runBatch, antes de que se llame a resolveHeadlessCommand)
    // debe producir igualmente una señal final y no una excepción sin atender.
    const lines: string[] = [];
    // writeLine falso: lee cada línea como JSON, lanza un error si es el evento task_started (el primero que
    // emite runBatch) y guarda cualquier otra, incluida la del fatal_error que escribe runCli después.
    const writeLine = (line: string) => {
      const parsed = JSON.parse(line);
      if (parsed.event === "task_started") {
        throw new Error("boom: simulated writeLine failure");
      }
      lines.push(line);
    };
    // process.execPath es un archivo ejecutable real, usado solo para pasar la
    // comprobación de que enginesBin existe; nunca se invoca porque writeLine
    // lanza antes de que se llamara a resolveHeadlessCommand.
    const input = JSON.stringify({
      enginesBin: process.execPath,
      tasks: [{ id: "t1", agentId: "claude-code", executable: "/bin/claude", prompt: "hi" }],
    });

    const { exitCode } = await runCli(input, writeLine);

    expect(exitCode).toBe(1);
    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.parse(lines[lines.length - 1])).toMatchObject({
      event: "fatal_error",
      reason: "unexpected_error",
    });
  });
});
