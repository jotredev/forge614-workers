/**
 * Pruebas de `runBatch` (`src/runner.ts`): qué eventos emite según cómo termina cada tarea, cómo clasifica los
 * rechazos de Engines, cuándo corta el lote por cuota y cómo confirma el bloqueo de solo lectura.
 * Todas usan dobles (versiones falsas de las dependencias que no lanzan procesos reales y registran lo que reciben).
 */
import { describe, test, expect } from "bun:test";
import { runBatch } from "./runner";
import type { TaskSpec, TaskEvent } from "./types";
import type { ResolveHeadlessOptions, ResolveHeadlessResult } from "./engines-client";
import type { RunProcessOptions, RunProcessResult } from "./process-runner";

/**
 * Arma una tarea válida de `claude-code` con valores fijos (id `t1`, prompt `hi`, límite de 60 s) para que cada
 * prueba cambie solo el campo que le interesa.
 *
 * @param overrides Campos de la tarea que sustituyen a los valores fijos; sin nada, se obtiene la tarea base.
 * @returns La tarea completa, lista para ponerla en la lista `tasks` de un lote.
 */
function makeTask(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: "t1",
    agentId: "claude-code",
    executable: "/bin/claude",
    prompt: "hi",
    model: undefined,
    reasoningLevel: null,
    timeoutMs: 60000,
    ...overrides,
  };
}

