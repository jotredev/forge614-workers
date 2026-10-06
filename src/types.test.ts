/** Pruebas de la validación de entrada: valores predeterminados, campos opcionales y rechazos antes de ejecutar un lote. */
import { describe, test, expect } from "bun:test";
import {
  parseRunInput,
  InvalidInputError,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TASK_TIMEOUT_MS,
} from "./types";

/** Agrupa los contratos de `parseRunInput`, desde el documento mínimo hasta cada forma inválida comprobada. */
describe("parseRunInput", () => {
  /** Comprueba que la entrada mínima conserva sus textos y recibe `maxOutputBytes` y `timeoutMs` predeterminados, `reasoningLevel: null` y `readableDir` y `model` sin valor. */
  test("parses a minimal valid input and applies defaults", () => {
    const input = parseRunInput(
      JSON.stringify({
        enginesBin: "/bin/forge614-engines",
        tasks: [{ id: "t1", agentId: "claude-code", executable: "/bin/claude", prompt: "hi" }],
      })
    );

    expect(input.enginesBin).toBe("/bin/forge614-engines");
    expect(input.maxOutputBytes).toBe(DEFAULT_MAX_OUTPUT_BYTES);
    expect(input.tasks).toEqual([
      {
        id: "t1",
        agentId: "claude-code",
        executable: "/bin/claude",
        prompt: "hi",
        readableDir: undefined,
        model: undefined,
        reasoningLevel: null,
        timeoutMs: DEFAULT_TASK_TIMEOUT_MS,
      },
    ]);
  });

  /** Comprueba que un tope de 2048 bytes y los valores de modelo, nivel y 5000 ms prevalecen sobre los predeterminados. */
  test("honors explicit maxOutputBytes and per-task overrides", () => {
    const input = parseRunInput(
      JSON.stringify({
        enginesBin: "/bin/forge614-engines",
        maxOutputBytes: 2048,
        tasks: [
          {
            id: "t1",
            agentId: "codex",
            executable: "/bin/codex",
            prompt: "hi",
            model: "gpt-5-codex",
            reasoningLevel: "high",
            timeoutMs: 5000,
          },
        ],
      })
    );

    expect(input.maxOutputBytes).toBe(2048);
    expect(input.tasks[0]).toEqual({
      id: "t1",
      agentId: "codex",
      executable: "/bin/codex",
      prompt: "hi",
      readableDir: undefined,
      model: "gpt-5-codex",
      reasoningLevel: "high",
      timeoutMs: 5000,
    });
  });

  /** Comprueba que `/home/user/some-project` llega sin cambios a `readableDir`, para no alterar la carpeta que se concede a la tarea. */
  test("parses readableDir through unchanged when a task specifies it", () => {
    const input = parseRunInput(
      JSON.stringify({
        enginesBin: "/bin/forge614-engines",
        tasks: [
          {
            id: "t1",
            agentId: "claude-code",
            executable: "/bin/claude",
            prompt: "hi",
            readableDir: "/home/user/some-project",
          },
        ],
      })
    );

    expect(input.tasks[0]).toEqual({
      id: "t1",
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hi",
      readableDir: "/home/user/some-project",
      model: undefined,
      reasoningLevel: null,
      timeoutMs: DEFAULT_TASK_TIMEOUT_MS,
    });
  });

  /** Comprueba que el texto `{not json` produce `InvalidInputError`, en vez de dejar escapar el error nativo del analizador JSON. */
  test("throws InvalidInputError on malformed JSON", () => {
    expect(() => parseRunInput("{not json")).toThrow(InvalidInputError);
  });

  /** Comprueba que una entrada con `tasks` pero sin `enginesBin` se rechaza antes de intentar resolver comandos. */
  test("throws InvalidInputError when enginesBin is missing", () => {
    expect(() => parseRunInput(JSON.stringify({ tasks: [] }))).toThrow(InvalidInputError);
  });

  /** Comprueba que una entrada con Engines pero sin la lista `tasks` produce `InvalidInputError`. */
  test("throws InvalidInputError when tasks is missing", () => {
    expect(() =>
      parseRunInput(JSON.stringify({ enginesBin: "/bin/forge614-engines" }))
    ).toThrow(InvalidInputError);
  });

  /** Comprueba que una tarea sin `prompt`, uno de sus textos obligatorios, invalida el documento completo. */
  test("throws InvalidInputError when a task is missing a required field", () => {
    expect(() =>
      parseRunInput(
        JSON.stringify({
          enginesBin: "/bin/forge614-engines",
          tasks: [{ id: "t1", agentId: "claude-code", executable: "/bin/claude" }],
        })
      )
    ).toThrow(InvalidInputError);
  });

  /** Comprueba uno por uno que los cinco niveles admitidos se conservan exactamente para que Engines reciba el solicitado. */
  test.each(["low", "medium", "high", "xhigh", "max"] as const)(
    "accepts the Engines reasoning level %s unchanged",
    (level) => {
      const input = parseRunInput(
        JSON.stringify({
          enginesBin: "/bin/forge614-engines",
          tasks: [
            {
              id: "t1",
              agentId: "claude-code",
              executable: "/bin/claude",
              prompt: "hi",
              reasoningLevel: level,
            },
          ],
        })
      );

      expect(input.tasks[0].reasoningLevel).toBe(level);
    }
  );

  /** Comprueba que `readOnly` conserva `true` y `false`, y queda ausente cuando no se proporciona. */
  test.each([
    [true, true],
    [false, false],
    [undefined, undefined],
  ])("parses readOnly %p into %p", (given, expected) => {
    const input = parseRunInput(
      JSON.stringify({
        enginesBin: "/bin/forge614-engines",
        tasks: [
          {
            id: "t1",
            agentId: "claude-code",
            executable: "/bin/claude",
            prompt: "hi",
            readOnly: given,
          },
        ],
      })
    );

    expect(input.tasks[0].readOnly).toBe(expected);
  });

  /** Comprueba que texto, números, `null` y objeto no puedan sustituir al booleano de solo lectura y perder el bloqueo. */
  test.each([["yes"], [1], [0], [null], [{}]])(
    "throws InvalidInputError when readOnly is %p instead of true, false or absent",
    (given) => {
      expect(() =>
        parseRunInput(
          JSON.stringify({
            enginesBin: "/bin/forge614-engines",
            tasks: [
              {
                id: "t1",
                agentId: "claude-code",
                executable: "/bin/claude",
                prompt: "hi",
                readOnly: given,
              },
            ],
          })
        )
      ).toThrow(InvalidInputError);
    }
  );

  /** Comprueba que los textos plausibles pero no enumerados `minimal` y `banana` se rechazan como niveles desconocidos. */
  test.each(["minimal", "banana"])(
    "throws InvalidInputError when reasoningLevel is the unlisted text %s",
    (level) => {
      expect(() =>
        parseRunInput(
          JSON.stringify({
            enginesBin: "/bin/forge614-engines",
            tasks: [
              {
                id: "t1",
                agentId: "claude-code",
                executable: "/bin/claude",
                prompt: "hi",
                reasoningLevel: level,
              },
            ],
          })
        )
      ).toThrow(InvalidInputError);
    }
  );

  /** Comprueba que el texto `invalid` también lanza `InvalidInputError` como nivel de razonamiento; repite con otro valor la comprobación de `minimal` y `banana`. */
  test("throws InvalidInputError when reasoningLevel is an invalid value", () => {
    expect(() =>
      parseRunInput(
        JSON.stringify({
          enginesBin: "/bin/forge614-engines",
          tasks: [
            {
              id: "t1",
              agentId: "claude-code",
              executable: "/bin/claude",
              prompt: "hi",
              reasoningLevel: "invalid",
            },
          ],
        })
      )
    ).toThrow(InvalidInputError);
  });
});
