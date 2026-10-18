/** Prueba instalación, migración, actualización y retirada completas mediante un servidor local. */
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const ROOT = join(import.meta.dir, "..", "..");
const INSTALL_SH = join(ROOT, "install.sh");
const INSTALL_MJS = join(ROOT, "install.mjs");
const MAIN = join(ROOT, "src", "main.ts");

/** Crea una publicación local con activos sin red externa y SHA256SUMS GNU. */
function serveRelease() {
  const pointerBytes = readFileSync(join(ROOT, "forge614.node.json"));
  const installerBytes = readFileSync(INSTALL_MJS);
  const tags = new Map([
    ["v1.1.0", binaryForVersion("1.1.0")],
    ["v1.1.1", binaryForVersion("1.1.1")],
  ]);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/releases/latest")) return Response.json({ tag_name: "v1.1.1" });
      const match = /\/releases\/download\/(v1\.1\.\d+)\/([^/]+)$/.exec(path);
      if (!match) return new Response("missing", { status: 404 });
      const [, tag, name] = match;
      const binary = tags.get(tag!);
      if (!binary) return new Response("missing", { status: 404 });
      const assetName = programName();
      const assets = new Map<string, Uint8Array>([
        ["install.sh", readFileSync(join(ROOT, "install.sh"))],
        ["install.ps1", readFileSync(join(ROOT, "install.ps1"))],
        ["install.mjs", installerBytes],
        ["forge614.node.json", pointerBytes],
        [assetName, binary],
      ]);
      const sums = [...assets].map(([file, bytes]) => `${digest(bytes)}  ${file}\n`).join("");
      if (name === "SHA256SUMS") return new Response(sums);
      const asset = assets.get(name!);
      if (asset) return new Response(asset);
      return new Response("missing", { status: 404 });
    },
  });
  return { server, baseUrl: `http://127.0.0.1:${server.port}` };
}

/** Crea un lanzador de shell mínimo que responde a versión y a la retirada propia. */
function binaryForVersion(version: string): Uint8Array {
  return new TextEncoder().encode(`#!/bin/sh\nif [ "$1" = --version ]; then echo 'forge614-workers ${version}'; exit 0; fi\nif [ "$1" = uninstall ] && [ "$2" = --self ]; then echo '{"schemaVersion":1,"result":{"integrationsRemoved":true}}'; exit 0; fi\nexit 0\n`);
}

/** Resuelve el nombre del activo binario para esta plataforma Unix. */
function programName(): string {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `forge614-workers-${os}-${arch}`;
}

/** Calcula la huella SHA-256 en minúsculas para el manifiesto local. */
function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Ejecuta el portero Unix o Workers con carpetas aisladas y captura sus salidas. */
async function run(command: string[], env: Record<string, string>, cwd?: string): Promise<{ stdout: string; stderr: string; status: number }> {
  const process = Bun.spawn(command, { cwd, env: { ...globalThis.process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, status] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, status };
}

describe("Workers installer end-to-end", () => {
  test.skipIf(process.platform === "win32")("installs, migrates 1.0.2, updates to 1.1.1 and uninstalls without touching Engines", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge614-workers-release-e2e-"));
    const forgeHome = join(root, ".forge614");
    const workers = join(forgeHome, "workers");
    const oldVersion = join(workers, "1.0.2");
    const bin = join(workers, "bin");
    const enginesBin = join(forgeHome, "engines", "bin");
    const release = serveRelease();
    const env = { HOME: root, FORGE614_HOME: forgeHome, FORGE614_INSTALL_TEST_BASE_URL: release.baseUrl };
    try {
      mkdirSync(join(oldVersion, "bin"), { recursive: true });
      mkdirSync(bin, { recursive: true });
      mkdirSync(enginesBin, { recursive: true });
      writeFileSync(join(oldVersion, "bin", "forge614-workers"), binaryForVersion("1.0.2"));
      symlinkSync(join(oldVersion, "bin", "forge614-workers"), join(bin, "forge614-workers"));
      const engines = join(enginesBin, "forge614-engines");
      writeFileSync(engines, "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 'forge614-engines 1.17.0'; else echo '{\"schemaVersion\":1,\"supportsReadOnly\":true}'; fi\n");
      chmodSync(engines, 0o755);

      const install = await run(["bash", INSTALL_SH, "--version", "v1.1.0", "--force"], env);
      expect(install.status).toBe(0);
      expect(install.stderr).toBe("");
      expect(readFileSync(join(workers, ".active-version"), "utf8").trim()).toBe("1.1.0");
      expect(readFileSync(join(bin, "forge614-workers"), "utf8")).toContain("1.1.0");
      expect(readdirSync(workers).some((entry) => entry.startsWith("legacy-"))).toBe(true);
      expect(existsSync(oldVersion)).toBe(true);
      expect(existsSync(engines)).toBe(true);

      const update = await run(["bun", MAIN, "update", "--json"], env);
      expect(update.status).toBe(0);
      expect(JSON.parse(update.stdout.trim())).toEqual({ schemaVersion: 1, updated: true, previousVersion: "1.1.0", installedVersion: "1.1.1" });
      expect(readFileSync(join(workers, ".active-version"), "utf8").trim()).toBe("1.1.1");

      const uninstall = await run(["bun", MAIN, "uninstall", "--json"], env, root);
      expect(uninstall.status).toBe(0);
      expect(JSON.parse(uninstall.stdout.trim())).toEqual({ schemaVersion: 1, result: { removed: true } });
      expect(existsSync(workers)).toBe(false);
      expect(existsSync(engines)).toBe(true);
    } finally {
      release.server.stop(true);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
