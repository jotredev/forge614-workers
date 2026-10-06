/** Pruebas del cliente de Engines contra el ejecutable real y contra programas falsos que simulan respuestas incompatibles o rotas. */
import { describe, test, expect, beforeAll } from "bun:test";
import { resolveHeadlessCommand, engineSupportsReadOnly } from "./engines-client";
import type { ReasoningLevel } from "./types";
import { resolveEnginesBinForTests } from "../test/support/resolve-engines-bin";

/** Agrupa la resolución `headless` (sin interfaz) y verifica los argumentos que Engines construye para cada opción. */
describe("resolveHeadlessCommand (against the real forge614-engines binary)", () => {
  // La ruta se resuelve en `beforeAll`, no al recolectar el archivo, para que un ejecutable ausente produzca un
  // fallo atribuido a esta suite y no un «error entre pruebas» que quite silenciosamente sus casos del conteo.
  let enginesBin: string;
  beforeAll(() => {
    enginesBin = resolveEnginesBinForTests();
  });

  /** Comprueba que el asistente admitido produce `/bin/claude -p` y declara stdin, la vía por la que recibirá el prompt. */
  test("resolves a supported agent to a runnable command with stdin delivery", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
    });

    expect(result).toEqual({
      ok: true,
      command: { command: "/bin/claude", args: ["-p"], stdin: true },
    });
  });

  /** Comprueba que el modelo `claude-haiku-4-5` se conserva como los argumentos `--model` del comando resuelto. */
  test("forwards --model", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
      model: "claude-haiku-4-5",
    });

    expect(result).toEqual({
      ok: true,
      command: { command: "/bin/claude", args: ["-p", "--model", "claude-haiku-4-5"], stdin: true },
    });
  });

  /** Comprueba que Engines traduce `readableDir` a `--add-dir /tmp/some-real-dir` para conceder esa carpeta al asistente. */
  test("forwards --readable-dir as --add-dir for claude-code", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
      readableDir: "/tmp/some-real-dir",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const addDirIndex = result.command.args.indexOf("--add-dir");
      expect(addDirIndex).toBeGreaterThanOrEqual(0);
      expect(result.command.args[addDirIndex + 1]).toBe("/tmp/some-real-dir");
    }
  });

  /** Comprueba el bloqueo exacto de solo lectura y su orden antes de `-p`, para que no quede sujeto a configuración interactiva. */
  test("forwards --read-only to claude-code as the exact read-only lock, before -p", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
      readOnly: true,
    });

    expect(result).toEqual({
      ok: true,
      command: {
        command: "/bin/claude",
        args: [
          "--tools",
          "Read,Grep,Glob",
          "--permission-mode",
          "dontAsk",
          "--strict-mcp-config",
          "-p",
        ],
        stdin: true,
      },
    });
  });

  /** Comprueba que el segundo adaptador recibe `exec`, el entorno `read-only` y la omisión de configuración del usuario. */
  test("forwards --read-only to codex as the exact read-only lock", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "codex",
      executable: "/bin/codex",
      prompt: "hello",
      readOnly: true,
    });

    expect(result).toEqual({
      ok: true,
      command: {
        command: "/bin/codex",
        args: ["exec", "--sandbox", "read-only", "--ignore-user-config"],
        stdin: true,
      },
    });
  });

  /** Comprueba que `readOnly: false` deja el comando base en `-p`, sin agregar por error restricciones no solicitadas. */
  test("does not add any lock when readOnly is false", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
      readOnly: false,
    });

    expect(result).toEqual({
      ok: true,
      command: { command: "/bin/claude", args: ["-p"], stdin: true },
    });
  });

  /** Comprueba que un identificador inexistente conserva el código `UNKNOWN_AGENT` que devuelve Engines. */
  test("reports UNKNOWN_AGENT for an agent id that Engines does not know", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "not-a-real-agent",
      executable: "/bin/not-a-real-agent",
      prompt: "hello",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNKNOWN_AGENT");
  });

  /** Comprueba que el nivel `high` llega al comando como `--effort high`, en vez de perderse durante la traducción. */
  test("resolves claude-code with a reasoning level and passes it as --effort", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
      reasoningLevel: "high",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const effortIndex = result.command.args.indexOf("--effort");
      expect(effortIndex).toBeGreaterThanOrEqual(0);
      expect(result.command.args[effortIndex + 1]).toBe("high");
    }
  });

  // En Engines 1.17.0 todos los asistentes aceptan los cinco niveles de Workers, por lo que no existe un nivel
  // válido para Workers pero inválido para un asistente. El rechazo de Engines se ejercita llamando al cliente
  // directamente con un nivel que `parseTask` ya habría rechazado.
  /** Comprueba que Engines rechaza `banana` con `INVALID_REASONING_LEVEL` y que el cliente conserva ese código. */
  test("reports INVALID_REASONING_LEVEL when Engines is given a level it does not know", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
      reasoningLevel: "banana" as ReasoningLevel,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_REASONING_LEVEL");
  });

  /** Comprueba con 1,100,000 caracteres que el prompt no entra en los argumentos y, por tanto, no supera `ARG_MAX`. */
  test("resolves successfully for a prompt far larger than the OS ARG_MAX, since the prompt is never passed as a CLI arg", async () => {
    // Regresión del fallo `E2BIG`: antes el prompt completo también iba como `--prompt <valor>` junto a
    // `--stdin-prompt`. Más de 1 MB supera `ARG_MAX` en algunos sistemas (hasta unos 128 KiB) y haría que el
    // lanzamiento fallara de forma síncrona. Se usa el ejecutable real porque se comprueba su manejo real de
    // `argv` (lista de argumentos), no el de un doble.
    const largePrompt = "x".repeat(1_100_000);

    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: largePrompt,
    });

    expect(result.ok).toBe(true);
  });

  /** Comprueba que una salida no JSON se convierte en `ENGINES_RESPONSE_INVALID`, sin lanzar ni perder el lote. */
  test("reports ENGINES_RESPONSE_INVALID instead of throwing when the binary prints non-JSON stdout", async () => {
    const fakeBin = new URL(
      "../test/fixtures/fake-engines-invalid-json.sh",
      import.meta.url
    ).pathname;

    const result = await resolveHeadlessCommand({
      enginesBin: fakeBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ENGINES_RESPONSE_INVALID");
  });
});

