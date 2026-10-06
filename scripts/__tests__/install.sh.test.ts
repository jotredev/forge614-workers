/**
 * Prueba `scripts/install.sh` de punta a punta en entornos desechables (sandboxes): un HOME temporal, un servidor
 * en loopback (dirección local `127.0.0.1`, que no sale de la máquina) que hace de API de releases (versiones
 * publicadas) de GitHub, y dobles locales (programas de mentira) de Forge614 Engines y de su instalador. Nunca
 * toca el HOME real, el `~/.forge614` real ni la red.
 */
import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const installer = resolve(import.meta.dir, "../install.sh");
const temporaryDirectories: string[] = [];
const fixtureBytes = "#!/usr/bin/env sh\nprintf 'fixture release binary\\n'\n";
const releaseTag = "v1.0.0";
const releaseVersion = "1.0.0";
const testReleaseBaseUrl = "FORGE614_WORKERS_TEST_RELEASE_BASE_URL";
const testMode = "FORGE614_WORKERS_INSTALLER_TEST";
const enginesInstallerTestUrl = "FORGE614_WORKERS_ENGINES_INSTALLER_TEST_URL";

/** Describe cómo se porta un Forge614 Engines de mentira: qué versión dice tener y si garantiza el bloqueo de solo lectura. */
interface FakeEngines {
  /** Versión que imprime `--version`, por ejemplo `1.17.0` (la mínima que acepta el instalador). */
  version: string;
  /** Valor de `supportsReadOnly` que devuelve `capabilities` para claude-code. */
  supportsReadOnly: boolean;
}

const compatibleEngines: FakeEngines = { version: "1.17.0", supportsReadOnly: true };

// Después de cada prueba se borran las carpetas temporales que esa prueba registró; `splice(0)` vacía la lista a la vez que la devuelve.
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

/**
 * Crea una carpeta temporal nueva y la anota para que `afterEach` la borre al terminar la prueba.
 *
 * @returns La ruta absoluta de la carpeta creada dentro de la carpeta temporal del sistema.
 */
function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "forge614-workers-installer-"));
  temporaryDirectories.push(directory);
  return directory;
}

/**
 * Da el nombre del binario publicado que corresponde a la máquina que corre las pruebas, con la misma tabla de
 * sistema y arquitectura que usa `scripts/install.sh`.
 *
 * @returns Uno de los cuatro nombres `forge614-workers-<sistema>-<arquitectura>` (macOS o Linux, x64 o arm64).
 * @throws Error («Unsupported test host: <sistema>/<arquitectura>») si la máquina no es ninguna de esas cuatro.
 */
function targetArtifact(): string {
  const target = `${process.platform}/${process.arch}`;
  const artifacts: Record<string, string> = {
    "darwin/x64": "forge614-workers-darwin-x64",
    "darwin/arm64": "forge614-workers-darwin-arm64",
    "linux/x64": "forge614-workers-linux-x64",
    "linux/arm64": "forge614-workers-linux-arm64",
  };
  const artifact = artifacts[target];
  if (!artifact) throw new Error(`Unsupported test host: ${target}`);
  return artifact;
}

/**
 * Calcula la huella SHA-256 (un resumen del contenido: cambia si cambia un solo byte) de un archivo.
 *
 * @param path Ruta del archivo que se resume.
 * @returns La huella en hexadecimal y minúsculas, como la escribe `SHA256SUMS`.
 */
