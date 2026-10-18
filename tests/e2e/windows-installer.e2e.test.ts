/** Prueba en Windows la instalación, actualización del ejecutable activo y desinstalación vía publicación local. */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const ROOT = resolve(import.meta.dir, "..", "..");
const DIST = join(ROOT, "dist", "windows-e2e");
const NODE = join(ROOT, "install.mjs");
const MAIN = join(ROOT, "src", "main.ts");

/** Levanta una release local con el ejecutable 1.1.0 y un ejecutable falso 1.1.1 distinto. */
function servePublication() {
  const assetsByTag = new Map<string, Map<string, Uint8Array>>();
  for (const [tag, binaryName] of [["v1.1.0", "forge614-workers-windows-x64.exe"], ["v1.1.1", "forge614-workers-windows-x64.exe"]]) {
    const binaryPath = tag === "v1.1.0" ? join(DIST, "forge614-workers-windows-x64.exe") : join(DIST, "forge614-workers-1.1.1.exe");
    const assets = new Map<string, Uint8Array>([
      ["install.sh", readFileSync(join(ROOT, "install.sh"))],
      ["install.ps1", readFileSync(join(ROOT, "install.ps1"))],
      ["install.mjs", readFileSync(NODE)],
      ["forge614.node.json", readFileSync(join(ROOT, "forge614.node.json"))],
      [binaryName, readFileSync(binaryPath)],
    ]);
    assets.set("SHA256SUMS", new TextEncoder().encode([...assets].map(([name, bytes]) => `${digest(bytes)}  ${name}\n`).join("")));
    assetsByTag.set(tag, assets);
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/releases/latest")) return Response.json({ tag_name: "v1.1.1" });
      const match = /\/releases\/download\/(v1\.1\.\d+)\/([^/]+)$/.exec(path);
      const assets = match ? assetsByTag.get(match[1]!) : undefined;
      const bytes = assets?.get(match?.[2] ?? "");
      return bytes ? new Response(bytes) : new Response("missing", { status: 404 });
    },
  });
  return { server, baseUrl: `http://127.0.0.1:${server.port}` };
}

/** Calcula la huella SHA-256 en minúsculas de un activo de prueba. */
function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Ejecuta un proceso con carpetas HOME aisladas y captura ambas salidas. */
async function run(command: string[], env: Record<string, string>, cwd?: string): Promise<{ stdout: string; stderr: string; status: number }> {
  const child = Bun.spawn(command, { cwd, env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, status };
}

describe("Workers Windows installer end-to-end", () => {
  test.skipIf(process.platform !== "win32")("installs, updates the running bin executable, rejects in-tree uninstall, and removes Workers outside", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge614-workers-windows-e2e-"));
    const forgeHome = join(root, ".forge614");
    const enginesPath = join(forgeHome, "engines", "bin", "forge614-engines.exe");
    const release = servePublication();
    const env = { HOME: root, FORGE614_HOME: forgeHome, FORGE614_INSTALL_TEST_BASE_URL: release.baseUrl };
    try {
      mkdirSync(join(forgeHome, "engines", "bin"), { recursive: true });
      copyFileSync(join(DIST, "forge614-engines.exe"), enginesPath);
      const installer = await run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "install.ps1"), "--version", "v1.1.0"], env, root);
      expect(installer.status).toBe(0);
      expect(installer.stderr).toBe("");

      const launcher = join(forgeHome, "workers", "bin", "forge614-workers.exe");
      expect((await run([launcher, "--version"], env, root)).stdout.trim()).toBe("forge614-workers 1.1.0");
      const update = await run([launcher, "update", "--version", "v1.1.1", "--json"], env, root);
      expect(update.status).toBe(0);
      expect(JSON.parse(update.stdout.trim())).toEqual({ schemaVersion: 1, updated: true, previousVersion: "1.1.0", installedVersion: "1.1.1" });
      expect((await run([launcher, "--version"], env, root)).stdout.trim()).toBe("forge614-workers 1.1.1");
      for (let attempt = 0; attempt < 10 && readdirSync(join(forgeHome, "workers", "bin")).some((name) => name.includes(".old-")); attempt += 1) {
        await Bun.sleep(100);
      }
      expect(readdirSync(join(forgeHome, "workers", "bin")).some((name) => name.includes(".old-"))).toBe(false);

      const workers = join(forgeHome, "workers");
      const inside = await run(["bun", MAIN, "uninstall", "--json"], env, workers);
      expect(inside.status).toBe(1);
      expect(JSON.parse(inside.stderr.trim())).toMatchObject({ schemaVersion: 1, code: "UNINSTALL_FAILED" });
      expect(existsSync(launcher)).toBe(true);

      const outside = await run(["bun", MAIN, "uninstall", "--json"], env, root);
      expect(outside.status).toBe(0);
      expect(JSON.parse(outside.stdout.trim())).toEqual({ schemaVersion: 1, result: { removed: true } });
      expect(existsSync(workers)).toBe(false);
      expect(existsSync(enginesPath)).toBe(true);
    } finally {
      release.server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