/** Agrupa la comprobación conservadora de solo lectura: solo una garantía explícita puede devolver `true`. */
describe("engineSupportsReadOnly", () => {
  // Convierte el nombre de un programa falso de `test/fixtures` en su ruta absoluta para cada escenario.
  const fixture = (name: string) => new URL(`../test/fixtures/${name}`, import.meta.url).pathname;

  /** Comprueba contra Engines real que los dos asistentes registrados declaran soporte de solo lectura. */
  test.each(["claude-code", "codex"])(
    "returns true for %s against the real forge614-engines binary",
    async (agentId) => {
      expect(await engineSupportsReadOnly(resolveEnginesBinForTests(), agentId)).toBe(true);
    }
  );

  /** Comprueba que un asistente desconocido no se toma como seguro: la consulta devuelve `false`. */
  test("returns false for an agent id that Engines does not know", async () => {
    expect(await engineSupportsReadOnly(resolveEnginesBinForTests(), "not-a-real-agent")).toBe(
      false
    );
  });

  /** Comprueba que una respuesta anterior a 1.17.0, sin `supportsReadOnly`, se trata como garantía ausente. */
  test("returns false when capabilities has no supportsReadOnly field (an Engines older than 1.17.0)", async () => {
    expect(
      await engineSupportsReadOnly(fixture("fake-engines-capabilities-no-read-only.js"), "claude-code")
    ).toBe(false);
  });

  /** Comprueba que `supportsReadOnly: false` se conserva como rechazo y nunca se eleva a una garantía. */
  test("returns false when capabilities says supportsReadOnly is false", async () => {
    expect(
      await engineSupportsReadOnly(
        fixture("fake-engines-capabilities-read-only-false.js"),
        "claude-code"
      )
    ).toBe(false);
  });

  /** Comprueba que una salida ilegible de capacidades produce `false`, de modo que un bloqueo dudoso no se use. */
  test("returns false instead of throwing when the binary prints non-JSON stdout", async () => {
    expect(
      await engineSupportsReadOnly(fixture("fake-engines-invalid-json.sh"), "claude-code")
    ).toBe(false);
  });

  /** Comprueba que un ejecutable inexistente tampoco lanza y responde `false`, impidiendo iniciar la tarea sin confirmación. */
  test("returns false instead of throwing when the binary cannot be launched", async () => {
    expect(await engineSupportsReadOnly("/definitely/does/not/exist", "claude-code")).toBe(false);
  });
});