function sha256(path: string): string {
  return new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Arma el texto del script de un `forge614-engines` de mentira que solo responde a `--version` y a `capabilities`;
 * cualquier otro argumento sale con código 64.
 *
 * @param engines Versión y soporte de solo lectura que el script debe declarar.
 * @returns El contenido del script de bash, listo para guardarse en un archivo.
 */
function fakeEnginesScript(engines: FakeEngines): string {
  return [
    "#!/usr/bin/env bash",
    'case "$1" in',
    `  --version) echo "forge614-engines ${engines.version}" ;;`,
    `  capabilities) echo '{"id": "claude-code", "supportsReadOnly": ${engines.supportsReadOnly}}' ;;`,
    "  *) exit 64 ;;",
    "esac",
    "",
  ].join("\n");
}

/**
 * Guarda un Engines de mentira en `<home>/.forge614/engines/bin/forge614-engines`, que es donde el instalador lo
 * busca cuando no hay `FORGE614_HOME`, y lo hace ejecutable (permisos 755).
 *
 * @param home Carpeta que hace de HOME en la prueba.
 * @param engines Versión y soporte de solo lectura que declara ese Engines.
 * @returns La ruta del script que se escribió.
 */
function installFakeEngines(home: string, engines: FakeEngines): string {
  const path = join(home, ".forge614", "engines", "bin", "forge614-engines");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, fakeEnginesScript(engines));
  chmodSync(path, 0o755);
  return path;
}

/**
 * Escribe un doble del instalador de Engines: un script que anota `ran` en `marker` cada vez que corre y, salvo que
 * `exitCode` sea distinto de cero, deja un Engines de mentira (el que describe `installs`) donde lo dejaría el real,
 * en `$FORGE614_HOME/engines/bin` o en `$HOME/.forge614/engines/bin`. Con `exitCode` distinto de cero sale con ese código sin instalar nada.
 *
 * @param path Dónde se guarda el script del doble.
 * @param marker Archivo donde el doble anota cada ejecución; `enginesInstallerRuns` cuenta sus líneas.
 * @param installs Versión y soporte de solo lectura del Engines que el doble deja instalado.
 * @param exitCode Código con el que el doble termina; 0 por defecto.
 */
function writeEnginesInstaller(path: string, marker: string, installs: FakeEngines, exitCode = 0): void {
  writeFileSync(path, [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `echo ran >> '${marker}'`,
    `if [ ${exitCode} -ne 0 ]; then exit ${exitCode}; fi`,
    'engines="${FORGE614_HOME:-$HOME/.forge614}/engines/bin/forge614-engines"',
    'mkdir -p "$(dirname "$engines")"',
    `cat > "$engines" <<'FAKE'`,
    fakeEnginesScript(installs),
    "FAKE",
    'chmod 755 "$engines"',
    "",
  ].join("\n"));
}

/** Opciones de una corrida del instalador: qué entorno se le arma. */
interface RunOptions {
  /** Valor de la variable `HOME` con la que corre el instalador; una carpeta temporal. */
  home: string;
  /** Dirección base del servidor de releases de mentira; el instalador la recibe en `FORGE614_WORKERS_TEST_RELEASE_BASE_URL`. */
  releaseBaseUrl: string;
  /** Ruta del doble del instalador de Engines; se entrega al instalador como una dirección `file://`. Sin ella no se define esa variable. */
  enginesInstaller?: string;
  /** Valor de la variable `SHELL`; `/bin/zsh` si no se indica. */
  shell?: string;
  /** Si es `false`, no se define la marca de pruebas `FORGE614_WORKERS_INSTALLER_TEST`; con cualquier otro valor se define como `1`. */
  includeTestSentinel?: boolean;
  /** Valor de `FORGE614_HOME`; sin él la variable se quita del entorno para que valga la carpeta por defecto. */
  forgeHome?: string;
}

/**
 * Corre `scripts/install.sh` con un entorno aislado: HOME temporal, `FORGE614_HOME` solo si `forgeHome` lo pide y
 * los puntos de entrada de pruebas. Parte del entorno del proceso actual, pero deja fuera cualquier `FORGE614_HOME`
 * y dirección de instalador de Engines heredados, para que la prueba no dependa del equipo donde corre.
 *
 * @param args Argumentos que se le pasan al instalador, por ejemplo `["--force"]`.
 * @param options Entorno de la corrida (véase `RunOptions`).
 * @returns El código de salida del instalador y todo lo que escribió en stdout y stderr.
 */
