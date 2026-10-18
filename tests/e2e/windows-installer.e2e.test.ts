/** Comprueba en Windows la instalación, actualización y desinstalación mediante la publicación loopback. */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const ROOT = resolve(import.meta.dir, "..", "..");
const DIST = join(ROOT, "dist", "windows-e2e");
const NODE = join(ROOT, "install.mjs");

/** Levanta una publicación local con ejecutables Workers reales para 1.1.0 y 1.1.1. */
function servePublication(options: { noOpUpdate?: boolean } = {}) {
  const assetsByTag = new Map<string, Map<string, Uint8Array>>();
  const requests: string[] = [];
  for (const [tag, binaryName] of [["v1.1.0", "forge614-workers-windows-x64.exe"], ["v1.1.1", "forge614-workers-windows-x64.exe"]]) {
    const binaryPath = tag === "v1.1.0" ? join(DIST, "forge614-workers-windows-x64.exe") : join(DIST, "forge614-workers-1.1.1.exe");
    const assets = new Map<string, Uint8Array>([
      ["install.sh", readFileSync(join(ROOT, "install.sh"))],
      ["install.ps1", readFileSync(join(ROOT, "install.ps1"))],
      ["install.mjs", readFileSync(NODE)],
      ["forge614.node.json", readFileSync(join(ROOT, "forge614.node.json"))],
      [binaryName, readFileSync(binaryPath)],
    ]);
    if (options.noOpUpdate && tag === "v1.1.1") assets.set("install.ps1", new TextEncoder().encode("exit 0\r\n"));
    assets.set("SHA256SUMS", new TextEncoder().encode([...assets].map(([name, bytes]) => `${digest(bytes)}  ${name}\n`).join("")));
    assetsByTag.set(tag, assets);
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(path);
      if (path.endsWith("/releases/latest")) return Response.json({ tag_name: "v1.1.1" });
      const match = /\/releases\/download\/(v1\.1\.\d+)\/([^/]+)$/.exec(path);
      const assets = match ? assetsByTag.get(match[1]!) : undefined;
      const bytes = assets?.get(match?.[2] ?? "");
      return bytes ? new Response(bytes) : new Response("missing", { status: 404 });
    },
  });
  return { server, baseUrl: `http://127.0.0.1:${server.port}`, requests };
}

/** Calcula la huella SHA-256 en minúsculas de un activo de prueba. */
function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Ejecuta un proceso con carpetas HOME aisladas y captura ambas salidas. */
async function run(command: string[], env: Record<string, string>, cwd?: string): Promise<{ stdout: string; stderr: string; status: number }> {
  const child = Bun.spawn(command, { cwd, env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, 110_000);
  try {
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (timedOut) throw new Error(`Process exceeded its 110 s limit: ${command[0]}`);
    return { stdout, stderr, status };
  } finally {
    clearTimeout(timer);
  }
}

/** Prepara HOME y Engines falsos para una prueba end-to-end independiente. */
function createContext(options: { noOpUpdate?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "forge614-workers-windows-e2e-"));
  const forgeHome = join(root, ".forge614");
  const enginesPath = join(forgeHome, "engines", "bin", "forge614-engines.exe");
  const workers = join(forgeHome, "workers");
  const launcher = join(workers, "bin", "forge614-workers.exe");
  const release = servePublication(options);
  mkdirSync(join(forgeHome, "engines", "bin"), { recursive: true });
  copyFileSync(join(DIST, "forge614-engines.exe"), enginesPath);
  return {
    root,
    forgeHome,
    enginesPath,
    workers,
    launcher,
    release,
    env: { HOME: root, FORGE614_HOME: forgeHome, FORGE614_INSTALL_TEST_BASE_URL: release.baseUrl },
  };
}

/** Instala la versión 1.1.0 mediante el portero PowerShell de la publicación local. */
async function installWorkers(context: ReturnType<typeof createContext>): Promise<void> {
  const result = await run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "install.ps1"), "--version", "v1.1.0"], context.env, context.root);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  expect(result.stderr).toBe("");
  expect(existsSync(context.launcher)).toBe(true);
}

/** Sitúa el binario real en su ruta de ejecución instalada para aislar los tests de update y uninstall. */
function prepareInstalledLauncher(context: ReturnType<typeof createContext>): void {
  mkdirSync(join(context.workers, "bin"), { recursive: true });
  copyFileSync(join(DIST, "forge614-workers-windows-x64.exe"), context.launcher);
}

