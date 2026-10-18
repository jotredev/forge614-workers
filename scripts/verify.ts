/** Verifica Workers en un entorno temporal con la versión fijada de Engines. */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/** Versión mínima de Engines cuya superficie de capacidades comprueba Workers. */
const ENGINES_VERSION = "1.17.0";

/** Devuelve el nombre del asset de Engines correspondiente a esta máquina. */
function targetForHost(): string {
  const os = process.platform === "darwin" ? "darwin" : process.platform;
  const arch = process.arch;
  if ((os === "darwin" || os === "linux") && (arch === "arm64" || arch === "x64")) {
    return `${os}-${arch}`;
  }
  if (os === "win32" && arch === "x64") return "windows-x64";
  throw new Error(`No hay un asset de Engines para ${process.platform}-${process.arch}.`);
}

/** Descarga y verifica el asset de Engines fijado, y lo extrae en el directorio temporal. */
async function prepareEngines(directory: string): Promise<string> {
  const target = targetForHost();
  const archiveName = `forge614-engines-${ENGINES_VERSION}-${target}.tar.gz`;
  const base = `https://github.com/jotredev/forge614-engines/releases/download/v${ENGINES_VERSION}`;
  const archiveResponse = await fetch(`${base}/${archiveName}`);
  if (!archiveResponse.ok) throw new Error(`No se pudo descargar Engines: HTTP ${archiveResponse.status}.`);
  const archive = Buffer.from(await archiveResponse.arrayBuffer());
  const checksumResponse = await fetch(`${base}/${archiveName}.sha256`);
  if (!checksumResponse.ok) throw new Error(`No se pudo descargar el checksum de Engines: HTTP ${checksumResponse.status}.`);
  const checksum = (await checksumResponse.text()).trim().split(/\s+/)[0];
  const actual = createHash("sha256").update(archive).digest("hex");
  if (!checksum || actual !== checksum.toLowerCase()) throw new Error("El checksum del asset de Engines no coincide.");

  const archivePath = join(directory, archiveName);
  await writeFile(archivePath, archive);
  const extracted = spawnSync("tar", ["-xzf", archivePath, "-C", directory], { stdio: "inherit" });
  if (extracted.status !== 0) throw new Error("No se pudo extraer el asset de Engines.");
  const binaryName = process.platform === "win32" ? "forge614-engines.exe" : "forge614-engines";
  return join(directory, `forge614-engines-${ENGINES_VERSION}-${target}`, binaryName);
}

/** Ejecuta un comando y devuelve si terminó con código cero. */
function run(command: string[]): boolean {
  const result = spawnSync(command[0]!, command.slice(1), { stdio: "inherit", env: process.env });
  return result.status === 0;
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "forge614-workers-verify-"));
try {
  const enginesBin = await prepareEngines(temporaryRoot);
  const isolatedHome = join(temporaryRoot, "home");
  const isolatedForgeHome = join(isolatedHome, ".forge614");
  await mkdir(isolatedForgeHome, { recursive: true });
  process.env.HOME = isolatedHome;
  process.env.USERPROFILE = isolatedHome;
  process.env.FORGE614_HOME = isolatedForgeHome;
  process.env.FORGE614_ENGINES_BIN = enginesBin;

  if (!run(["bun", "test"])) process.exitCode = 1;
  else if (!run(["bun", "run", "typecheck"])) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