async function runInstaller(args: string[], options: RunOptions): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const env: Record<string, string | undefined> = { ...process.env, HOME: options.home, SHELL: options.shell ?? "/bin/zsh" };
  delete env.FORGE614_HOME;
  if (options.forgeHome !== undefined) env.FORGE614_HOME = options.forgeHome;
  delete env[enginesInstallerTestUrl];
  env[testReleaseBaseUrl] = options.releaseBaseUrl;
  // La marca de pruebas se quita solo cuando la prueba pide `false`; en los demás casos queda puesta.
  if (options.includeTestSentinel === false) delete env[testMode];
  else env[testMode] = "1";
  if (options.enginesInstaller) env[enginesInstallerTestUrl] = `file://${options.enginesInstaller}`;
  const child = Bun.spawn(["/usr/bin/env", "bash", installer, ...args], { env, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: await child.exited,
    stdout: await new Response(child.stdout).text(),
    stderr: await new Response(child.stderr).text(),
  };
}

/**
 * Levanta un servidor en loopback que imita la API de releases de GitHub para una sola versión. Las rutas que
 * empiezan con `/mismatch/` publican una huella equivocada (64 ceros) y las que empiezan con `/unsafe-assets/`
 * hacen que los archivos apunten a una dirección HTTPS que no es del servidor de pruebas.
 *
 * @param artifact Nombre del binario de la plataforma, que el servidor anuncia junto a `SHA256SUMS`.
 * @param fixturePath Archivo que se entrega como binario y del que se calcula la huella.
 * @returns El servidor de Bun, ya escuchando en `127.0.0.1` con un puerto libre elegido por el sistema.
 */
function fixtureReleaseServer(artifact: string, fixturePath: string) {
  const digest = sha256(fixturePath);
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      // La ruta decide el escenario: `/mismatch/...` cambia la huella y `/unsafe-assets/...` cambia hacia dónde apuntan los archivos.
      const mismatch = url.pathname.startsWith("/mismatch/");
      const unsafeAssets = url.pathname.startsWith("/unsafe-assets/");
      const prefix = mismatch ? "/mismatch" : "/good";
      const baseUrl = `http://${url.host}${prefix}`;
      const assetBaseUrl = unsafeAssets ? "https://127.0.0.1:1" : baseUrl;
      // Metadatos de la versión: los pide el instalador tanto para `latest` como para una etiqueta (`/releases/tags/...`).
      if (url.pathname.endsWith("/releases/latest") || url.pathname.includes("/releases/tags/")) {
        return Response.json({
          tag_name: releaseTag,
          assets: [
            { name: "SHA256SUMS", browser_download_url: `${assetBaseUrl}/download/SHA256SUMS` },
            { name: artifact, browser_download_url: `${assetBaseUrl}/download/${artifact}` },
          ],
        });
      }
      // Archivo de sumas: una línea `<huella>  <nombre>`; con `/mismatch/` la huella son 64 ceros y nunca coincide.
      if (url.pathname.endsWith("/download/SHA256SUMS")) {
        return new Response(`${mismatch ? "0".repeat(64) : digest}  ${artifact}\n`);
      }
      if (url.pathname.endsWith(`/download/${artifact}`)) return new Response(readFileSync(fixturePath));
      return new Response("not found", { status: 404 });
    },
  });
}

/**
 * Arma un entorno de prueba completo: una carpeta raíz, un HOME falso dentro de ella, el binario de mentira, el
 * archivo donde el doble del instalador de Engines anota sus corridas y un servidor de releases ya funcionando.
 *
 * @returns La carpeta raíz, el HOME, la ruta del marcador, el servidor (que la prueba debe detener), `base` (la dirección de releases correcta, bajo `/good`) y `forge` (la carpeta `<home>/.forge614` donde debería instalarse todo).
 */
function sandbox() {
  const root = temporaryDirectory();
  const home = join(root, "home");
  const fixture = join(root, "fixture-binary");
  const marker = join(root, "engines-installer-runs.log");
  mkdirSync(home, { recursive: true });
  writeFileSync(fixture, fixtureBytes);
  const server = fixtureReleaseServer(targetArtifact(), fixture);
  return { root, home, marker, server, base: `${server.url}good`, forge: join(home, ".forge614") };
}

