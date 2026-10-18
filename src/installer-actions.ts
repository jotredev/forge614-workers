/** Acciones de instalación, actualización y retirada del lanzador de Workers. */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, readdirSync, renameSync, rmSync, writeFileSync, type Dirent } from "node:fs";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep, win32 } from "node:path";

const REPOSITORY = "jotredev/forge614-workers";

/** Acciones delegadas al instalador común publicado. */
export type InstallerAction = "update" | "uninstall";

/** Resultado capturado al ejecutar un portero de instalación. */
export interface InstallerProcessResult {
  /** Código de salida del portero. */
  exitCode: number;
  /** Salida normal capturada. */
  stdout: string;
  /** Salida de errores capturada. */
  stderr: string;
}

/** Dependencias sustituibles de las acciones de actualización y retirada. */
export interface InstallerActionOptions {
  /** Entorno para la descarga y el proceso del portero. */
  env?: Record<string, string | undefined>;
  /** Plataforma a simular en las pruebas. */
  platform?: string;
  /** Lector HTTP sustituible para la puerta loopback de pruebas. */
  fetcher?: typeof fetch;
  /** Ejecutor del portero sustituible para pruebas de argumentos. */
  run?: (command: string, args: string[], options: { env: Record<string, string> }) => InstallerProcessResult | Promise<InstallerProcessResult>;
  /** Ejecutable actual, sustituible para comprobar el caso Windows. */
  processExecPath?: string;
  /** PID actual, sustituible para comprobar la limpieza Windows. */
  processId?: number;
  /** Programador de borrado Windows sustituible en las pruebas. */
  scheduleDelete?: (command: string, args: string[], options: { env: Record<string, string>; detached: true; stdio: "ignore"; windowsHide: true }) => void;
  /** Etiqueta ya resuelta para una actualización dirigida a versión. */
  versionTag?: string;
  /** Versión instalada después de que el portero termine, sustituible en las pruebas. */
  readInstalledVersion?: (env: Record<string, string | undefined>, platform: string, fallback: string) => string;
}

/** Resultado de una actualización correcta. */
export interface UpdateWorkersResult {
  /** Indica si cambió la versión instalada. */
  updated: boolean;
  /** Versión que ejecutó el comando antes de actualizar. */
  previousVersion: string;
  /** Versión que respondió el lanzador instalado tras la actualización. */
  installedVersion: string;
}

/** Error seguro que puede traducirse a un sobre JSON estable en la CLI. */
export class InstallerActionError extends Error {
  /** Código de error estable del comando que falló. */
  readonly code: string;

  /** Crea un error de una acción con su código estable. */
  constructor(code: string, message: string) {
    super(message);
    this.name = "InstallerActionError";
    this.code = code;
  }
}

/** Lee una variable del entorno entregado y luego del proceso actual. */
function envValue(env: Record<string, string | undefined>, key: string): string | undefined {
  return env[key] ?? process.env[key];
}

/** Devuelve el directorio FORGE614_HOME absoluto configurado o su valor predeterminado. */
function forgeHome(env: Record<string, string | undefined>): string {
  const home = envValue(env, "FORGE614_HOME") || join(envValue(env, "HOME") || envValue(env, "USERPROFILE") || homedir(), ".forge614");
  if (!isAbsolute(home)) throw new Error("FORGE614_HOME must be an absolute path.");
  return home;
}

/** Valida la puerta de pruebas HTTP y acepta únicamente loopback con puerto explícito. */
function testBaseUrl(env: Record<string, string | undefined>): string | undefined {
  const value = envValue(env, "FORGE614_INSTALL_TEST_BASE_URL");
  if (value === undefined) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("FORGE614_INSTALL_TEST_BASE_URL only accepts loopback HTTP."); }
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]", "::1"].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("FORGE614_INSTALL_TEST_BASE_URL only accepts loopback HTTP.");
  }
  return url.origin;
}

/** Crea la URL de la API que resuelve la última release estable. */
function latestReleaseUrl(base: string | undefined): string {
  return base === undefined ? `https://api.github.com/repos/${REPOSITORY}/releases/latest` : `${base}/repos/${REPOSITORY}/releases/latest`;
}

