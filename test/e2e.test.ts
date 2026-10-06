/**
 * Pruebas de punta a punta (end-to-end, e2e: arrancan el programa completo, no una función suelta): lanzan el
 * `src/main.ts` real como proceso aparte y comprueban lo que imprime en stdout (salida estándar) y su código de
 * salida. Cubren `--version`, `--help`, el comando `update` y la corrida de un lote con programas falsos de `test/fixtures`.
 */
import { describe, test, expect } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json";

const MAIN_ENTRY = join(import.meta.dir, "..", "src", "main.ts");
const FIXTURES = join(import.meta.dir, "fixtures");

/**
 * Lanza `src/main.ts` sin argumentos, le escribe el documento del lote por stdin (entrada estándar) y espera a
 * que termine; el stderr se pide como tubería pero no se lee.
 *
 * @param input Texto que se escribe completo en el stdin del programa; normalmente el JSON del lote.
 * @returns Todo el stdout que imprimió y su código de salida.
 */
async function runWorkers(input: string): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", MAIN_ENTRY], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  // Se escribe el lote y se cierra stdin: sin el cierre, el programa seguiría esperando más entrada.
  proc.stdin.write(input);
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

/**
 * Lanza `src/main.ts` con argumentos de línea de comandos y deja stdin abierto sin escribirle nada, como haría una
 * terminal. Un proceso que se queda esperando entrada se mata pasado `hangAfterMs` y se informa como colgado
 * (`hung`), de modo que una regresión haga fallar la prueba en vez de congelar toda la suite.
 *
 * @param args Argumentos que siguen al script, por ejemplo `["--version"]`.
 * @param hangAfterMs Milisegundos que se espera antes de dar el proceso por colgado y matarlo; 3000 por defecto.
 * @returns El stdout, el código de salida (`null` si hubo que matarlo) y si quedó colgado.
 */
