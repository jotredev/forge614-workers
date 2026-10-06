/**
 * Autoactualización de Forge614 Workers: descarga el instalador publicado con la última versión (release), lo
 * ejecuta con `--force` (reinstala aunque ya esté instalado) y luego informa qué versión quedó instalada.
 * Cada dependencia externa (la descarga, el lanzamiento del proceso y la lectura de la versión instalada) se
 * puede reemplazar por parámetro, de modo que el flujo se prueba sin red ni instalador real.
 * Lo usa `src/main.ts` para el comando `update`; lo prueba `src/updater.test.ts`.
 * Piezas: `installedWorkersCommand`, `updateInstalledWorkers` y `runUpdateCommand`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/** Instalador adjunto a cada versión publicada de Workers; `latest` siempre apunta a la más nueva. */
export const LATEST_INSTALLER_URL = "https://github.com/jotredev/forge614-workers/releases/latest/download/install.sh";

/** Opciones que se aceptan al lanzar el proceso del instalador. */
type SpawnOptions = { stdio: "inherit" };
/** Forma de un lanzador de procesos; las pruebas lo reemplazan por uno que no ejecuta nada real. */
type Spawn = (command: string, args: string[], options?: SpawnOptions) => { status: number | null; error?: Error };
/** Forma de la descarga del instalador; las pruebas la reemplazan por una que nunca toca la red. */
type Download = (url: string) => Promise<{ installer: string; cleanup: () => void }>;
/** Forma de la lectura de la versión instalada; las pruebas la reemplazan por una constante. */
type ReadInstalledVersion = () => string;

/** Resultado de un intento de actualización. */
export interface UpdateResult {
  /** Si la versión instalada cambió. */
  updated: boolean;
  /** Versión que estaba instalada antes del intento. */
  previousVersion: string;
  /** Versión instalada después del intento (igual a `previousVersion` cuando nada cambió). */
  installedVersion: string;
}

/**
 * Da la ruta donde el instalador deja el comando activo de Workers: toma `FORGE614_HOME` si está definida y no
 * está vacía, y si no usa `.forge614` dentro de la carpeta personal del usuario. A diferencia del instalador
 * (`scripts/install.sh`), que exige una ruta absoluta en `FORGE614_HOME`, esta función no la valida: una ruta
 * relativa se usa tal cual.
 *
 * @returns La ruta de `forge614-workers` dentro de `<carpeta>/workers/bin`; es absoluta salvo que `FORGE614_HOME` sea relativa.
 */
export function installedWorkersCommand(): string {
  // `||` hace que una variable vacía cuente como no definida y se use la carpeta por defecto.
  const forgeHome = process.env.FORGE614_HOME || join(homedir(), ".forge614");
  return join(forgeHome, "workers", "bin", "forge614-workers");
}

/**
 * Ejecuta el comando instalado con `--version` y comprueba la forma de su respuesta.
 *
 * @returns La versión informada, por ejemplo `1.0.0`.
 * @throws Error si el comando no se puede ejecutar o sale con código distinto de cero (lo lanza `execFileSync` (ejecutor síncrono de procesos)), o si no imprime `forge614-workers X.Y.Z[...]` (mensaje «The installed Forge614 Workers did not report a valid version.»).
 */
function readInstalledVersion(): string {
  // Se ignora stdin y stderr del comando; solo se lee su stdout, sin espacios sobrantes en los extremos.
  const output = execFileSync(installedWorkersCommand(), ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  // Se exige el texto completo `forge614-workers` + versión de tres números, con un sufijo opcional como `-beta.1`; el grupo entre paréntesis captura solo la versión.
  const match = /^forge614-workers\s+([0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z][0-9A-Za-z.-]*)?)$/.exec(output);
  if (!match) throw new Error("The installed Forge614 Workers did not report a valid version.");
  return match[1]!;
}

/**
 * Descarga un script instalador a un archivo temporal privado y lo marca como ejecutable.
 *
 * @param url Dirección desde donde se descarga el instalador.
 * @returns La ruta del instalador descargado y una función `cleanup` que borra su carpeta temporal.
 * @throws Error con un mensaje claro si el servidor responde con un estado de error HTTP; un fallo de red rechaza con el error del propio `fetch` (la función de descarga del entorno de ejecución); un fallo al crear o escribir el archivo temporal lanza el error del sistema de archivos y deja sin borrar la carpeta ya creada.
 */