/** Crea la URL de un archivo para una etiqueta concreta. */
function releaseAssetUrl(base: string | undefined, tag: string, file: string): string {
  const path = `releases/download/${encodeURIComponent(tag)}/${file}`;
  return base === undefined ? `https://github.com/${REPOSITORY}/${path}` : `${base}/repos/${REPOSITORY}/${path}`;
}

/** Reemplaza rutas sensibles sin alterar direcciones URL incluidas en el detalle. */
export function sanitizeInstallerDetail(detail: string, env: Record<string, string | undefined> = process.env, platform: string = process.platform): string {
  const candidates = ["HOME", "USERPROFILE", "FORGE614_HOME", "TMP", "TMPDIR", "TEMP"].flatMap((key) => {
    const value = envValue(env, key);
    if (!value) return [];
    try { return [value, realpathSync.native(value)]; } catch { return [value]; }
  });
  try { candidates.push(realpathSync.native(tmpdir())); } catch { candidates.push(tmpdir()); }
  const unique = [...new Set(candidates)].sort((left, right) => right.length - left.length);
  const urls = new Map<string, string>();
  let safe = detail.replace(/https?:\/\/[^\s]+/gi, (url) => {
    const token = `__FORGE614_URL_${randomUUID()}__`;
    urls.set(token, url);
    return token;
  });
  for (const value of unique) safe = replaceLiteral(safe, value, "<ruta>", platform === "win32");
  return safe.replace(/__FORGE614_URL_[0-9a-f-]+__/g, (token) => urls.get(token) ?? token);
}

/** Reemplaza ocurrencias literales respetando las reglas de mayúsculas de Windows. */
function replaceLiteral(source: string, search: string, replacement: string, insensitive: boolean): string {
  const haystack = insensitive ? source.toLocaleLowerCase("en-US") : source;
  const needle = insensitive ? search.toLocaleLowerCase("en-US") : search;
  let cursor = 0;
  let result = "";
  while (cursor < source.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index < 0) return result + source.slice(cursor);
    result += source.slice(cursor, index) + replacement;
    cursor = index + search.length;
  }
  return result;
}

/** Normaliza y compara rutas Windows tras resolver alias cortos cuando el sistema lo permite. */
export function sameWindowsPath(left: string, right: string, resolvePath: (path: string) => string = (path) => realpathSync.native(path)): boolean {
  let resolvedLeft = left;
  let resolvedRight = right;
  try { resolvedLeft = resolvePath(left); resolvedRight = resolvePath(right); } catch { /* Se comparan rutas normalizadas si alguna no existe. */ }
  const a = win32.normalize(resolvedLeft).replaceAll("/", "\\").toLocaleLowerCase("en-US");
  const b = win32.normalize(resolvedRight).replaceAll("/", "\\").toLocaleLowerCase("en-US");
  return a === b;
}

/** Resuelve el ejecutable de Workers instalado para la plataforma activa. */
function installedLauncher(env: Record<string, string | undefined>, platform: string): string {
  return join(forgeHome(env), "workers", "bin", `forge614-workers${platform === "win32" ? ".exe" : ""}`);
}

