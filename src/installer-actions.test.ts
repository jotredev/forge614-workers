/** Prueba el saneado de errores y las acciones del instalador compartido. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { sameWindowsPath, sanitizeInstallerDetail, uninstallInstalledWorkers, updateInstalledWorkers } from "./installer-actions";

/** Publica una puerta Windows local con su manifiesto GNU para probarla sin red externa. */
function serveWindowsGatekeeper(script: string) {
  const bytes = new TextEncoder().encode(script);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path.endsWith("/releases/latest")) return Response.json({ tag_name: "v1.1.1" });
      if (path.endsWith("/install.ps1")) return new Response(bytes);
      if (path.endsWith("/SHA256SUMS")) return new Response(`${checksum}  install.ps1\n`);
      return new Response("missing", { status: 404 });
    },
  });
  return { server, baseUrl: `http://127.0.0.1:${server.port}` };
}

/** Crea carpetas Workers y Engines aisladas para una acción Windows simulada. */
function fakeHomes(): { root: string; env: Record<string, string>; workers: string; launcher: string; engines: string } {
  const root = mkdtempSync(join(tmpdir(), "forge614-workers-actions-"));
  const forgeHome = join(root, ".forge614");
  const workers = join(forgeHome, "workers");
  const launcher = join(workers, "bin", "forge614-workers.exe");
  const engines = join(forgeHome, "engines", "bin", "forge614-engines.exe");
  mkdirSync(join(workers, "bin"), { recursive: true });
  mkdirSync(join(forgeHome, "engines", "bin"), { recursive: true });
  writeFileSync(launcher, "old workers executable");
  writeFileSync(engines, "shared engines executable");
  return { root, env: { HOME: root, FORGE614_HOME: forgeHome }, workers, launcher, engines };
}

describe("installer actions", () => {
  test("sanitizes local paths while preserving release URLs", () => {
    const detail = "failed at /private/user/home/cache https://github.com/jotredev/forge614-workers/releases/latest";
    expect(sanitizeInstallerDetail(detail, { HOME: "/private/user/home", TMPDIR: "/private/user/home/cache" }, "darwin"))
      .toBe("failed at <ruta> https://github.com/jotredev/forge614-workers/releases/latest");
  });

  test("compares Windows paths case-insensitively after resolving short-path aliases", () => {
    expect(sameWindowsPath("C:\\Users\\RUNNER~1\\forge614", "c:/users/runner.admin/forge614", (path) =>
      path.includes("RUNNER~1") ? "C:\\Users\\runner.admin\\forge614" : path,
    )).toBe(true);
  });

  test("updates the active Windows executable through PowerShell and removes its parked copy", async () => {
    const homes = fakeHomes();
    const release = serveWindowsGatekeeper("# fake installer\n");
    try {
      let invoked: string[] = [];
      const result = await updateInstalledWorkers("1.0.2", {
        env: { ...homes.env, FORGE614_INSTALL_TEST_BASE_URL: release.baseUrl },
        platform: "win32",
        processExecPath: homes.launcher,
        versionTag: "v1.1.1",
        run: (command, args) => {
          invoked = [command, ...args];
          expect(existsSync(homes.launcher)).toBe(false);
          writeFileSync(homes.launcher, "new workers executable");
          return { exitCode: 0, stdout: "", stderr: "" };
        },
        readInstalledVersion: () => "1.1.1",
      });
      expect(invoked.slice(0, 4)).toEqual(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass"]);
      expect(invoked.slice(-2)).toEqual(["--version", "v1.1.1"]);
      expect(result).toEqual({ updated: true, previousVersion: "1.0.2", installedVersion: "1.1.1" });
      expect(existsSync(homes.launcher)).toBe(true);
      expect(readdirSync(join(homes.workers, "bin"))).toEqual(["forge614-workers.exe"]);
    } finally {
      release.server.stop(true);
      rmSync(homes.root, { recursive: true, force: true });
    }
  });

  test("restores the active Windows executable when a successful gatekeeper makes no replacement", async () => {
    const homes = fakeHomes();
    const release = serveWindowsGatekeeper("exit 0\r\n");
    try {
      const result = await updateInstalledWorkers("1.0.2", {
        env: { ...homes.env, FORGE614_INSTALL_TEST_BASE_URL: release.baseUrl },
        platform: "win32",
        processExecPath: homes.launcher,
        versionTag: "v1.1.1",
        run: () => ({ exitCode: 0, stdout: "", stderr: "" }),
        readInstalledVersion: () => {
          if (!existsSync(homes.launcher)) throw new Error("installed launcher was not restored");
          return "1.0.2";
        },
      });

      expect(result).toEqual({ updated: false, previousVersion: "1.0.2", installedVersion: "1.0.2" });
      expect(readFileSync(homes.launcher, "utf8")).toBe("old workers executable");
      expect(readdirSync(join(homes.workers, "bin"))).toEqual(["forge614-workers.exe"]);
    } finally {
      release.server.stop(true);
      rmSync(homes.root, { recursive: true, force: true });
    }
  });

  test("uninstalls from Windows and schedules deletion of its active executable copy", async () => {
    const homes = fakeHomes();
    const release = serveWindowsGatekeeper("# fake installer\n");
    try {
      let scheduled: string[] = [];
      await uninstallInstalledWorkers({
        env: { ...homes.env, FORGE614_INSTALL_TEST_BASE_URL: release.baseUrl },
        platform: "win32",
        processExecPath: homes.launcher,
        processId: 4321,
        run: (_command, args) => {
          expect(args.slice(0, 3)).toEqual(["-NoProfile", "-ExecutionPolicy", "Bypass"]);
          rmSync(homes.workers, { recursive: true, force: true });
          return { exitCode: 0, stdout: "", stderr: "" };
        },
        scheduleDelete: (command, args) => { scheduled = [command, ...args]; },
      });
      expect(existsSync(homes.workers)).toBe(false);
      expect(existsSync(homes.engines)).toBe(true);
      expect(scheduled[0]).toBe("powershell");
      expect(scheduled).toContain("-ExecutionPolicy");
    } finally {
      release.server.stop(true);
      rmSync(homes.root, { recursive: true, force: true });
    }
  });

  test("restores the parked Windows launcher when the gatekeeper leaves a replacement and then fails", async () => {
    const homes = fakeHomes();
    const release = serveWindowsGatekeeper("# fake installer\n");
    try {
      await expect(updateInstalledWorkers("1.0.2", {
        env: { ...homes.env, FORGE614_INSTALL_TEST_BASE_URL: release.baseUrl },
        platform: "win32",
        processExecPath: homes.launcher,
        versionTag: "v1.1.1",
        run: () => {
          writeFileSync(homes.launcher, "partial replacement");
          return { exitCode: 1, stdout: "", stderr: "installer failed" };
        },
      })).rejects.toMatchObject({ code: "UPDATE_FAILED" });
      expect(readFileSync(homes.launcher, "utf8")).toBe("old workers executable");
      expect(readdirSync(join(homes.workers, "bin"))).toEqual(["forge614-workers.exe"]);
    } finally {
      release.server.stop(true);
      rmSync(homes.root, { recursive: true, force: true });
    }
  });
});