/**
 * Cuenta cuántas veces corrió el doble del instalador de Engines, que anota una línea por corrida.
 *
 * @param marker Archivo donde el doble anota sus corridas; puede no existir si nunca corrió.
 * @returns El número de líneas no vacías del archivo, o 0 si no existe.
 */
function enginesInstallerRuns(marker: string): number {
  return existsSync(marker) ? readFileSync(marker, "utf8").split("\n").filter(Boolean).length : 0;
}

/**
 * Comprueba la instalación limpia, con un Engines compatible ya puesto: el binario queda en la carpeta de su versión
 * con permisos 755, el comando activo es un enlace simbólico (un acceso directo del sistema de archivos) hacia él, y
 * `workers` y `workers/bin` quedan con permisos 700. Importa porque es el camino normal de quien instala por primera vez.
 */
test("clean install: version folder, active link and locked-down folders", async () => {
  const { home, forge, server, base } = sandbox();
  installFakeEngines(home, compatibleEngines);
  try {
    const result = await runInstaller([], { home, releaseBaseUrl: base });
    const command = join(forge, "workers", releaseVersion, "forge614-workers");
    const link = join(forge, "workers", "bin", "forge614-workers");

    expect(result.exitCode, result.stderr).toBe(0);
    expect(readFileSync(command, "utf8")).toBe(fixtureBytes);
    expect(statSync(command).mode & 0o777).toBe(0o755);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(command);
    expect(statSync(join(forge, "workers")).mode & 0o777).toBe(0o700);
    expect(statSync(join(forge, "workers", "bin")).mode & 0o777).toBe(0o700);
    expect(result.stdout).toContain("Installed Forge614 Workers v1.0.0");
  } finally {
    server.stop(true);
  }
});

/**
 * Comprueba que `--version v1.0.0` pide la versión por su etiqueta (la ruta `/releases/tags/...` del servidor) y deja
 * instalada esa carpeta de versión. Importa porque es la única forma de fijar una versión en vez de tomar la última.
 */
test("--version selects a release by tag", async () => {
  const { home, forge, server, base } = sandbox();
  installFakeEngines(home, compatibleEngines);
  try {
    const result = await runInstaller(["--version", releaseTag], { home, releaseBaseUrl: base });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(existsSync(join(forge, "workers", releaseVersion, "forge614-workers"))).toBe(true);
  } finally {
    server.stop(true);
  }
});

/**
 * Instala, cambia a mano el binario por un script marcado y vuelve a correr sin `--force`: comprueba que sale con 0,
 * dice `already active` y deja el binario marcado sin tocar. Importa porque repetir el comando no debe pisar la instalación activa.
 */
test("reinstalling the same version without --force reports it is already active", async () => {
  const { home, forge, server, base } = sandbox();
  installFakeEngines(home, compatibleEngines);
  try {
    await runInstaller([], { home, releaseBaseUrl: base });
    const command = join(forge, "workers", releaseVersion, "forge614-workers");
    writeFileSync(command, "#!/usr/bin/env sh\necho marker\n");

    const second = await runInstaller([], { home, releaseBaseUrl: base });

    expect(second.exitCode, second.stderr).toBe(0);
    expect(second.stdout).toContain("already active");
    expect(readFileSync(command, "utf8")).toBe("#!/usr/bin/env sh\necho marker\n");
  } finally {
    server.stop(true);
  }
});

/**
 * Instala, cambia el binario por un script `tampered` (alterado) y vuelve a correr con `--force`: comprueba que sale con 0,
 * imprime `Installed Forge614 Workers`, restaura el contenido original y el enlace sigue apuntando a ese comando.
 * Importa porque `--force` es lo que usa `update` para reinstalar encima de cualquier cosa.
 */