/** Agrupa las pruebas de `runBatch`: el ejecutor de lotes que emite un evento por cada resultado y cierra siempre con `run_completed`. */
describe("runBatch", () => {
  /**
   * Comprueba el camino feliz de una tarea: salen `task_started`, `task_completed` y `run_completed` en ese
   * orden, con 1 completada, 0 fallidas y 0 sin iniciar. Importa porque es la salida que Atlas espera de un lote sano.
   */
  test("emits task_started, task_completed, and run_completed for a successful task", async () => {
    const events: TaskEvent[] = [];
    let capturedArgs: string[] | undefined;
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/bin/claude", args: ["-p"], stdin: true },
      }),
      runProcess: async (options: RunProcessOptions): Promise<RunProcessResult> => {
        capturedArgs = options.args;
        return {
          ok: true,
          exitCode: 0,
          durationMs: 10,
          stdout: { text: "ok", bytes: 2, truncated: false },
          stderr: { text: "", bytes: 0, truncated: false },
        };
      },
    };

    const result = await runBatch(
      { enginesBin: "/bin/engines", maxOutputBytes: 1024, tasks: [makeTask()] },
      (e) => events.push(e),
      deps
    );

    expect(result.pausedByQuota).toBe(false);
    expect(events.map((e) => e.event)).toEqual(["task_started", "task_completed", "run_completed"]);
    const finalEvent = events[2];
    if (finalEvent.event === "run_completed") {
      expect(finalEvent).toMatchObject({ totalTasks: 1, completed: 1, failed: 0, notStarted: 0 });
    }
    // Deja fijo que el `extraArgs()` vacío de claude-code de verdad no agrega
    // nada a los argumentos del comando resuelto, y no solo que el
    // `extraArgs()` de codex agrega algo (eso se cubre por separado más abajo).
    expect(capturedArgs).toEqual(["-p"]);
  });

  /**
   * Prepara un stdout de 1500 emojis más «usage limit» con agente codex y salida 0, y espera `task_completed`
   * sin pausa por cuota. Ojo: con salida 0 la detección de cuota no corre, así que esta prueba no distingue
   * el corte por bytes del corte por caracteres (ver el comentario de dentro, que describe la intención original).
   */
  test("byte-slices the quota-detection stdout prefix instead of char-slicing", async () => {
    // "🎉" (U+1F389) ocupa 4 bytes en UTF-8 pero solo 2 unidades de código
    // UTF-16 (un par sustituto) en un texto de JS. 1500 de ellos son 6000
    // bytes UTF-8 reales pero solo 3000 unidades UTF-16: pasan de
    // QUOTA_STDOUT_PREFIX_BYTES (4096) en bytes, pero quedan bien dentro en
    // unidades de código. Poner el patrón de cuota justo después de este
    // relleno significa:
    //   - un prefijo correcto de 4096 bytes exactos se detiene en 1024
    //     emojis (1024 * 4 = 4096 bytes) y nunca llega al patrón.
    //   - un prefijo con el error `.slice(0, 4096)` (por unidades de código)
    //     incluiría los 3012 unidades completas y coincidiría con el patrón
    //     por equivocación.
    const filler = "\u{1F389}".repeat(1500);
    const stdout = filler + "usage limit";
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/bin/codex", args: ["-p"], stdin: true },
      }),
      runProcess: async (): Promise<RunProcessResult> => ({
        ok: true,
        exitCode: 0,
        durationMs: 10,
        stdout: { text: stdout, bytes: Buffer.byteLength(stdout, "utf8"), truncated: false },
        stderr: { text: "", bytes: 0, truncated: false },
      }),
    };

    const result = await runBatch(
      {
        enginesBin: "/bin/engines",
        maxOutputBytes: 1024 * 1024,
        tasks: [makeTask({ agentId: "codex", executable: "/bin/codex" })],
      },
      (e) => events.push(e),
      deps
    );

    expect(result.pausedByQuota).toBe(false);
    expect(events.map((e) => e.event)).toEqual(["task_started", "task_completed", "run_completed"]);
  });

  /**
   * Comprueba que un proceso que sale con 1 y escribe «boom» en stderr, sin ningún patrón de cuota, se informa
   * como `task_failed` con motivo `generic_error` y `exitCode: 1`. Importa para no confundir un fallo común con una cuota agotada.
   */
  test("marks a task as generic_error when the process exits non-zero without a quota match", async () => {
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/bin/claude", args: [], stdin: true },
      }),
      runProcess: async (): Promise<RunProcessResult> => ({
        ok: true,
        exitCode: 1,
        durationMs: 5,
        stdout: { text: "", bytes: 0, truncated: false },
        stderr: { text: "boom", bytes: 4, truncated: false },
      }),
    };

    await runBatch(
      { enginesBin: "/bin/engines", maxOutputBytes: 1024, tasks: [makeTask()] },
      (e) => events.push(e),
      deps
    );

    const failedEvent = events.find((e) => e.event === "task_failed");
    expect(failedEvent).toMatchObject({ reason: "generic_error", exitCode: 1 });
  });

  /**
   * Comprueba que si Engines rechaza con `REASONING_LEVEL_UNSUPPORTED` la tarea falla como `engine_unsupported`,
   * conserva el código en `stderr` y `runProcess` no se llama nunca. Importa porque nunca debe lanzarse un comando que Engines no pudo armar.
   */
  test("marks a task as engine_unsupported when Engines rejects it with HEADLESS_UNSUPPORTED/REASONING_LEVEL_UNSUPPORTED and never calls runProcess", async () => {
    const events: TaskEvent[] = [];
    let runProcessCalled = false;
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: false,
        code: "REASONING_LEVEL_UNSUPPORTED",
        message: "this agent cannot take a reasoning level",
      }),
      runProcess: async (): Promise<RunProcessResult> => {
        runProcessCalled = true;
        throw new Error("should not be called");
      },
    };

    await runBatch(
      { enginesBin: "/bin/engines", maxOutputBytes: 1024, tasks: [makeTask()] },
      (e) => events.push(e),
      deps
    );

    expect(runProcessCalled).toBe(false);
    const failedEvent = events.find((e) => e.event === "task_failed");
    expect(failedEvent).toMatchObject({ reason: "engine_unsupported" });
    if (failedEvent?.event === "task_failed") {
      expect(failedEvent.stderr).toContain("REASONING_LEVEL_UNSUPPORTED");
    }
  });

  /**
   * Comprueba que un rechazo con `ENGINES_RESPONSE_INVALID` (respuesta de Engines mal formada) se informa como
   * `generic_error` y no como `engine_unsupported`, con el código en `stderr`. Importa porque quien llama podría
   * dejar de usar para siempre una combinación válida si se la etiquetara como no soportada.
   */
  test("marks a task as generic_error (not engine_unsupported) when Engines rejects it with a non-unsupported code, preserving the code in stderr", async () => {
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: false,
        code: "ENGINES_RESPONSE_INVALID",
        message: "Failed to parse forge614-engines headless output as JSON",
      }),
      runProcess: async (): Promise<RunProcessResult> => {
        throw new Error("should not be called");
      },
    };

    await runBatch(
      { enginesBin: "/bin/engines", maxOutputBytes: 1024, tasks: [makeTask()] },
      (e) => events.push(e),
      deps
    );

    const failedEvent = events.find((e) => e.event === "task_failed");
    expect(failedEvent).toMatchObject({ reason: "generic_error" });
    if (failedEvent?.event === "task_failed") {
      expect(failedEvent.stderr).toContain("ENGINES_RESPONSE_INVALID");
    }
  });

  /**
   * Repite la misma comprobación con los dos errores de entrada de Engines (`INVALID_REASONING_LEVEL` y
   * `UNKNOWN_AGENT`): ambos van a `generic_error` con `exitCode: null`, `stderr` igual a «código: mensaje» y sin lanzar el proceso.
   * Importa porque nombrar algo que no existe no es una carencia de capacidad del asistente.
   */
  test.each([
    ["INVALID_REASONING_LEVEL", 'reasoning level "banana" is not valid for claude-code'],
    ["UNKNOWN_AGENT", "no agent named not-a-real-agent"],
  ])(
    "marks a task as generic_error (an input error, not a capability gap) when Engines rejects it with %s, keeping the code in stderr",
    async (code, message) => {
      const events: TaskEvent[] = [];
      let runProcessCalled = false;
      const deps = {
        resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
          ok: false,
          code,
          message,
        }),
        runProcess: async (): Promise<RunProcessResult> => {
          runProcessCalled = true;
          throw new Error("should not be called");
        },
      };

      await runBatch(
        { enginesBin: "/bin/engines", maxOutputBytes: 1024, tasks: [makeTask()] },
        (e) => events.push(e),
        deps
      );

      expect(runProcessCalled).toBe(false);
      const failedEvent = events.find((e) => e.event === "task_failed");
      expect(failedEvent).toMatchObject({
        reason: "generic_error",
        exitCode: null,
        stderr: `${code}: ${message}`,
      });
    }
  );

  /**
   * Con dos tareas cuyo proceso no se puede lanzar (`ENOENT`), comprueba que las dos terminan en `task_failed` y
   * que `run_completed` cuenta 2 fallidas, 0 completadas y 0 sin iniciar. Importa porque un error de lanzamiento no debe cortar el lote.
   */
  test("marks a task as spawn_error and continues with the next task", async () => {
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/does/not/exist", args: [], stdin: true },
      }),
      runProcess: async (): Promise<RunProcessResult> => ({
        ok: false,
        reason: "spawn_error",
        message: "ENOENT",
      }),
    };

    const result = await runBatch(
      {
        enginesBin: "/bin/engines",
        maxOutputBytes: 1024,
        tasks: [makeTask({ id: "t1" }), makeTask({ id: "t2" })],
      },
      (e) => events.push(e),
      deps
    );

    expect(result.pausedByQuota).toBe(false);
    expect(events.filter((e) => e.event === "task_failed")).toHaveLength(2);
    const runCompleted = events.find((e) => e.event === "run_completed");
    expect(runCompleted).toMatchObject({ totalTasks: 2, failed: 2, completed: 0, notStarted: 0 });
  });

  /**
   * Comprueba que una tarea que sale con 0 y cuyo texto contiene «Claude AI usage limit reached» termina como
   * `task_completed` y sin pausar el lote. Importa porque una revisión de código que solo habla de límites no es una cuota agotada.
   */
  test("does not treat a zero-exit task as quota_exhausted even if its output contains a quota pattern", async () => {
    // Reproduce el escenario de extremo a extremo del revisor: un agente
    // falso sale con 0 (éxito) mientras imprime un texto que casualmente
    // contiene un patrón de cuota real (por ejemplo, hablar de limitar
    // peticiones como parte de una revisión de código). La detección de
    // cuota solo debe correr con un código de salida distinto de cero.
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/bin/claude", args: [], stdin: true },
      }),
      runProcess: async (): Promise<RunProcessResult> => ({
        ok: true,
        exitCode: 0,
        durationMs: 5,
        stdout: {
          text: "Reviewing the code... note the API's rate limiting middleware. Claude AI usage limit reached in a comment example.",
          bytes: 200,
          truncated: false,
        },
        stderr: { text: "", bytes: 0, truncated: false },
      }),
    };

    const result = await runBatch(
      { enginesBin: "/bin/engines", maxOutputBytes: 1024, tasks: [makeTask()] },
      (e) => events.push(e),
      deps
    );

    expect(result.pausedByQuota).toBe(false);
    expect(events.map((e) => e.event)).toEqual(["task_started", "task_completed", "run_completed"]);
  });

  /**
   * Hace que `runProcess` lance un error en las dos tareas y comprueba que ambas salen como `generic_error` con el
   * mensaje en `stderr` y que `run_completed` se emite igual. Importa porque un fallo inesperado no debe saltarse el evento final.
   * (La función falsa es `async`, así que el error llega como promesa rechazada.)
   */
  test("marks a task as failed and continues the batch when runProcess throws synchronously", async () => {
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/bin/claude", args: [], stdin: true },
      }),
      runProcess: async (): Promise<RunProcessResult> => {
        throw new Error("boom: unexpected runProcess failure");
      },
    };

    const result = await runBatch(
      {
        enginesBin: "/bin/engines",
        maxOutputBytes: 1024,
        tasks: [makeTask({ id: "t1" }), makeTask({ id: "t2" })],
      },
      (e) => events.push(e),
      deps
    );

    expect(result.pausedByQuota).toBe(false);
    const failedEvents = events.filter((e) => e.event === "task_failed");
    expect(failedEvents).toHaveLength(2);
    for (const failedEvent of failedEvents) {
      expect(failedEvent).toMatchObject({ reason: "generic_error" });
      if (failedEvent.event === "task_failed") {
        expect(failedEvent.stderr).toContain("boom: unexpected runProcess failure");
      }
    }
    const runCompleted = events.find((e) => e.event === "run_completed");
    expect(runCompleted).toMatchObject({ totalTasks: 2, failed: 2, completed: 0, notStarted: 0 });
  });

  /**
   * Igual que la prueba anterior pero el error lo lanza `resolveHeadlessCommand`, antes de armar el comando:
   * las dos tareas fallan con `generic_error` y el lote llega a `run_completed`. Importa para cubrir el otro punto donde puede romperse una tarea.
   */
  test("marks a task as failed and continues the batch when resolveHeadlessCommand throws synchronously", async () => {
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => {
        throw new Error("boom: unexpected resolveHeadlessCommand failure");
      },
      runProcess: async (): Promise<RunProcessResult> => {
        throw new Error("should not be called");
      },
    };

    const result = await runBatch(
      {
        enginesBin: "/bin/engines",
        maxOutputBytes: 1024,
        tasks: [makeTask({ id: "t1" }), makeTask({ id: "t2" })],
      },
      (e) => events.push(e),
      deps
    );

    expect(result.pausedByQuota).toBe(false);
    const failedEvents = events.filter((e) => e.event === "task_failed");
    expect(failedEvents).toHaveLength(2);
    for (const failedEvent of failedEvents) {
      expect(failedEvent).toMatchObject({ reason: "generic_error" });
      if (failedEvent.event === "task_failed") {
        expect(failedEvent.stderr).toContain("boom: unexpected resolveHeadlessCommand failure");
      }
    }
    const runCompleted = events.find((e) => e.event === "run_completed");
    expect(runCompleted).toMatchObject({ totalTasks: 2, failed: 2, completed: 0, notStarted: 0 });
  });

  /**
   * Con dos tareas y un primer proceso que sale con 1 escribiendo «Claude AI usage limit reached», comprueba que
   * se emite `quota_exhausted`, la segunda tarea ni empieza y `run_completed` marca `notStarted: 1` y `pausedByQuota: true`.
   * Importa porque seguir lanzando tareas con la cuota agotada solo gastaría intentos.
   */
  test("stops the batch immediately on quota_exhausted and leaves later tasks not started", async () => {
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/bin/claude", args: [], stdin: true },
      }),
      runProcess: async (): Promise<RunProcessResult> => ({
        ok: true,
        exitCode: 1,
        durationMs: 5,
        stdout: { text: "", bytes: 0, truncated: false },
        stderr: { text: "Claude AI usage limit reached", bytes: 30, truncated: false },
      }),
    };

    const result = await runBatch(
      {
        enginesBin: "/bin/engines",
        maxOutputBytes: 1024,
        tasks: [makeTask({ id: "t1" }), makeTask({ id: "t2" })],
      },
      (e) => events.push(e),
      deps
    );

    expect(result.pausedByQuota).toBe(true);
    expect(events.map((e) => e.event)).toEqual(["task_started", "quota_exhausted", "run_completed"]);
    const runCompleted = events[2];
    if (runCompleted.event === "run_completed") {
      expect(runCompleted).toMatchObject({ notStarted: 1, pausedByQuota: true, completed: 0, failed: 0 });
    }
  });

  /**
   * Comprueba que el `readableDir` de la tarea (`/home/user/some-project`) llega tal cual a `resolveHeadlessCommand`.
   * Importa porque es la carpeta extra que se le deja leer al ayudante; si no llegara, el ayudante no vería el proyecto.
   */
  test("passes task.readableDir through to resolveHeadlessCommand", async () => {
    let capturedOptions: ResolveHeadlessOptions | undefined;
    const deps = {
      resolveHeadlessCommand: async (
        options: ResolveHeadlessOptions
      ): Promise<ResolveHeadlessResult> => {
        capturedOptions = options;
        return {
          ok: true,
          command: { command: "/bin/claude", args: ["-p"], stdin: true },
        };
      },
      runProcess: async (): Promise<RunProcessResult> => ({
        ok: true,
        exitCode: 0,
        durationMs: 10,
        stdout: { text: "ok", bytes: 2, truncated: false },
        stderr: { text: "", bytes: 0, truncated: false },
      }),
    };

    await runBatch(
      {
        enginesBin: "/bin/engines",
        maxOutputBytes: 1024,
        tasks: [makeTask({ readableDir: "/home/user/some-project" })],
      },
      () => {},
      deps
    );

    expect(capturedOptions?.readableDir).toBe("/home/user/some-project");
  });

  /** Agrupa las pruebas del bloqueo de solo lectura: cuándo se pregunta a Engines, cuándo se rechaza la tarea y qué lleva el comando que sí se lanza. */
  describe("read-only lock", () => {
    const REFUSAL =
      'READ_ONLY_UNSUPPORTED: Engines does not guarantee read-only execution for agent "claude-code"; the task was not run';

    /**
     * Arma dobles que registran cada llamada para poder probar lo que nunca ocurrió. El comando falso que arma
     * `resolveHeadlessCommand` antepone `--tools Read,Grep,Glob` solo cuando la tarea trae `readOnly`.
     *
     * @param lockCheck Respuesta falsa de Engines a la pregunta del bloqueo: recibe el asistente y devuelve `true`, `false` o lanza un error.
     * @returns `calls` (qué asistentes se consultaron, qué opciones llegaron a `resolveHeadlessCommand`, cuántos procesos se lanzaron y con qué argumentos) y `deps` (los dobles listos para pasar a `runBatch`).
     */
    function makeLockDeps(lockCheck: (agentId: string) => Promise<boolean>) {
      const calls = {
        lockChecks: [] as string[],
        resolves: [] as ResolveHeadlessOptions[],
        spawns: 0,
        spawnedArgs: [] as string[][],
      };
      const deps = {
        checkReadOnlySupport: async (_enginesBin: string, agentId: string): Promise<boolean> => {
          calls.lockChecks.push(agentId);
          return lockCheck(agentId);
        },
        resolveHeadlessCommand: async (options: ResolveHeadlessOptions): Promise<ResolveHeadlessResult> => {
          calls.resolves.push(options);
          const lock = options.readOnly ? ["--tools", "Read,Grep,Glob"] : [];
          return { ok: true, command: { command: "/bin/claude", args: [...lock, "-p"], stdin: true } };
        },
        runProcess: async (options: RunProcessOptions): Promise<RunProcessResult> => {
          calls.spawns++;
          calls.spawnedArgs.push(options.args);
          return {
            ok: true,
            exitCode: 0,
            durationMs: 1,
            stdout: { text: "ok", bytes: 2, truncated: false },
            stderr: { text: "", bytes: 0, truncated: false },
          };
        },
      };
      return { calls, deps };
    }

    /**
     * Con Engines respondiendo `false`, comprueba que la tarea `readOnly` falla como `engine_unsupported` con el
     * mensaje exacto de rechazo, sin pedir ningún comando ni lanzar el asistente. Importa porque sin el bloqueo el ayudante correría con acceso completo.
     */
    test("refuses a readOnly task when Engines does not guarantee the lock, asks for no command and never launches the agent", async () => {
      const events: TaskEvent[] = [];
      const { calls, deps } = makeLockDeps(async () => false);

      await runBatch(
        { enginesBin: "/bin/engines", maxOutputBytes: 1024, tasks: [makeTask({ readOnly: true })] },
        (e) => events.push(e),
        deps
      );

      expect(events.map((e) => e.event)).toEqual(["task_started", "task_failed", "run_completed"]);
      expect(events[1]).toMatchObject({
        event: "task_failed",
        reason: "engine_unsupported",
        exitCode: null,
        stderr: REFUSAL,
      });
      expect(calls.resolves).toHaveLength(0);
      expect(calls.spawns).toBe(0);
      expect(events[2]).toMatchObject({ totalTasks: 1, completed: 0, failed: 1, notStarted: 0 });
    });

    /**
     * Hace que la comprobación del bloqueo lance un error («engines crashed») y comprueba que se rechaza igual,
     * con el mismo mensaje y sin comando ni proceso. Importa porque un bloqueo que no se pudo confirmar cuenta como no garantizado.
     */
    test("refuses a readOnly task when the lock check itself fails with an error", async () => {
      const events: TaskEvent[] = [];
      const { calls, deps } = makeLockDeps(async () => {
        throw new Error("engines crashed");
      });

      await runBatch(
        { enginesBin: "/bin/engines", maxOutputBytes: 1024, tasks: [makeTask({ readOnly: true })] },
        (e) => events.push(e),
        deps
      );

      expect(events[1]).toMatchObject({
        event: "task_failed",
        reason: "engine_unsupported",
        stderr: REFUSAL,
      });
      expect(calls.resolves).toHaveLength(0);
      expect(calls.spawns).toBe(0);
    });

    /**
     * Con Engines respondiendo `true`, comprueba que la tarea se completa, que `resolveHeadlessCommand` recibe
     * `readOnly: true` y que el proceso se lanza con `--tools Read,Grep,Glob` antes de `-p`. Importa porque demuestra que el bloqueo llega al comando real.
     */
    test("runs a readOnly task when Engines guarantees the lock, and the command carries the lock", async () => {
      const events: TaskEvent[] = [];
      const { calls, deps } = makeLockDeps(async () => true);

      await runBatch(
        { enginesBin: "/bin/engines", maxOutputBytes: 1024, tasks: [makeTask({ readOnly: true })] },
        (e) => events.push(e),
        deps
      );

      expect(events.map((e) => e.event)).toEqual(["task_started", "task_completed", "run_completed"]);
      expect(calls.resolves.map((o) => o.readOnly)).toEqual([true]);
      expect(calls.spawnedArgs).toEqual([["--tools", "Read,Grep,Glob", "-p"]]);
    });

    /**
     * Con tres tareas `readOnly` (dos de `claude-code`, una de `codex`) y Engines respondiendo `false`, comprueba
     * que solo se pregunta una vez por asistente y que las tres se rechazan reutilizando el rechazo. Importa para no llamar a Engines una vez por tarea.
     */
    test("asks Engines about the lock once per agent for the whole batch and reuses a refusal", async () => {
      const events: TaskEvent[] = [];
      const { calls, deps } = makeLockDeps(async () => false);

      await runBatch(
        {
          enginesBin: "/bin/engines",
          maxOutputBytes: 1024,
          tasks: [
            makeTask({ id: "t1", readOnly: true }),
            makeTask({ id: "t2", readOnly: true }),
            makeTask({ id: "t3", agentId: "codex", executable: "/bin/codex", readOnly: true }),
          ],
        },
        (e) => events.push(e),
        deps
      );

      expect(calls.lockChecks).toEqual(["claude-code", "codex"]);
      expect(events.filter((e) => e.event === "task_failed")).toHaveLength(3);
      expect(calls.spawns).toBe(0);
    });

    /**
     * Es la misma regla de una sola pregunta por asistente, pero cuando Engines sí garantiza el bloqueo: dos
     * tareas `readOnly` de `claude-code` hacen 1 consulta y 2 lanzamientos. Importa porque la respuesta afirmativa también se recuerda.
     */
    test("asks only once for two readOnly tasks of the same agent that Engines does guarantee", async () => {
      const { calls, deps } = makeLockDeps(async () => true);

      await runBatch(
        {
          enginesBin: "/bin/engines",
          maxOutputBytes: 1024,
          tasks: [makeTask({ id: "t1", readOnly: true }), makeTask({ id: "t2", readOnly: true })],
        },
        () => {},
        deps
      );

      expect(calls.lockChecks).toEqual(["claude-code"]);
      expect(calls.spawns).toBe(2);
    });

    /**
     * Con `readOnly` ausente o en `false`, comprueba que nunca se consulta a Engines por el bloqueo, que las dos
     * tareas se lanzan y que `readOnly` llega sin cambios a `resolveHeadlessCommand`. Importa porque preguntar sería trabajo inútil.
     */
    test.each([[undefined], [false]])(
      "never asks Engines about the lock when readOnly is %p",
      async (readOnly) => {
        const { calls, deps } = makeLockDeps(async () => false);

        await runBatch(
          {
            enginesBin: "/bin/engines",
            maxOutputBytes: 1024,
            tasks: [makeTask({ id: "t1", readOnly }), makeTask({ id: "t2", readOnly })],
          },
          () => {},
          deps
        );

        expect(calls.lockChecks).toHaveLength(0);
        expect(calls.spawns).toBe(2);
        expect(calls.resolves.map((o) => o.readOnly)).toEqual([readOnly, readOnly]);
      }
    );

    /**
     * Con la comprobación de Engines en `true` pero `resolveHeadlessCommand` respondiendo `READ_ONLY_UNSUPPORTED`,
     * comprueba que la tarea falla como `engine_unsupported` con «código: mensaje» en `stderr` y sin lanzar procesos. Importa porque el rechazo de `headless` debe respetarse aunque la consulta previa haya dicho que sí.
     */
    test("marks a task as engine_unsupported when headless itself answers READ_ONLY_UNSUPPORTED", async () => {
      const events: TaskEvent[] = [];
      const { calls, deps } = makeLockDeps(async () => true);
      deps.resolveHeadlessCommand = async (): Promise<ResolveHeadlessResult> => ({
        ok: false,
        code: "READ_ONLY_UNSUPPORTED",
        message: "claude-code cannot guarantee read-only execution",
      });

      await runBatch(
        { enginesBin: "/bin/engines", maxOutputBytes: 1024, tasks: [makeTask({ readOnly: true })] },
        (e) => events.push(e),
        deps
      );

      expect(events[1]).toMatchObject({
        event: "task_failed",
        reason: "engine_unsupported",
        stderr: "READ_ONLY_UNSUPPORTED: claude-code cannot guarantee read-only execution",
      });
      expect(calls.spawns).toBe(0);
    });
  });

  /**
   * Usa el adaptador real de `codex` (no un doble) y comprueba que sus argumentos extra, `--skip-git-repo-check`,
   * se agregan al final de los del comando resuelto (`exec`). Importa porque sin esa bandera Codex se niega a correr en la carpeta temporal.
   */
  test("appends the real adapter's extraArgs to the resolved command's args", async () => {
    let capturedArgs: string[] | undefined;
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/bin/codex", args: ["exec"], stdin: true },
      }),
      runProcess: async (options: RunProcessOptions): Promise<RunProcessResult> => {
        capturedArgs = options.args;
        return {
          ok: true,
          exitCode: 0,
          durationMs: 5,
          stdout: { text: "ok", bytes: 2, truncated: false },
          stderr: { text: "", bytes: 0, truncated: false },
        };
      },
    };

    await runBatch(
      {
        enginesBin: "/bin/engines",
        maxOutputBytes: 1024,
        tasks: [makeTask({ agentId: "codex", executable: "/bin/codex" })],
      },
      () => {},
      deps
    );

    expect(capturedArgs).toEqual(["exec", "--skip-git-repo-check"]);
  });
});
