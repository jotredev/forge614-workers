/** Comprueba `updateInstalledWorkers`, `installedWorkersCommand` y `runUpdateCommand` con dobles (versiones falsas de las dependencias): nunca se usa la red ni un instalador real. */
import { describe, expect, test } from "bun:test";
import { LATEST_INSTALLER_URL, installedWorkersCommand, runUpdateCommand, updateInstalledWorkers } from "./updater";

/**
 * Ejecuta `run` con `FORGE614_HOME` fijada (o quitada) y restaura después el valor anterior, aunque `run` lance un error.
 *
 * @param value Valor que toma `FORGE614_HOME` mientras corre `run`; `undefined` la elimina del entorno.
 * @param run Comprobación que se ejecuta con ese valor puesto.
 */
function withForge614Home(value: string | undefined, run: () => void): void {
  const previous = process.env.FORGE614_HOME;
  try {
    if (value === undefined) delete process.env.FORGE614_HOME;
    else process.env.FORGE614_HOME = value;
    run();
  } finally {
    // Se restaura el valor original: si no estaba definida se elimina, y si lo estaba se vuelve a poner.
    if (previous === undefined) delete process.env.FORGE614_HOME;
    else process.env.FORGE614_HOME = previous;
  }
}

/**
 * Recoge las líneas escritas a través del `io` de `runUpdateCommand`, separando la salida normal de la de errores.
 *
 * @returns `io` (las dos funciones de escritura para pasar a `runUpdateCommand`), `out` (líneas normales) y `err` (líneas de error), que se van llenando.
 */
function collectingIo(): { io: { writeLine: (line: string) => void; writeError: (line: string) => void }; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { writeLine: (line) => out.push(line), writeError: (line) => err.push(line) }, out, err };
}

/** Agrupa las pruebas de `updateInstalledWorkers`: descarga el instalador, lo ejecuta y confirma la versión instalada. */
describe("updateInstalledWorkers", () => {
  /**
   * La actualización debe traer el instalador de la última versión y ejecutarlo con `--force`, y después limpiar.
   * Comprueba el orden exacto de llamadas (descarga de la dirección y luego `bash <instalador> --force`), que se
   * llamó a `cleanup` y el resultado `updated: true` de 1.0.0 a 1.1.0. Importa porque es el camino completo de `update`.
   */
  test("downloads the latest installer, runs it with --force and cleans up", async () => {
    const calls: string[] = [];
    let cleaned = false;

    const result = await updateInstalledWorkers("1.0.0", {
      download: async (url) => {
        calls.push(`download ${url}`);
        return { installer: "/tmp/forge614-workers-install.sh", cleanup: () => { cleaned = true; } };
      },
      spawn: (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        return { status: 0 };
      },
      readInstalledVersion: () => "1.1.0",
    });

    expect(calls).toEqual([
      "download https://github.com/jotredev/forge614-workers/releases/latest/download/install.sh",
      "bash /tmp/forge614-workers-install.sh --force",
    ]);
    expect(LATEST_INSTALLER_URL).toBe("https://github.com/jotredev/forge614-workers/releases/latest/download/install.sh");
    expect(cleaned).toBe(true);
    expect(result).toEqual({ updated: true, previousVersion: "1.0.0", installedVersion: "1.1.0" });
  });

  /**
   * Una descarga fallida se detiene antes de lanzar ningún proceso. Comprueba que la función rechaza con el
   * mensaje de la descarga y que el lanzador falso nunca se llamó. Importa porque sin instalador no hay nada que ejecutar.
   */
  test("a failed download rejects and never launches the installer", async () => {
    let launched = false;

    await expect(updateInstalledWorkers("1.0.0", {
      download: async () => { throw new Error("Could not download the Forge614 Workers installer."); },
      spawn: () => { launched = true; return { status: 0 }; },
    })).rejects.toThrow("Could not download the Forge614 Workers installer.");

    expect(launched).toBe(false);
  });

  /**
   * Un instalador que sale con código distinto de cero (aquí 1) debe hacer fallar la actualización (el error
   * contiene «installer failed») y aun así borrar el archivo descargado. Importa porque no deben quedar instaladores sueltos en la carpeta temporal.
   */
  test("a failing installer rejects and still cleans up", async () => {
    let cleaned = false;

    await expect(updateInstalledWorkers("1.0.0", {
      download: async () => ({ installer: "/tmp/forge614-workers-install.sh", cleanup: () => { cleaned = true; } }),
      spawn: () => ({ status: 1 }),
    })).rejects.toThrow("installer failed");

    expect(cleaned).toBe(true);
  });

  /**
   * Un proceso que ni siquiera puede arrancar (`status: null` con un error `spawn bash ENOENT`) deja ver su propio
   * error: la función rechaza con ese mismo mensaje. Importa para que el usuario vea la causa real, por ejemplo que falta `bash`.
   */
  test("a launch error is thrown as is", async () => {
    await expect(updateInstalledWorkers("1.0.0", {
      download: async () => ({ installer: "/tmp/forge614-workers-install.sh", cleanup: () => {} }),
      spawn: () => ({ status: null, error: new Error("spawn bash ENOENT") }),
    })).rejects.toThrow("spawn bash ENOENT");
  });

  /**
   * Cuando la versión instalada (1.0.0) es igual a la que corre (1.0.0), el resultado dice que nada cambió
   * (`updated: false`). Importa porque de ahí sale el mensaje «ya está al día» en vez de «actualizado».
   */
  test("reports unchanged when the installed version matches the current one", async () => {
    const result = await updateInstalledWorkers("1.0.0", {
      download: async () => ({ installer: "/tmp/forge614-workers-install.sh", cleanup: () => {} }),
      spawn: () => ({ status: 0 }),
      readInstalledVersion: () => "1.0.0",
    });

    expect(result).toEqual({ updated: false, previousVersion: "1.0.0", installedVersion: "1.0.0" });
  });
});

