/**
 * Pruebas de `runProcess` (`src/process-runner.ts`) con procesos reales de `test/fixtures` (scripts pequeños que
 * imprimen su stdin, su carpeta, su entorno o se quedan colgados): stdin, salidas, carpeta temporal, entorno y tiempo límite.
 */
import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runProcess } from "./process-runner";
import { fixturePath } from "../test/support/fixture-path";

/** Agrupa las pruebas de `runProcess`, el lanzador de procesos hijo con carpeta temporal, tope de salida y tiempo límite. */
describe("runProcess", () => {
  /**
   * Lanza `echo-stdin.js` con el texto «hello world» en stdin y comprueba que su stdout es exactamente ese
   * texto y que el código de salida es 0. Importa porque es la vía por la que viaja el prompt de cada tarea.
   */
  test("runs a command, pipes stdin, and captures stdout", async () => {
    const result = await runProcess({
      command: process.execPath,
      args: [fixturePath("echo-stdin.js")],
      stdin: "hello world",
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stdout.text).toBe("hello world");
      expect(result.exitCode).toBe(0);
    }
  });

  /**
   * Lanza `print-cwd.js`, que imprime su carpeta de trabajo, y comprueba que la ruta impresa no es una cadena
   * vacía y que esa carpeta ya no existe cuando `runProcess` devuelve el resultado. Importa para no dejar carpetas temporales acumuladas.
   */
  test("cleans up the isolated temp working directory after the process exits", async () => {
    const result = await runProcess({
      command: process.execPath,
      args: [fixturePath("print-cwd.js")],
      stdin: "",
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const usedTempDir = result.stdout.text;
      expect(usedTempDir).not.toBe("");
      expect(existsSync(usedTempDir)).toBe(false);
    }
  });

  /**
   * Manda 2 millones de caracteres a `exit-immediately.js`, que termina sin leer su stdin, y comprueba que
   * `runProcess` igual devuelve `ok` con código 0. Importa porque un hijo que no lee su entrada es normal y no debe romper el lote.
   */
  test("resolves normally when the child exits without reading stdin", async () => {
    // exit-immediately.js termina antes de consumir su stdin. Escribir una
    // cadena grande en su tubería de stdin falla de forma fiable (EPIPE
    // (tubería rota), a menudo mediante una Promise rechazada de
    // FileSink#write) cuando el hijo ya la cerró; runProcess debe tragarse
    // eso y aun así resolver, en lugar de lanzar o rechazar con un error sin atender.
    const result = await runProcess({
      command: process.execPath,
      args: [fixturePath("exit-immediately.js")],
      stdin: "x".repeat(2_000_000),
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.exitCode).toBe(0);
    }
  });

  /**
   * Manda 5 millones de caracteres a `never-reads-stdin.js` (que duerme 60 s sin leer) con límite de 300 ms, y
   * comprueba que el resultado es `timeout` y llega en menos de 5 s. Importa porque la escritura de stdin no debe impedir que el tiempo límite se arme.
   */
  test("timeoutMs still engages when the child never reads a large stdin payload", async () => {
    // never-reads-stdin.js duerme 60 s sin leer nunca su stdin. Con una carga
    // lo bastante grande, el FileSink#write() de Bun devuelve una Promise que
    // sigue pendiente mientras el hijo esté vivo y sin leer (contrapresión de
    // la tubería del sistema), confirmado con un experimento directo en este
    // entorno de ejecución. Si runProcess esperara esa escritura antes de armar
    // sus temporizadores, timeoutMs nunca tendría ocasión de dispararse y esta
    // llamada se colgaría los 60 s completos. Comprobar que resuelve rápido,
    // con un resultado timeout, demuestra que la escritura va en segundo plano
    // y no bloquea el armado de los temporizadores.
    const startedAt = Date.now();
    const result = await runProcess({
      command: process.execPath,
      args: [fixturePath("never-reads-stdin.js")],
      stdin: "x".repeat(5_000_000),
      timeoutMs: 300,
      sigkillGraceMs: 200,
      maxOutputBytes: 1024,
    });
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(5_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("timeout");
    }
  }, 10_000);

  /**
   * Fija una variable con un valor único en `process.env`, lanza `print-env.js` (que imprime su entorno como JSON)
   * y comprueba que el hijo ve las mismas claves y valores que el padre, sin faltantes ni sobrantes. Importa porque el asistente necesita su HOME, su PATH y sus claves intactos.
   */
  test("inherits the parent process's environment completely untouched (no HOME override, no allowlisting)", async () => {
    // Una sola aserción `env.HOME === process.env.HOME` es demasiado débil para
    // probar «sin tocar»: seguiría pasando con una lista permitida filtrada
    // como `{ HOME: process.env.HOME }` (que descarta PATH, las claves de API
    // y todo lo demás) o con una regresión parcial que reintroduzca un
    // CODEX_HOME (que pasaría inadvertida si CODEX_HOME resulta no estar
    // definido en ambos casos). Se fija un marcador único que no podía estar ya
    // presente, y luego se compara cada clave de process.env con lo que observó el hijo.
    const markerKey = "FORGE614_ENV_INHERITANCE_MARKER";
    const markerValue = randomUUID();
    process.env[markerKey] = markerValue;
    try {
      const result = await runProcess({
        command: process.execPath,
        args: [fixturePath("print-env.js")],
        stdin: "",
        timeoutMs: 5000,
        maxOutputBytes: 1024 * 1024,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const env = JSON.parse(result.stdout.text);
        expect(env[markerKey]).toBe(markerValue);
        for (const [key, value] of Object.entries(process.env)) {
          expect(env[key]).toBe(value);
        }
        // El ciclo por clave de arriba solo prueba que las claves compartidas
        // coinciden: no atraparía una regresión aditiva (por ejemplo
        // reintroducir `env: { ...process.env, CODEX_HOME: tempDir }`), porque
        // una clave extra que tiene el hijo y no el padre nunca se recorre.
        // Se comprueba que los conjuntos de claves son exactamente iguales
        // (sin sobrantes ni omisiones).
        expect(Object.keys(env).sort()).toEqual(Object.keys(process.env).sort());
      }
    } finally {
      // Se quita el marcador para no dejar la variable puesta en las demás pruebas.
      delete process.env[markerKey];
    }
  });

  /**
   * Pide a `big-output.js` 1000 bytes con tope de 100 y comprueba que el texto guardado mide 100, que `bytes` informa
   * los 1000 reales y que `truncated` es `true`. Importa porque quien lee el evento debe saber que la salida quedó incompleta y de qué tamaño era.
   */
  test("truncates stdout at maxOutputBytes and reports the true observed size", async () => {
    const result = await runProcess({
      command: process.execPath,
      args: [fixturePath("big-output.js"), "1000"],
      stdin: "",
      timeoutMs: 5000,
      maxOutputBytes: 100,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stdout.text.length).toBe(100);
      expect(result.stdout.bytes).toBe(1000);
      expect(result.stdout.truncated).toBe(true);
    }
  });

  /**
   * Lanza `ignore-sigterm.js` (que ignora SIGTERM y no termina nunca) con límite de 50 ms y gracia de 50 ms, y
   * comprueba que el resultado es `timeout`. Importa porque demuestra que tras la gracia se usa SIGKILL; sin él la prueba se colgaría.
   */
  test("kills a process that ignores SIGTERM after the grace period", async () => {
    const result = await runProcess({
      command: process.execPath,
      args: [fixturePath("ignore-sigterm.js")],
      stdin: "",
      timeoutMs: 50,
      sigkillGraceMs: 50,
      maxOutputBytes: 1024,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("timeout");
  });

  /**
   * Pide ejecutar `/definitely/does/not/exist/binary` y comprueba que el resultado es `spawn_error` y no una
   * excepción. Importa porque una ruta de ejecutable equivocada debe convertirse en el evento de fallo de una tarea y no tumbar el lote.
   */
  test("reports spawn_error when the resolved executable does not exist", async () => {
    const result = await runProcess({
      command: "/definitely/does/not/exist/binary",
      args: [],
      stdin: "",
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("spawn_error");
  });
});