test("--force replaces the installed binary of the same version", async () => {
  const { home, forge, server, base } = sandbox();
  installFakeEngines(home, compatibleEngines);
  try {
    await runInstaller([], { home, releaseBaseUrl: base });
    const command = join(forge, "workers", releaseVersion, "forge614-workers");
    writeFileSync(command, "#!/usr/bin/env sh\necho tampered\n");

    const forced = await runInstaller(["--force"], { home, releaseBaseUrl: base });

    expect(forced.exitCode, forced.stderr).toBe(0);
    expect(forced.stdout).toContain("Installed Forge614 Workers");
    expect(readFileSync(command, "utf8")).toBe(fixtureBytes);
    expect(readlinkSync(join(forge, "workers", "bin", "forge614-workers"))).toBe(command);
  } finally {
    server.stop(true);
  }
});

/**
 * Sin ningún Engines instalado y con un doble de su instalador que deja uno compatible: comprueba que el doble corre
 * exactamente una vez, que el Engines queda en `engines/bin` y que Workers se instala después. Importa porque
 * Workers no puede quedar instalado sin el Engines del que depende.
 */
test("installs Engines when it is missing, checks it again and then installs Workers", async () => {
  const { root, home, forge, marker, server, base } = sandbox();
  const enginesInstaller = join(root, "engines-install.sh");
  writeEnginesInstaller(enginesInstaller, marker, compatibleEngines);
  try {
    const result = await runInstaller([], { home, releaseBaseUrl: base, enginesInstaller });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(enginesInstallerRuns(marker)).toBe(1);
    expect(existsSync(join(forge, "engines", "bin", "forge614-engines"))).toBe(true);
    expect(existsSync(join(forge, "workers", "bin", "forge614-workers"))).toBe(true);
  } finally {
    server.stop(true);
  }
});

/**
 * Con un Engines 1.16.0 ya instalado y un doble que deja 1.17.0: comprueba que el doble corre una vez, que el Engines
 * del disco pasa a decir `1.17.0` y que Workers se instala. Importa porque una versión instalada pero antigua debe actualizarse.
 */
test("replaces an Engines older than 1.17.0 when its installer fixes it", async () => {
  const { root, home, forge, marker, server, base } = sandbox();
  installFakeEngines(home, { version: "1.16.0", supportsReadOnly: true });
  const enginesInstaller = join(root, "engines-install.sh");
  writeEnginesInstaller(enginesInstaller, marker, compatibleEngines);
  try {
    const result = await runInstaller([], { home, releaseBaseUrl: base, enginesInstaller });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(enginesInstallerRuns(marker)).toBe(1);
    expect(readFileSync(join(forge, "engines", "bin", "forge614-engines"), "utf8")).toContain("1.17.0");
    expect(existsSync(join(forge, "workers", "bin", "forge614-workers"))).toBe(true);
  } finally {
    server.stop(true);
  }
});

/**
 * Prueba dos Engines que no sirven (versión 1.16.0, o 1.17.0 sin bloqueo de solo lectura) cuyo doble de instalador deja
 * el mismo Engines inservible: comprueba que sale con error, que el doble corrió una vez, que el mensaje dice `Forge614 Workers was not installed`
 * con el comando para instalar Engines, y que no se crea la carpeta `workers`. Importa porque nunca debe quedar Workers sin un Engines que garantice solo lectura.
 */
test.each([
  ["is older than 1.17.0", { version: "1.16.0", supportsReadOnly: true }],
  ["does not guarantee the read-only lock", { version: "1.17.0", supportsReadOnly: false }],
])("installs nothing of Workers when Engines %s and cannot be fixed", async (_description, engines) => {
  const { root, home, forge, marker, server, base } = sandbox();
  installFakeEngines(home, engines);
  const enginesInstaller = join(root, "engines-install.sh");
  writeEnginesInstaller(enginesInstaller, marker, engines);
  try {
    const result = await runInstaller([], { home, releaseBaseUrl: base, enginesInstaller });

    expect(result.exitCode).not.toBe(0);
    expect(enginesInstallerRuns(marker)).toBe(1);
    expect(result.stderr).toContain("Forge614 Workers was not installed");
    expect(result.stderr).toContain("curl -fsSL https://github.com/jotredev/forge614-engines/releases/latest/download/install.sh | bash");
    expect(existsSync(join(forge, "workers"))).toBe(false);
  } finally {
    server.stop(true);
  }
});