/** Espera sondeando hasta que desaparezcan los .exe que PowerShell borra al salir Workers. */
async function waitForParkedUninstallRemoval(context: ReturnType<typeof createContext>): Promise<void> {
  const deadline = Date.now() + 30_000;
  const parkedFiles = () => readdirSync(context.forgeHome).filter((name) => /^\.forge614-workers-old-.+\.exe$/i.test(name));
  while (parkedFiles().length > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  expect(parkedFiles()).toHaveLength(0);
}

describe("Workers Windows installer end-to-end", () => {
  test.skipIf(process.platform !== "win32")("installs through install.ps1 and reports the installed version", async () => {
    const context = createContext();
    try {
      await installWorkers(context);
      const version = await run([context.launcher, "--version"], context.env, context.root);
      expect(version.status).toBe(0);
      expect(version.stdout.trim()).toBe("forge614-workers 1.1.0");
      expect(existsSync(context.enginesPath)).toBe(true);
    } finally {
      context.release.server.stop(true);
      rmSync(context.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }, 120_000);

  test.skipIf(process.platform !== "win32")("updates from the active executable and cleans its parked image on the next update", async () => {
    const context = createContext();
    try {
      await installWorkers(context);
      const update = await run([context.launcher, "update", "--version", "v1.1.1", "--json"], context.env, context.root);
      expect(update.status, `${update.stdout}\n${update.stderr}`).toBe(0);
      expect(JSON.parse(update.stdout.trim())).toEqual({ schemaVersion: 1, updated: true, previousVersion: "1.1.0", installedVersion: "1.1.1" });
      const version = await run([context.launcher, "--version"], context.env, context.root);
      expect(version.stdout.trim()).toBe("forge614-workers 1.1.1");
      const bin = join(context.forgeHome, "workers", "bin");
      const parkedAfterUpdate = readdirSync(bin).filter((name) => /^forge614-workers\.exe\.old-.+$/.test(name));
      expect(parkedAfterUpdate).toHaveLength(1);
      const firstParkedPath = join(bin, parkedAfterUpdate[0]!);

      const nextUpdate = await run([context.launcher, "update", "--version", "v1.1.1", "--json"], context.env, context.root);
      expect(nextUpdate.status, `${nextUpdate.stdout}\n${nextUpdate.stderr}`).toBe(0);
      expect(JSON.parse(nextUpdate.stdout.trim())).toEqual({ schemaVersion: 1, updated: false, previousVersion: "1.1.1", installedVersion: "1.1.1" });
      expect(existsSync(firstParkedPath)).toBe(false);
      expect((await run([context.launcher, "--version"], context.env, context.root)).stdout.trim()).toBe("forge614-workers 1.1.1");
    } finally {
      context.release.server.stop(true);
      rmSync(context.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }, 120_000);

  test.skipIf(process.platform !== "win32")("reports updated false when the checked local gatekeeper leaves the installed version unchanged", async () => {
    const context = createContext({ noOpUpdate: true });
    try {
      prepareInstalledLauncher(context);
      const update = await run([context.launcher, "update", "--version", "v1.1.1", "--json"], context.env, context.root);
      expect(update.status, `${update.stdout}\n${update.stderr}`).toBe(0);
      expect(JSON.parse(update.stdout.trim())).toEqual({ schemaVersion: 1, updated: false, previousVersion: "1.1.0", installedVersion: "1.1.0" });
      const version = await run([context.launcher, "--version"], context.env, context.root);
      expect(version.stdout.trim()).toBe("forge614-workers 1.1.0");
      expect(readdirSync(join(context.forgeHome, "workers", "bin")).some((name) => name.includes(".old-"))).toBe(false);
      expect(context.release.requests).toContain("/repos/jotredev/forge614-workers/releases/download/v1.1.1/install.ps1");
      expect(context.release.requests).toContain("/repos/jotredev/forge614-workers/releases/download/v1.1.1/SHA256SUMS");
    } finally {
      context.release.server.stop(true);
      rmSync(context.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }, 120_000);

  test.skipIf(process.platform !== "win32")("refuses an in-tree uninstall, then removes Workers from outside", async () => {
    const context = createContext();
    try {
      await installWorkers(context);
      const requestsBeforeInsideUninstall = [...context.release.requests];
      const inside = await run([context.launcher, "uninstall", "--json"], context.env, context.workers);
      expect(inside.status, `${inside.stdout}\n${inside.stderr}`).toBe(1);
      expect(JSON.parse(inside.stderr.trim())).toMatchObject({ schemaVersion: 1, code: "UNINSTALL_FAILED" });
      expect(existsSync(context.launcher)).toBe(true);
      expect(context.release.requests).toEqual(requestsBeforeInsideUninstall);

      const update = await run([context.launcher, "update", "--version", "v1.1.1", "--json"], context.env, context.root);
      expect(update.status, `${update.stdout}\n${update.stderr}`).toBe(0);
      expect(JSON.parse(update.stdout.trim())).toMatchObject({ updated: true, installedVersion: "1.1.1" });
      expect(readdirSync(join(context.forgeHome, "workers", "bin")).filter((name) => name.includes(".old-")).length).toBe(1);

      const outside = await run([context.launcher, "uninstall", "--json"], context.env, context.root);
      expect(outside.status, `${outside.stdout}\n${outside.stderr}`).toBe(0);
      expect(JSON.parse(outside.stdout.trim())).toEqual({ schemaVersion: 1, result: { removed: true } });
      expect(existsSync(context.workers)).toBe(false);
      expect(existsSync(context.enginesPath)).toBe(true);
    } finally {
      await waitForParkedUninstallRemoval(context);
      context.release.server.stop(true);
      rmSync(context.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }, 120_000);
});