async function runWorkersWithArgs(
  args: string[],
  hangAfterMs = 3000
): Promise<{ stdout: string; exitCode: number | null; hung: boolean }> {
  const proc = Bun.spawn(["bun", MAIN_ENTRY, ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  // El temporizador mata el proceso si sigue vivo pasado el tiempo; al morir, la lectura de stdout de abajo termina.
  let hung = false;
  const timer = setTimeout(() => {
    hung = true;
    proc.kill();
  }, hangAfterMs);
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  clearTimeout(timer);
  // Un proceso matado por el temporizador no tiene un código de salida que valga, por eso se informa `null`.
  return { stdout, exitCode: hung ? null : exitCode, hung };
}

/**
 * Agrupa las pruebas de los argumentos `--version`/`-v` y `--help`/`-h`, que deben contestarse sin esperar a stdin,
 * y la de un argumento desconocido, que no tiene trato especial.
 */
describe("forge614-workers --version and --help", () => {
  /**
   * Comprueba, con `--version` y `-v`, que el programa imprime exactamente `forge614-workers <versión de package.json>`,
   * sale con 0 y no se cuelga con stdin abierto. Importa porque `update` lee la versión instalada de esta salida (`readInstalledVersion` en `src/updater.ts`).
   */
  test.each(["--version", "-v"])("%s prints the name and version and exits 0 without waiting for stdin", async (flag) => {
    const { stdout, exitCode, hung } = await runWorkersWithArgs([flag]);

    expect(hung).toBe(false);
    expect(exitCode).toBe(0);
    expect(stdout).toBe(`forge614-workers ${pkg.version}\n`);
  });

  /**
   * Comprueba, con `--help` y `-h`, que la ayuda sale con 0 sin esperar a stdin y menciona `forge614-workers`, `stdin`,
   * `--version` y `--help`. Importa porque pedir ayuda no debe esperar a un lote que nunca va a llegar.
   */
  test.each(["--help", "-h"])("%s prints help that names --version and exits 0 without waiting for stdin", async (flag) => {
    const { stdout, exitCode, hung } = await runWorkersWithArgs([flag]);

    expect(hung).toBe(false);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("forge614-workers");
    expect(stdout).toContain("stdin");
    expect(stdout).toContain("--version");
    expect(stdout).toContain("--help");
  });

  /**
   * Comprueba que un argumento desconocido (`--something-else`) no se trata como bandera: el programa sigue leyendo
   * el lote de stdin y, con el texto roto `{not json`, sale con 2 y emite `fatal_error` con `invalid_input`.
   * Importa porque solo `--version`, `-v`, `--help`, `-h` y `update` (como primer argumento) son especiales; cualquier otro caso sigue siendo una corrida.
   */
  test("any other argument still waits for the batch on stdin, as before", async () => {
    const proc = Bun.spawn(["bun", MAIN_ENTRY, "--something-else"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write("{not json");
    proc.stdin.end();
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(2);
    expect(JSON.parse(stdout.trim())).toMatchObject({ event: "fatal_error", reason: "invalid_input" });
  });
});

/**
 * Lanza el `src/main.ts update` real con un `fetch` falso (véase `test/support/fake-update-preload.ts`) y una
 * carpeta `FORGE614_HOME` temporal que contiene un comando instalado falso, dejando stdin abierto y sin escribir
 * como haría una terminal. Un proceso que espera stdin se mata pasado `hangAfterMs` y se informa como colgado.
 * La carpeta temporal se borra siempre al terminar.
 *
 * @param args Argumentos que siguen a `update`; ninguno por defecto.
 * @param hangAfterMs Milisegundos que se espera antes de dar el proceso por colgado y matarlo; 5000 por defecto.
 * @returns El stdout, el stderr, el código de salida (`null` si hubo que matarlo), si quedó colgado y el contenido del archivo donde el `fetch` falso y el instalador falso anotaron sus llamadas.
 */
async function runUpdateWithFakeInstaller(
  args: string[] = [],
  hangAfterMs = 5000
): Promise<{ stdout: string; stderr: string; exitCode: number | null; hung: boolean; calls: string }> {
  const home = mkdtempSync(join(tmpdir(), "forge614-workers-update-e2e-"));
  try {
    // El comando «instalado» es un script que dice ser la versión 9.9.9, distinta de la de `package.json`, para que `update` informe un cambio.
    const installed = join(home, "workers", "bin", "forge614-workers");
    mkdirSync(join(home, "workers", "bin"), { recursive: true });
    writeFileSync(installed, "#!/usr/bin/env bash\necho 'forge614-workers 9.9.9'\n");
    chmodSync(installed, 0o755);
    // El archivo marcador empieza vacío: lo que aparezca en él lo anotó el `fetch` falso o el instalador falso.
    const marker = join(home, "calls.log");
    writeFileSync(marker, "");

    // `--preload` carga el `fetch` falso antes que `main.ts`; `FORGE614_HOME` apunta a la carpeta temporal para no tocar la instalación real.
    const proc = Bun.spawn(["bun", "--preload", join(import.meta.dir, "support", "fake-update-preload.ts"), MAIN_ENTRY, "update", ...args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, FORGE614_HOME: home, FAKE_UPDATE_MARKER: marker },
    });
    let hung = false;
    const timer = setTimeout(() => {
      hung = true;
      proc.kill();
    }, hangAfterMs);
    // stdout y stderr se leen a la vez para que ninguna de las dos tuberías se llene y bloquee al proceso.
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const exitCode = await proc.exited;
    clearTimeout(timer);
    return { stdout, stderr, exitCode: hung ? null : exitCode, hung, calls: readFileSync(marker, "utf8") };
  } finally {
    // La carpeta temporal se borra en todos los caminos, también si la prueba falla.
    rmSync(home, { recursive: true, force: true });
  }
}

/** Agrupa las pruebas del comando `update` de punta a punta, con descarga e instalador falsos. */
describe("forge614-workers update", () => {
  /**
   * Comprueba que `update` pide la dirección del último instalador, lo ejecuta con `--force`, termina con 0 sin leer
   * stdin e imprime `updated from <versión> to 9.9.9.`. Importa porque es el flujo completo que usa quien se actualiza.
   */
  test("is answered without reading stdin: downloads the latest installer and runs it with --force", async () => {
    const { stdout, exitCode, hung, calls } = await runUpdateWithFakeInstaller();

    expect(hung).toBe(false);
    expect(exitCode).toBe(0);
    expect(calls).toContain("fetch https://github.com/jotredev/forge614-workers/releases/latest/download/install.sh");
    expect(calls).toContain("installer --force");
    expect(stdout).toBe(`forge614-workers updated from ${pkg.version} to 9.9.9.\n`);
  });

  /**
   * Comprueba que `update --force` sale con 2, imprime `update takes no arguments` en stderr y deja el archivo de
   * llamadas vacío. Importa porque un argumento de más debe rechazarse antes de descargar nada.
   */
  test("refuses extra arguments with exit 2 and does not download anything", async () => {
    const { stderr, exitCode, hung, calls } = await runUpdateWithFakeInstaller(["--force"]);

    expect(hung).toBe(false);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("update takes no arguments");
    expect(calls).toBe("");
  });

  /**
   * Comprueba que `--help` menciona `forge614-workers update`. Importa porque la ayuda es donde el programa anuncia
   * sus comandos, y un comando que falta ahí no se descubre.
   */
  test("--help names the update command", async () => {
    const { stdout, exitCode } = await runWorkersWithArgs(["--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("forge614-workers update");
  });
});

/** Agrupa las pruebas que corren un lote completo con `fake-engines-headless.js` y los asistentes falsos, y las entradas que lo rechazan. */
describe("forge614-workers end-to-end", () => {
  /**
   * Comprueba que una tarea con `fake-agent-echo.js` termina con 0, emite `task_started`, `task_completed` y
   * `run_completed` en ese orden, y que el stdout de la tarea es `echoed: hello`. Importa porque es el camino feliz de punta a punta.
   */
  test("runs a successful task against a fake engines binary and a fake agent, exit 0", async () => {
    const input = JSON.stringify({
      enginesBin: join(FIXTURES, "fake-engines-headless.js"),
      tasks: [
        {
          id: "t1",
          agentId: "claude-code",
          executable: join(FIXTURES, "fake-agent-echo.js"),
          prompt: "hello",
        },
      ],
    });

    const { stdout, exitCode } = await runWorkers(input);
    // La salida es una línea JSON por evento; se convierte cada línea en objeto para mirar el orden de los eventos.
    const lines = stdout.trim().split("\n").map((l) => JSON.parse(l));

    expect(exitCode).toBe(0);
    expect(lines.map((l) => l.event)).toEqual(["task_started", "task_completed", "run_completed"]);
    expect(lines[1].stdout).toBe("echoed: hello");
  });

  /**
   * Comprueba que una tarea con `fake-agent-quota.js` (sale con 1 y escribe el texto de cuota agotada) produce
   * `task_started`, `quota_exhausted` y `run_completed` y el código de salida 75. Importa porque 75 es el código con el
   * que `runCli` avisa a quien lo llama que el lote se detuvo por cuota agotada.
   */
  test("stops with exit 75 when the fake agent reports quota exhaustion", async () => {
    const input = JSON.stringify({
      enginesBin: join(FIXTURES, "fake-engines-headless.js"),
      tasks: [
        {
          id: "t1",
          agentId: "claude-code",
          executable: join(FIXTURES, "fake-agent-quota.js"),
          prompt: "hello",
        },
      ],
    });

    const { stdout, exitCode } = await runWorkers(input);
    const lines = stdout.trim().split("\n").map((l) => JSON.parse(l));

    expect(exitCode).toBe(75);
    expect(lines.map((l) => l.event)).toEqual(["task_started", "quota_exhausted", "run_completed"]);
  });

  /**
   * Comprueba que el texto roto `{not json` sale con 2 y emite un solo evento `fatal_error` con `invalid_input`.
   * Importa porque una entrada inválida debe rechazarse entera antes de iniciar ninguna tarea.
   */
  test("reports fatal_error and exit 2 on malformed input JSON", async () => {
    const { stdout, exitCode } = await runWorkers("{not json");
    const parsed = JSON.parse(stdout.trim());

    expect(exitCode).toBe(2);
    expect(parsed).toMatchObject({ event: "fatal_error", reason: "invalid_input" });
  });

  /**
   * Comprueba que un `enginesBin` que no existe, aunque la lista de tareas esté vacía, sale con 2 y emite
   * `fatal_error` con `engines_bin_not_found`. Importa porque Workers revisa el ejecutable de Engines una sola vez antes del lote.
   */
  test("reports fatal_error and exit 2 when enginesBin does not exist", async () => {
    const input = JSON.stringify({ enginesBin: "/definitely/does/not/exist", tasks: [] });
    const { stdout, exitCode } = await runWorkers(input);
    const parsed = JSON.parse(stdout.trim());

    expect(exitCode).toBe(2);
    expect(parsed).toMatchObject({ event: "fatal_error", reason: "engines_bin_not_found" });
  });
});
