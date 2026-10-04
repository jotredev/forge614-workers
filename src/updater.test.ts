/** Checks `updateInstalledWorkers` and `runUpdateCommand` with doubles: no network and no real installer are ever used. */
import { describe, expect, test } from "bun:test";
import { LATEST_INSTALLER_URL, installedWorkersCommand, runUpdateCommand, updateInstalledWorkers } from "./updater";

/** Runs `run` with `FORGE614_HOME` set (or removed) and restores the previous value afterwards. */
function withForge614Home(value: string | undefined, run: () => void): void {
  const previous = process.env.FORGE614_HOME;
  try {
    if (value === undefined) delete process.env.FORGE614_HOME;
    else process.env.FORGE614_HOME = value;
    run();
  } finally {
    if (previous === undefined) delete process.env.FORGE614_HOME;
    else process.env.FORGE614_HOME = previous;
  }
}

/** Collects the lines written through the `io` of `runUpdateCommand`. */
function collectingIo(): { io: { writeLine: (line: string) => void; writeError: (line: string) => void }; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { writeLine: (line) => out.push(line), writeError: (line) => err.push(line) }, out, err };
}

describe("updateInstalledWorkers", () => {
  /** The update must fetch the installer of the latest release and run it with `--force`, then clean up. */
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

  /** A failed download stops before any process is launched. */
  test("a failed download rejects and never launches the installer", async () => {
    let launched = false;

    await expect(updateInstalledWorkers("1.0.0", {
      download: async () => { throw new Error("Could not download the Forge614 Workers installer."); },
      spawn: () => { launched = true; return { status: 0 }; },
    })).rejects.toThrow("Could not download the Forge614 Workers installer.");

    expect(launched).toBe(false);
  });

  /** An installer that exits non-zero must fail the update and still remove the downloaded file. */
  test("a failing installer rejects and still cleans up", async () => {
    let cleaned = false;

    await expect(updateInstalledWorkers("1.0.0", {
      download: async () => ({ installer: "/tmp/forge614-workers-install.sh", cleanup: () => { cleaned = true; } }),
      spawn: () => ({ status: 1 }),
    })).rejects.toThrow("installer failed");

    expect(cleaned).toBe(true);
  });

  /** A process that cannot even start surfaces its own error. */
  test("a launch error is thrown as is", async () => {
    await expect(updateInstalledWorkers("1.0.0", {
      download: async () => ({ installer: "/tmp/forge614-workers-install.sh", cleanup: () => {} }),
      spawn: () => ({ status: null, error: new Error("spawn bash ENOENT") }),
    })).rejects.toThrow("spawn bash ENOENT");
  });

  /** When the installed version equals the running one, the result says nothing changed. */
  test("reports unchanged when the installed version matches the current one", async () => {
    const result = await updateInstalledWorkers("1.0.0", {
      download: async () => ({ installer: "/tmp/forge614-workers-install.sh", cleanup: () => {} }),
      spawn: () => ({ status: 0 }),
      readInstalledVersion: () => "1.0.0",
    });

    expect(result).toEqual({ updated: false, previousVersion: "1.0.0", installedVersion: "1.0.0" });
  });
});

describe("installedWorkersCommand", () => {
  /** The path must follow `FORGE614_HOME`, as the installer does. */
  test("derives the command from FORGE614_HOME", () => withForge614Home("/tmp/forge614-update", () => {
    expect(installedWorkersCommand()).toBe("/tmp/forge614-update/workers/bin/forge614-workers");
  }));

  /** Without `FORGE614_HOME` the path falls back to the folder in the user's home. */
  test("falls back to ~/.forge614 when FORGE614_HOME is unset", () => withForge614Home(undefined, () => {
    expect(installedWorkersCommand().endsWith("/.forge614/workers/bin/forge614-workers")).toBe(true);
  }));
});

describe("runUpdateCommand", () => {
  /** A failed download is a clear message on the error stream and a non-zero exit code. */
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

  /** A successful update that changes the version says from which to which. */
  test("reports the old and the new version on success", async () => {
    const { io, out, err } = collectingIo();

    const exitCode = await runUpdateCommand([], "1.0.0", io, async () => ({ updated: true, previousVersion: "1.0.0", installedVersion: "1.1.0" }));

    expect(exitCode).toBe(0);
    expect(out).toEqual(["forge614-workers updated from 1.0.0 to 1.1.0."]);
    expect(err).toEqual([]);
  });

  /** A successful update that finds nothing new says so. */
  test("reports already up to date when nothing changed", async () => {
    const { io, out } = collectingIo();

    const exitCode = await runUpdateCommand([], "1.0.0", io, async () => ({ updated: false, previousVersion: "1.0.0", installedVersion: "1.0.0" }));

    expect(exitCode).toBe(0);
    expect(out).toEqual(["forge614-workers is already up to date (1.0.0)."]);
  });

  /** `update` accepts no arguments; extra ones are refused without updating anything. */
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