/** Borra con mejor esfuerzo los ejecutables Windows aparcados por órdenes anteriores. */
export function cleanupStaleWindowsLaunchers(options: { env?: Record<string, string | undefined>; platform?: string } = {}): void {
  if ((options.platform ?? process.platform) !== "win32") return;
  const env = options.env ?? process.env;
  const home = forgeHome(env);
  const launcherDirectory = dirname(installedLauncher(env, "win32"));
  for (const directory of [launcherDirectory, home]) {
    let entries: Dirent[];
    try { entries = readdirSync(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const stale = directory === home
        ? /^\.forge614-workers-old-.+\.exe$/i.test(entry.name)
        : /^forge614-workers\.exe\.old-.+$/i.test(entry.name);
      if (!entry.isFile() || !stale) continue;
      try { rmSync(join(directory, entry.name), { force: true }); } catch { /* La limpieza de restos no debe interrumpir la orden. */ }
    }
  }
}

/** Resuelve la versión pedida o consulta una vez la última etiqueta publicada. */
async function selectedTag(action: InstallerAction, base: string | undefined, versionTag: string | undefined, fetcher: typeof fetch, env: Record<string, string | undefined>, platform: string): Promise<string> {
  if (versionTag !== undefined) return versionTag;
  let response: Response;
  try { response = await fetcher(latestReleaseUrl(base), { headers: { Accept: "application/vnd.github+json" } }); }
  catch (error) { throw actionError(action === "update" ? "UPDATE_FAILED" : "UNINSTALL_FAILED", error instanceof Error ? error.message : "network error", env, platform); }
  if (!response.ok) throw actionError(action === "update" ? "UPDATE_FAILED" : "UNINSTALL_FAILED", `Could not resolve the latest release (HTTP ${response.status}).`, env, platform);
  let tag: unknown;
  try { tag = (await response.json() as { tag_name?: unknown }).tag_name; } catch { tag = undefined; }
  if (typeof tag !== "string" || !/^v?\d+\.\d+\.\d+$/.test(tag)) throw actionError(action === "update" ? "UPDATE_FAILED" : "UNINSTALL_FAILED", "The latest Forge614 Workers release has an invalid tag.", env, platform);
  return `v${tag.replace(/^v/, "")}`;
}

/** Crea un error estructurado con los datos locales ocultos. */
function actionError(code: string, detail: string, env: Record<string, string | undefined>, platform: string): InstallerActionError {
  return new InstallerActionError(code, sanitizeInstallerDetail(detail, env, platform));
}

/** Descarga una respuesta HTTP y transforma fallos de red en errores seguros. */
async function fetchResponse(fetcher: typeof fetch, url: string, code: string, env: Record<string, string | undefined>, platform: string): Promise<Response> {
  try { return await fetcher(url); }
  catch (error) { throw actionError(code, error instanceof Error ? error.message : "network error", env, platform); }
}

/** Comprueba la única entrada GNU estricta del portero y su SHA-256. */
function verifyGatekeeperChecksum(file: string, bytes: Uint8Array, sums: string, code: string, env: Record<string, string | undefined>, platform: string): void {
  const lines = sums.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const entries = lines.map((line) => /^([0-9a-f]{64})  ([^\r\n]+)$/.exec(line));
  if (entries.length === 0 || entries.some((entry) => entry === null)) throw actionError(code, "SHA256SUMS does not use strict GNU SHA-256 format.", env, platform);
  const matches = entries.filter((entry) => entry?.[2] === file);
  if (matches.length !== 1 || !matches[0]?.[1]) throw actionError(code, `SHA256SUMS has no unique entry for ${file}.`, env, platform);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== matches[0][1]) throw actionError(code, `SHA-256 verification failed for ${file}.`, env, platform);
}

/** Lee la salida de versión del lanzador instalado y usa el respaldo si no está disponible. */
function readInstalledVersion(env: Record<string, string | undefined>, platform: string, _fallback: string): string {
  try {
    const output = execFileSync(installedLauncher(env, platform), ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const match = /^forge614-workers (\d+\.\d+\.\d+)$/.exec(output);
    if (!match?.[1]) throw new Error("The installed Workers launcher returned an invalid version.");
    return match[1];
  } catch (error) {
    throw actionError("UPDATE_FAILED", error instanceof Error ? error.message : "could not read the installed version", env, platform);
  }
}

/** Corre el portero descargado con el intérprete que corresponde al sistema. */
function runInstaller(command: string, args: string[], env: Record<string, string>): InstallerProcessResult {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env, windowsHide: true });
  if (result.error) throw result.error;
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Aparca el .exe activo para que el portero pueda actualizarlo o borrar su carpeta. */
function parkWindowsLauncher(action: InstallerAction, env: Record<string, string | undefined>, processExecPath: string): { original: string; parked: string } | undefined {
  const original = installedLauncher(env, "win32");
  if (!sameWindowsPath(processExecPath, original)) return undefined;
  const parked = action === "update" ? `${original}.old-${randomUUID()}` : join(forgeHome(env), `.forge614-workers-old-${randomUUID()}.exe`);
  renameSync(original, parked);
  return { original, parked };
}