/**
 * Sin Engines instalado y con un doble de su instalador que sale con código 1: comprueba que el instalador de Workers
 * sale con error, dice `Forge614 Workers was not installed` y no crea la carpeta `workers`. Importa porque un fallo
 * al instalar Engines debe detener todo, no dejar Workers a medias.
 */
test("installs nothing of Workers when the Engines installer fails", async () => {
  const { root, home, forge, marker, server, base } = sandbox();
  const enginesInstaller = join(root, "engines-install-fails.sh");
  writeEnginesInstaller(enginesInstaller, marker, compatibleEngines, 1);
  try {
    const result = await runInstaller([], { home, releaseBaseUrl: base, enginesInstaller });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Forge614 Workers was not installed");
    expect(existsSync(join(forge, "workers"))).toBe(false);
  } finally {
    server.stop(true);
  }
});

/**
 * Con el servidor de la ruta `/mismatch` (que publica 64 ceros como huella): comprueba que sale con error, dice
 * `Checksum verification failed`, el doble del instalador de Engines no corre y ni siquiera existe la carpeta
 * `.forge614`. Importa porque la huella se verifica antes de instalar Engines y antes de crear nada en disco.
 */
test("a checksum mismatch installs nothing, not even Engines", async () => {
  const { root, home, forge, marker, server } = sandbox();
  const enginesInstaller = join(root, "engines-install.sh");
  writeEnginesInstaller(enginesInstaller, marker, compatibleEngines);
  try {
    const result = await runInstaller([], { home, releaseBaseUrl: `${server.url}mismatch`, enginesInstaller });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Checksum verification failed");
    expect(enginesInstallerRuns(marker)).toBe(0);
    expect(existsSync(forge)).toBe(false);
  } finally {
    server.stop(true);
  }
});

/**
 * Deja cinco archivos de perfil de shell (los que cargan zsh, bash y fish al abrir una terminal) con texto ajeno y
 * corre el instalador con `--force` como zsh, bash y fish: comprueba que cada corrida sale con 0 y dice `not added to PATH`
 * (PATH es la lista de carpetas donde la terminal busca programas), que los perfiles no cambian y que el HOME y `.forge614`
 * contienen solo lo esperado. Importa porque Workers es una dependencia interna y no debe tocar el entorno del usuario.
 */
test("leaves the PATH and the shell profile files untouched", async () => {
  const { home, forge, server, base } = sandbox();
  installFakeEngines(home, compatibleEngines);
  const profileFiles = [".zshrc", ".bashrc", ".bash_profile", ".profile", ".config/fish/conf.d/forge614-workers.fish"];
  for (const profileFile of profileFiles) {
    const path = join(home, profileFile);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `unrelated ${profileFile}\n`);
  }
  try {
    for (const shell of ["/bin/zsh", "/bin/bash", "/usr/bin/fish"]) {
      const result = await runInstaller(["--force"], { home, releaseBaseUrl: base, shell });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain("not added to PATH");
    }
    for (const profileFile of profileFiles) {
      expect(readFileSync(join(home, profileFile), "utf8")).toBe(`unrelated ${profileFile}\n`);
    }
    // Lo único que debe haber en el HOME son los cinco perfiles (con `.config` que contiene el de fish) y `.forge614`.
    expect(readdirSync(home).sort()).toEqual([".bash_profile", ".bashrc", ".config", ".forge614", ".profile", ".zshrc"]);
    expect(readdirSync(forge).sort()).toEqual(["engines", "workers"]);
  } finally {
    server.stop(true);
  }
});

/**
 * Prepara una instalación vieja (carpeta `0.9.0` y un enlace relativo `../0.9.0/forge614-workers`) y corre el instalador:
 * comprueba que el enlace pasa a apuntar a la ruta absoluta de la versión nueva y que el binario viejo queda con su texto original.
 * Importa porque el enlace se reemplaza, no se escribe a través de él, y la versión anterior se conserva.
 */