/** Agrupa las pruebas de `installedWorkersCommand`, que calcula dónde queda el comando instalado de Workers. */
describe("installedWorkersCommand", () => {
  /**
   * La ruta debe seguir a `FORGE614_HOME`: con `/tmp/forge614-update` resulta
   * `/tmp/forge614-update/workers/bin/forge614-workers`. Importa porque tras actualizar se lee la versión de ese comando y no de otro.
   */
  test("derives the command from FORGE614_HOME", () => withForge614Home("/tmp/forge614-update", () => {
    expect(installedWorkersCommand()).toBe("/tmp/forge614-update/workers/bin/forge614-workers");
  }));

  /**
   * Sin `FORGE614_HOME` la ruta cae a la carpeta `.forge614` dentro de la carpeta personal del usuario; se comprueba
   * solo el final de la ruta, porque el inicio depende de quién ejecute la prueba. Importa porque es el caso normal de quien no la define.
   */
  test("falls back to ~/.forge614 when FORGE614_HOME is unset", () => withForge614Home(undefined, () => {
    expect(installedWorkersCommand().endsWith("/.forge614/workers/bin/forge614-workers")).toBe(true);
  }));
});

/** Agrupa las pruebas de `runUpdateCommand`: argumentos, mensajes de salida y códigos de salida del comando `update`. */
describe("runUpdateCommand", () => {
  /**
   * Una descarga fallida sale como un mensaje claro por la salida de errores y un código distinto de cero (1);
   * la salida normal queda vacía. Importa porque es lo que ve el usuario cuando no hay red o el servidor responde con error.
   */
  test("a failed download ends with exit 1 and a clear message", async () => {
    const { io, out, err } = collectingIo();

    const exitCode = await runUpdateCommand([], "1.0.0", io, () =>
      updateInstalledWorkers("1.0.0", {
        download: async () => { throw new Error("Could not download the Forge614 Workers installer."); },
      }));

    expect(exitCode).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual(["Could not update forge614-workers: Could not download the Forge614 Workers installer."]);
  });

  /**
   * Una actualización exitosa que cambia la versión dice de cuál a cuál: sale con código 0, escribe una sola
   * línea «updated from 1.0.0 to 1.1.0» y no escribe errores. Importa porque es la confirmación que ve quien actualiza.
   */
  test("reports the old and the new version on success", async () => {
    const { io, out, err } = collectingIo();

    const exitCode = await runUpdateCommand([], "1.0.0", io, async () => ({ updated: true, previousVersion: "1.0.0", installedVersion: "1.1.0" }));

    expect(exitCode).toBe(0);
    expect(out).toEqual(["forge614-workers updated from 1.0.0 to 1.1.0."]);
    expect(err).toEqual([]);
  });

  /**
   * Una actualización exitosa que no encuentra nada nuevo lo dice («is already up to date (1.0.0)») y sale con
   * código 0. Importa porque no encontrar versión nueva no es un error y no debe parecerlo.
   */
  test("reports already up to date when nothing changed", async () => {
    const { io, out } = collectingIo();

    const exitCode = await runUpdateCommand([], "1.0.0", io, async () => ({ updated: false, previousVersion: "1.0.0", installedVersion: "1.0.0" }));

    expect(exitCode).toBe(0);
    expect(out).toEqual(["forge614-workers is already up to date (1.0.0)."]);
  });

  /**
   * `update` no acepta argumentos; con uno (`--force`) se rechaza con código 2 y el mensaje «takes no arguments»,
   * sin llamar a la actualización. Importa para que un argumento sin significado no se ignore en silencio.
   */
  test("refuses extra arguments with exit 2 without updating", async () => {
    const { io, err } = collectingIo();
    let called = false;

    const exitCode = await runUpdateCommand(["--force"], "1.0.0", io, async () => {
      called = true;
      return { updated: false, previousVersion: "1.0.0", installedVersion: "1.0.0" };
    });

    expect(exitCode).toBe(2);
    expect(called).toBe(false);
    expect(err).toEqual(["forge614-workers update takes no arguments."]);
  });
});