/** Restaura el .exe aparcado si el portero no creó uno nuevo en la ubicación original. */
function restoreWindowsLauncher(parked: { original: string; parked: string } | undefined): void {
  if (!parked || !existsSync(parked.parked)) return;
  try {
    if (existsSync(parked.original)) rmSync(parked.original, { force: true });
    mkdirSync(dirname(parked.original), { recursive: true });
    renameSync(parked.parked, parked.original);
  } catch { /* Se conserva el error original si la vuelta atrás falla. */ }
}

/** Crea la orden PowerShell que borra con reintentos el .exe aparcado al terminar Workers. */
function windowsLauncherRemovalCommand(processId: number): { command: string; args: string[] } {
  const script = `try { Wait-Process -Id ${processId} -Timeout 30 -ErrorAction SilentlyContinue } catch {}; for ($attempt = 0; $attempt -lt 30; $attempt++) { Remove-Item -LiteralPath $env:FORGE614_WORKERS_PARKED -Force -ErrorAction SilentlyContinue; if (-not (Test-Path -LiteralPath $env:FORGE614_WORKERS_PARKED)) { break }; Start-Sleep -Milliseconds 250 }`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return {
    command: "powershell.exe",
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-NonInteractive", "-EncodedCommand", encoded],
  };
}

/** Programa la eliminación del .exe apartado después de que el proceso actual haya terminado. */
function scheduleWindowsLauncherRemoval(file: string, processId: number, env: Record<string, string | undefined>): void {
  const removal = windowsLauncherRemovalCommand(processId);
  const childEnv = Object.fromEntries(Object.entries({ ...process.env, ...env, FORGE614_WORKERS_PARKED: file }).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const child = spawn(removal.command, removal.args, { env: childEnv, detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

/** Ejecuta una operación del portero con la etiqueta ya resuelta y SHA256SUMS validado. */
async function runInstallerGate(action: InstallerAction, options: InstallerActionOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const base = testBaseUrl(env);
  const tag = await selectedTag(action, base, action === "update" ? options.versionTag : undefined, options.fetcher ?? fetch, env, platform);
  const file = platform === "win32" ? "install.ps1" : "install.sh";
  const fetcher = options.fetcher ?? fetch;
  const assetResponse = await fetchResponse(fetcher, releaseAssetUrl(base, tag, file), action === "update" ? "UPDATE_FAILED" : "UNINSTALL_FAILED", env, platform);
  if (!assetResponse.ok) throw actionError(action === "update" ? "UPDATE_FAILED" : "UNINSTALL_FAILED", `Could not download ${file} for ${tag} (HTTP ${assetResponse.status}).`, env, platform);
  const assetBytes = new Uint8Array(await assetResponse.arrayBuffer());
  const sumsResponse = await fetchResponse(fetcher, releaseAssetUrl(base, tag, "SHA256SUMS"), action === "update" ? "UPDATE_FAILED" : "UNINSTALL_FAILED", env, platform);
  if (!sumsResponse.ok) throw actionError(action === "update" ? "UPDATE_FAILED" : "UNINSTALL_FAILED", `Could not download SHA256SUMS for ${tag} (HTTP ${sumsResponse.status}).`, env, platform);
  verifyGatekeeperChecksum(file, assetBytes, await sumsResponse.text(), action === "update" ? "UPDATE_FAILED" : "UNINSTALL_FAILED", env, platform);

  const directory = mkdtempSync(join(tmpdir(), "forge614-workers-installer-"));
  const installer = join(directory, file);
  try {
    writeFileSync(installer, assetBytes, { mode: 0o600 });
    if (platform !== "win32") chmodSync(installer, 0o700);
    const processEnv = Object.fromEntries(Object.entries({ ...process.env, ...env }).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const actionArgs = action === "update" ? ["--version", tag] : ["--uninstall"];
    const command = platform === "win32" ? "powershell" : "sh";
    const args = platform === "win32" ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installer, ...actionArgs] : [installer, ...actionArgs];
    const parked = platform === "win32" ? parkWindowsLauncher(action, env, options.processExecPath ?? process.execPath) : undefined;
    try {
      const result = options.run
        ? await options.run(command, args, { env: processEnv })
        : await runInstaller(command, args, processEnv);
      if (result.exitCode !== 0) {
        const detail = result.stderr.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? `The Forge614 Workers installer exited with code ${result.exitCode}.`;
        throw actionError(action === "update" ? "UPDATE_FAILED" : "UNINSTALL_FAILED", detail, env, platform);
      }
      if (action === "uninstall" && parked) {
        if (options.scheduleDelete) {
          const removal = windowsLauncherRemovalCommand(options.processId ?? process.pid);
          options.scheduleDelete(removal.command, removal.args, {
            env: Object.fromEntries(Object.entries({ ...process.env, ...env, FORGE614_WORKERS_PARKED: parked.parked }).filter((entry): entry is [string, string] => entry[1] !== undefined)),
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          });
        } else scheduleWindowsLauncherRemoval(parked.parked, options.processId ?? process.pid, env);
      } else if (action === "update" && parked) {
        if (!existsSync(parked.original)) restoreWindowsLauncher(parked);
      }
    } catch (error) {
      restoreWindowsLauncher(parked);
      if (error instanceof InstallerActionError) throw error;
      throw actionError(action === "update" ? "UPDATE_FAILED" : "UNINSTALL_FAILED", error instanceof Error ? error.message : "installer failed", env, platform);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Actualiza Workers a la última release o a la versión dirigida y lee la versión instalada real. */
export async function updateInstalledWorkers(currentVersion: string, options: InstallerActionOptions = {}): Promise<UpdateWorkersResult> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  forgeHome(env);
  cleanupStaleWindowsLaunchers({ env, platform });
  const base = testBaseUrl(env);
  const tag = await selectedTag("update", base, options.versionTag, options.fetcher ?? fetch, env, platform);
  await runInstallerGate("update", { ...options, versionTag: tag });
  const installedVersion = (options.readInstalledVersion ?? readInstalledVersion)(env, platform, currentVersion);
  return { updated: installedVersion !== currentVersion, previousVersion: currentVersion, installedVersion };
}

/** Rechaza desinstalar desde un directorio que se borraría con Workers. */
function ensureUninstallStartsOutsideWorkers(env: Record<string, string | undefined>, cwd: string, platform: string): void {
  const workersDir = join(forgeHome(env), "workers");
  try {
    const root = realpathSync.native(workersDir);
    const current = realpathSync.native(cwd);
    if (platform === "win32") {
      const normalizedRoot = win32.normalize(root).toLocaleLowerCase("en-US");
      const normalizedCurrent = win32.normalize(current).toLocaleLowerCase("en-US");
      const relativePath = win32.relative(normalizedRoot, normalizedCurrent);
      if (relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${win32.sep}`) && !win32.isAbsolute(relativePath))) throw new Error("uninstall cannot run from inside FORGE614_HOME/workers");
    } else {
      const relativePath = relative(root, current);
      if (relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))) throw new Error("uninstall cannot run from inside FORGE614_HOME/workers");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "uninstall cannot run from inside FORGE614_HOME/workers") throw error;
    if (existsSync(workersDir)) throw new Error("could not verify the uninstall working directory");
  }
}

/** Desinstala Workers mediante el portero y verifica que la carpeta del nodo desapareció. */
export async function uninstallInstalledWorkers(options: InstallerActionOptions & { cwd?: string } = {}): Promise<void> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  ensureUninstallStartsOutsideWorkers(env, options.cwd ?? process.cwd(), platform);
  cleanupStaleWindowsLaunchers({ env, platform });
  await runInstallerGate("uninstall", options);
  const workersDir = join(forgeHome(env), "workers");
  if (existsSync(workersDir)) throw actionError("UNINSTALL_FAILED", "The installer exited successfully but the Workers directory still exists.", env, platform);
}