test("takes over an existing relative link and keeps the old version folder", async () => {
  const { home, forge, server, base } = sandbox();
  installFakeEngines(home, compatibleEngines);
  const oldCommand = join(forge, "workers", "0.9.0", "forge614-workers");
  mkdirSync(dirname(oldCommand), { recursive: true });
  writeFileSync(oldCommand, "#!/usr/bin/env sh\necho old\n");
  mkdirSync(join(forge, "workers", "bin"), { recursive: true });
  symlinkSync("../0.9.0/forge614-workers", join(forge, "workers", "bin", "forge614-workers"));
  try {
    const result = await runInstaller([], { home, releaseBaseUrl: base });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(readlinkSync(join(forge, "workers", "bin", "forge614-workers"))).toBe(join(forge, "workers", releaseVersion, "forge614-workers"));
    expect(readFileSync(oldCommand, "utf8")).toBe("#!/usr/bin/env sh\necho old\n");
  } finally {
    server.stop(true);
  }
});

/**
 * Pone un archivo normal (no un enlace) en la ruta del comando activo: comprueba que sin `--force` el instalador falla,
 * deja el archivo intacto y no crea la carpeta de la versión, y que con `--force` termina con 0 y lo convierte en enlace.
 * Importa porque no se pisa en silencio un comando que el usuario puso a mano.
 */
test("refuses to replace a regular file at the active path without --force", async () => {
  const { home, forge, server, base } = sandbox();
  installFakeEngines(home, compatibleEngines);
  const link = join(forge, "workers", "bin", "forge614-workers");
  mkdirSync(dirname(link), { recursive: true });
  writeFileSync(link, "#!/usr/bin/env sh\necho plain\n");
  try {
    const refused = await runInstaller([], { home, releaseBaseUrl: base });
    expect(refused.exitCode).not.toBe(0);
    expect(readFileSync(link, "utf8")).toBe("#!/usr/bin/env sh\necho plain\n");
    expect(existsSync(join(forge, "workers", releaseVersion))).toBe(false);

    const forced = await runInstaller(["--force"], { home, releaseBaseUrl: base });
    expect(forced.exitCode, forced.stderr).toBe(0);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  } finally {
    server.stop(true);
  }
});

/**
 * Prueba tres direcciones de releases inaceptables: una HTTPS, una con usuario (`127.0.0.1:5432@localhost:1`, donde
 * lo que parece el puerto es en realidad parte del usuario) y una de loopback sin la marca de pruebas. Comprueba que
 * cada una sale con error y su mensaje (`test release endpoint must be a loopback HTTP URL` o `reserved for test fixtures`),
 * y que no se crea `.forge614`. Importa porque este punto de entrada solo existe para pruebas y no debe poder usarse para engañar al instalador.
 */
test.each([
  ["an HTTPS endpoint", "https://127.0.0.1:1", true, "test release endpoint must be a loopback HTTP URL"],
  ["a userinfo endpoint", "http://127.0.0.1:5432@localhost:1", true, "test release endpoint must be a loopback HTTP URL"],
  ["a loopback endpoint without the test sentinel", "http://127.0.0.1:1", false, "reserved for test fixtures"],
])("rejects %s before downloading", async (_description, releaseBaseUrl, includeTestSentinel, message) => {
  const { home, forge, server } = sandbox();
  try {
    const result = await runInstaller([], { home, releaseBaseUrl, includeTestSentinel });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(existsSync(forge)).toBe(false);
  } finally {
    server.stop(true);
  }
});

/**
 * Usa la ruta `/unsafe-assets` del servidor, cuyos metadatos apuntan los archivos a una dirección HTTPS que no es de
 * loopback: comprueba que sale con error, dice `unsafe test fixture URL` y no crea `.forge614`. Importa porque en modo
 * de pruebas los archivos a descargar también deben ser locales, no solo los metadatos.
 */
test("rejects non-loopback release asset URLs from a test fixture", async () => {
  const { home, forge, server } = sandbox();
  try {
    const result = await runInstaller([], { home, releaseBaseUrl: `${server.url}unsafe-assets` });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("unsafe test fixture URL");
    expect(existsSync(forge)).toBe(false);
  } finally {
    server.stop(true);
  }
});

