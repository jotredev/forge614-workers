/**
 * Self-update for Forge614 Workers: downloads the installer published with the latest release and runs
 * it with `--force`, then reports which version ended up installed. Every external dependency (the
 * download, the process launch and the read of the installed version) can be replaced by parameter so
 * the flow is testable without network or a real installer. Used by `src/main.ts` for `update`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** Installer attached to every Workers release; `latest` always resolves to the newest one. */
export const LATEST_INSTALLER_URL = "https://github.com/jotredev/forge614-workers/releases/latest/download/install.sh";

/** Options accepted when launching the installer process. */
type SpawnOptions = { stdio: "inherit" };
/** Shape of a process launcher; tests replace it with one that runs nothing real. */
type Spawn = (command: string, args: string[], options?: SpawnOptions) => { status: number | null; error?: Error };
/** Shape of the installer download; tests replace it with one that never touches the network. */
type Download = (url: string) => Promise<{ installer: string; cleanup: () => void }>;
/** Shape of the read of the installed version; tests replace it with a constant. */
type ReadInstalledVersion = () => string;

/** Outcome of an update attempt. */
export interface UpdateResult {
  /** Whether the installed version changed. */
  updated: boolean;
  /** Version that was installed before the attempt. */
  previousVersion: string;
  /** Version installed after the attempt (equal to `previousVersion` when nothing changed). */
  installedVersion: string;
}

/**
 * Gives the path where the installer leaves the active Workers command, honouring `FORGE614_HOME`
 * the same way the installer does.
 * @returns The absolute path of `forge614-workers` under `<home>/workers/bin`.
 */
export function installedWorkersCommand(): string {
  const forgeHome = process.env.FORGE614_HOME || join(homedir(), ".forge614");
  return join(forgeHome, "workers", "bin", "forge614-workers");
}

/**
 * Runs the installed command with `--version` and checks the shape of its answer.
 * @returns The reported version, for example `1.0.0`.
 * @throws Error when the command does not print `forge614-workers X.Y.Z[...]`.
 */
function readInstalledVersion(): string {
  const output = execFileSync(installedWorkersCommand(), ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const match = /^forge614-workers\s+([0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z][0-9A-Za-z.-]*)?)$/.exec(output);
  if (!match) throw new Error("The installed Forge614 Workers did not report a valid version.");
  return match[1]!;
}

/**
 * Downloads an installer script to a private temporary file marked executable.
 * @param url Where to download the installer from.
 * @returns The path of the downloaded installer and a `cleanup` that removes its temporary folder.
 * @throws Error when the server answers with an HTTP error status.
 */
async function downloadInstaller(url: string): Promise<{ installer: string; cleanup: () => void }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not download the Forge614 Workers installer.");
  const directory = mkdtempSync(join(tmpdir(), "forge614-workers-update-"));
  const installer = join(directory, "install.sh");
  writeFileSync(installer, new Uint8Array(await response.arrayBuffer()), { mode: 0o600 });
  chmodSync(installer, 0o700);
  return { installer, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

/**
 * Downloads the latest installer and runs it with `--force` to replace the active version, then reads
 * which version is installed. The downloaded file is always removed, even when the installation fails.
 * @param currentVersion Version of the running program, taken as the version installed before the update.
 * @param options.download Download to use; defaults to a real HTTP download.
 * @param options.spawn Process launcher; defaults to `spawnSync`, inheriting the terminal so the installer's messages are visible.
 * @param options.readInstalledVersion Read of the version after installing; defaults to running the installed command.
 * @returns Whether the version changed, the previous version and the installed one.
 * @throws Error when the download fails, the installer cannot start or exits non-zero, or the installed command does not report a valid version.
 */
export async function updateInstalledWorkers(currentVersion: string, options: {
  download?: Download;
  spawn?: Spawn;
  readInstalledVersion?: ReadInstalledVersion;
} = {}): Promise<UpdateResult> {
  const downloaded = await (options.download ?? downloadInstaller)(LATEST_INSTALLER_URL);
  const spawn: Spawn = options.spawn ?? ((command, args, spawnOptions) => spawnSync(command, args, spawnOptions));
  try {
    const result = spawn("bash", [downloaded.installer, "--force"], { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("The Forge614 Workers installer failed; the installed version was not confirmed.");
    const installedVersion = (options.readInstalledVersion ?? readInstalledVersion)();
    return { updated: installedVersion !== currentVersion, previousVersion: currentVersion, installedVersion };
  } finally {
    downloaded.cleanup();
  }
}

/**
 * Runs the `update` command: validates its arguments, updates, and prints a one-line outcome. Errors
 * go to `writeError` and end with a non-zero exit code; nothing here reads stdin.
 * @param args Arguments after `update`; none are accepted.
 * @param currentVersion Version of the running program.
 * @param io.writeLine Receives each normal output line.
 * @param io.writeError Receives each error line.
 * @param update Update to run; defaults to {@link updateInstalledWorkers}.
 * @returns The process exit code: 0 on success, 2 for unexpected arguments, 1 when the update fails.
 */
export async function runUpdateCommand(
  args: string[],
  currentVersion: string,
  io: { writeLine: (line: string) => void; writeError: (line: string) => void },
  update: (currentVersion: string) => Promise<UpdateResult> = updateInstalledWorkers,
): Promise<number> {
  if (args.length > 0) {
    io.writeError("forge614-workers update takes no arguments.");
    return 2;
  }
  try {
    const result = await update(currentVersion);
    io.writeLine(
      result.updated
        ? `forge614-workers updated from ${result.previousVersion} to ${result.installedVersion}.`
        : `forge614-workers is already up to date (${result.installedVersion}).`,
    );
    return 0;
  } catch (error) {
    io.writeError(`Could not update forge614-workers: ${(error as Error).message}`);
    return 1;
  }
}