async function downloadInstaller(url: string): Promise<{ installer: string; cleanup: () => void }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not download the Forge614 Workers installer.");
  // El archivo vive en una carpeta temporal nueva; primero se escribe con permisos 0o600 (solo el dueño lee y escribe) y después se marca ejecutable solo para el dueño (0o700).
  const directory = mkdtempSync(join(tmpdir(), "forge614-workers-update-"));
  const installer = join(directory, "install.sh");
  writeFileSync(installer, new Uint8Array(await response.arrayBuffer()), { mode: 0o600 });
  chmodSync(installer, 0o700);
  return { installer, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

/**
 * Descarga el último instalador y lo ejecuta con `--force` para reemplazar la versión activa, y luego lee qué
 * versión quedó instalada. El archivo descargado se borra siempre, incluso si la instalación falla.
 *
 * @param currentVersion Versión del programa en ejecución, que se toma como la versión instalada antes de actualizar.
 * @param options Dependencias reemplazables; sin ellas se usan las reales.
 * @param options.download Descarga que se usa; por defecto una descarga HTTP real.
 * @param options.spawn Lanzador de procesos; por defecto `spawnSync` (lanzamiento síncrono), heredando la terminal para que se vean los mensajes del instalador.
 * @param options.readInstalledVersion Lectura de la versión después de instalar; por defecto ejecuta el comando instalado.
 * @returns Si la versión cambió, la versión anterior y la instalada.
 * @throws Error si la descarga falla, el instalador no puede arrancar, termina por una señal o sale con código distinto de cero, o el comando instalado no se puede ejecutar o no informa una versión válida.
 */
export async function updateInstalledWorkers(currentVersion: string, options: {
  /** Descarga del instalador; recibe la dirección y devuelve la ruta local y cómo borrarla. */
  download?: Download;
  /** Lanzador del proceso del instalador. */
  spawn?: Spawn;
  /** Lectura de la versión que quedó instalada. */
  readInstalledVersion?: ReadInstalledVersion;
} = {}): Promise<UpdateResult> {
  // La descarga va fuera del `try`: si falla, no hay archivo temporal que limpiar y nunca se lanza el instalador.
  const downloaded = await (options.download ?? downloadInstaller)(LATEST_INSTALLER_URL);
  const spawn: Spawn = options.spawn ?? ((command, args, spawnOptions) => spawnSync(command, args, spawnOptions));
  try {
    // Se ejecuta `bash <instalador> --force` con la terminal heredada.
    const result = spawn("bash", [downloaded.installer, "--force"], { stdio: "inherit" });
    // Un error de lanzamiento (por ejemplo, no existe `bash`) se relanza tal cual; un código distinto de cero es un instalador que falló.
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("The Forge614 Workers installer failed; the installed version was not confirmed.");
    // La versión se confirma preguntándole al comando recién instalado; «actualizado» significa que difiere de la que corría.
    const installedVersion = (options.readInstalledVersion ?? readInstalledVersion)();
    return { updated: installedVersion !== currentVersion, previousVersion: currentVersion, installedVersion };
  } finally {
    // El instalador descargado se borra en todos los caminos.
    downloaded.cleanup();
  }
}

/**
 * Ejecuta el comando `update`: valida sus argumentos, actualiza e imprime un resultado de una línea. Los
 * errores van a `writeError` y terminan con código de salida distinto de cero; nada de aquí lee stdin.
 *
 * @param args Argumentos que siguen a `update`; no se acepta ninguno.
 * @param currentVersion Versión del programa en ejecución.
 * @param io Salidas por donde se escribe el resultado; así la función se prueba sin imprimir de verdad.
 * @param io.writeLine Recibe cada línea de salida normal.
 * @param io.writeError Recibe cada línea de error.
 * @param update Actualización que se ejecuta; por defecto {@link updateInstalledWorkers}.
 * @returns El código de salida del proceso: 0 si todo salió bien, 2 si llegaron argumentos que no se esperaban, 1 si la actualización falla.
 */
export async function runUpdateCommand(
  args: string[],
  currentVersion: string,
  io: { writeLine: (line: string) => void; writeError: (line: string) => void },
  update: (currentVersion: string) => Promise<UpdateResult> = updateInstalledWorkers,
): Promise<number> {
  // `update` no admite argumentos: cualquiera se rechaza con código 2 antes de descargar nada.
  if (args.length > 0) {
    io.writeError("forge614-workers update takes no arguments.");
    return 2;
  }
  try {
    const result = await update(currentVersion);
    // Un mensaje distinto según si la versión cambió o ya estaba al día.
    io.writeLine(
      result.updated
        ? `forge614-workers updated from ${result.previousVersion} to ${result.installedVersion}.`
        : `forge614-workers is already up to date (${result.installedVersion}).`,
    );
    return 0;
  } catch (error) {
    // Cualquier fallo de la actualización se informa por la salida de errores con código 1; no se relanza.
    io.writeError(`Could not update forge614-workers: ${(error as Error).message}`);
    return 1;
  }
}