/**
 * Arma el entorno a mano, sin `runInstaller` (que siempre antepone `file://`), para pasar como instalador de Engines
 * la dirección `https://example.invalid/install.sh` con Engines sin instalar: comprueba que sale con error, dice
 * `must be a local file URL` y no crea `workers`. Importa porque la excepción de pruebas del instalador de Engines solo admite archivos locales.
 */
test("rejects a non-file Engines installer override", async () => {
  const { home, forge, server, base } = sandbox();
  try {
    const env = { ...process.env, HOME: home, [testReleaseBaseUrl]: base, [testMode]: "1", [enginesInstallerTestUrl]: "https://example.invalid/install.sh" } as Record<string, string>;
    delete env.FORGE614_HOME;
    const child = Bun.spawn(["/usr/bin/env", "bash", installer], { env, stdout: "pipe", stderr: "pipe" });
    const exitCode = await child.exited;
    const stderr = await new Response(child.stderr).text();

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("must be a local file URL");
    expect(existsSync(join(forge, "workers"))).toBe(false);
  } finally {
    server.stop(true);
  }
});

/**
 * Corre con `FORGE614_HOME` apuntando a una carpeta absoluta que ya trae un Engines compatible: comprueba que el binario
 * y el enlace quedan allí y que no existe `<home>/.forge614`. Importa porque quien cambia `FORGE614_HOME` espera que todo vaya a esa carpeta y nada a la de por defecto.
 */
test("honours an absolute FORGE614_HOME instead of the default folder", async () => {
  const { root, home, forge, server, base } = sandbox();
  const forgeHome = join(root, "custom-forge-home");
  const enginesPath = join(forgeHome, "engines", "bin", "forge614-engines");
  mkdirSync(dirname(enginesPath), { recursive: true });
  writeFileSync(enginesPath, fakeEnginesScript(compatibleEngines));
  chmodSync(enginesPath, 0o755);
  try {
    const result = await runInstaller([], { home, releaseBaseUrl: base, forgeHome });
    const command = join(forgeHome, "workers", releaseVersion, "forge614-workers");
    const link = join(forgeHome, "workers", "bin", "forge614-workers");

    expect(result.exitCode, result.stderr).toBe(0);
    expect(readFileSync(command, "utf8")).toBe(fixtureBytes);
    expect(readlinkSync(link)).toBe(command);
    expect(existsSync(forge)).toBe(false);
  } finally {
    server.stop(true);
  }
});

/**
 * Corre con `FORGE614_HOME` igual a una ruta relativa: comprueba que sale con error y dice
 * `FORGE614_HOME must be an absolute path.`, que no se crea ni `.forge614` ni la carpeta relativa (respecto al directorio
 * actual) y que el HOME queda vacío. Importa porque una ruta relativa cambiaría de lugar según desde dónde se ejecute, y la validación ocurre antes de crear nada.
 */
test("rejects a relative FORGE614_HOME and creates nothing", async () => {
  const { home, forge, server, base } = sandbox();
  const relativeHome = "relative-forge614-home-for-test";
  try {
    const result = await runInstaller([], { home, releaseBaseUrl: base, forgeHome: relativeHome });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("FORGE614_HOME must be an absolute path.");
    expect(existsSync(forge)).toBe(false);
    expect(existsSync(resolve(relativeHome))).toBe(false);
    expect(readdirSync(home)).toEqual([]);
  } finally {
    server.stop(true);
  }
});

/**
 * Comprueba que `--help` sale con 0 e imprime `Usage: bash scripts/install.sh` y el requisito `1.17.0` de Engines.
 * Importa porque la ayuda es lo que se lee antes de instalar y debe decir qué versión de Engines se necesita.
 */
test("--help prints the usage and exits 0", async () => {
  const { home, server, base } = sandbox();
  try {
    const result = await runInstaller(["--help"], { home, releaseBaseUrl: base });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain("Usage: bash scripts/install.sh");
    expect(result.stdout).toContain("1.17.0");
  } finally {
    server.stop(true);
  }
});
