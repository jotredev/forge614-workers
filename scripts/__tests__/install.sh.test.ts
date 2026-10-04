/**
 * Exercises `scripts/install.sh` end to end in disposable sandboxes: a temporary HOME, a loopback
 * server standing in for the GitHub release API, and local doubles for Forge614 Engines and its
 * installer. The real HOME, the real `~/.forge614` and the network are never touched.
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

/** Describes how a fake Forge614 Engines behaves: its version and whether it guarantees the read-only lock. */
interface FakeEngines {
  version: string;
  supportsReadOnly: boolean;
}

const compatibleEngines: FakeEngines = { version: "1.17.0", supportsReadOnly: true };

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

/** Creates a disposable directory removed after the test. */
function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "forge614-workers-installer-"));
  temporaryDirectories.push(directory);
  return directory;
}

/** Gives the release artifact name of the machine running the tests. */
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

/** Computes the SHA-256 of a file as lowercase hexadecimal. */
function sha256(path: string): string {
  return new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");
}

/** Writes the script of a fake `forge614-engines` that answers only `--version` and `capabilities`. */
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

/** Places a fake Engines where the installer looks for it inside `home`. */
function installFakeEngines(home: string, engines: FakeEngines): string {
  const path = join(home, ".forge614", "engines", "bin", "forge614-engines");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, fakeEnginesScript(engines));
  chmodSync(path, 0o755);
  return path;
}

/**
 * Writes a stand-in for the Engines installer. It records each run in `marker` and, unless `exitCode`
 * is non-zero, leaves a fake Engines (described by `installs`) where the real one would go.
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

/** Options of one installer run. */
interface RunOptions {
  home: string;
  releaseBaseUrl: string;
  enginesInstaller?: string;
  shell?: string;
  includeTestSentinel?: boolean;
  forgeHome?: string;
}

/** Runs the installer with a sandboxed environment (temporary HOME, FORGE614_HOME only when `forgeHome` is given, test endpoints). */
async function runInstaller(args: string[], options: RunOptions): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const env: Record<string, string | undefined> = { ...process.env, HOME: options.home, SHELL: options.shell ?? "/bin/zsh" };
  delete env.FORGE614_HOME;
  if (options.forgeHome !== undefined) env.FORGE614_HOME = options.forgeHome;
  delete env[enginesInstallerTestUrl];
  env[testReleaseBaseUrl] = options.releaseBaseUrl;
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
 * Starts a loopback server that mimics the GitHub release API for one release. Paths under `/mismatch/`
 * publish a wrong digest and paths under `/unsafe-assets/` point the assets at a non-loopback HTTPS URL.
 */
function fixtureReleaseServer(artifact: string, fixturePath: string) {
  const digest = sha256(fixturePath);
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const mismatch = url.pathname.startsWith("/mismatch/");
      const unsafeAssets = url.pathname.startsWith("/unsafe-assets/");
      const prefix = mismatch ? "/mismatch" : "/good";
      const baseUrl = `http://${url.host}${prefix}`;
      const assetBaseUrl = unsafeAssets ? "https://127.0.0.1:1" : baseUrl;
      if (url.pathname.endsWith("/releases/latest") || url.pathname.includes("/releases/tags/")) {
        return Response.json({
          tag_name: releaseTag,
          assets: [
            { name: "SHA256SUMS", browser_download_url: `${assetBaseUrl}/download/SHA256SUMS` },
            { name: artifact, browser_download_url: `${assetBaseUrl}/download/${artifact}` },
          ],
        });
      }
      if (url.pathname.endsWith("/download/SHA256SUMS")) {
        return new Response(`${mismatch ? "0".repeat(64) : digest}  ${artifact}\n`);
      }
      if (url.pathname.endsWith(`/download/${artifact}`)) return new Response(readFileSync(fixturePath));
      return new Response("not found", { status: 404 });
    },
  });
}

/** Builds a sandbox: a root folder, a fake HOME, the fixture binary and a running release server. */
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

/** Counts how many times the Engines installer double ran. */
function enginesInstallerRuns(marker: string): number {
  return existsSync(marker) ? readFileSync(marker, "utf8").split("\n").filter(Boolean).length : 0;
}

/** A clean install puts the binary in a version folder and links it as the active command. */
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

/** Installing a release by tag works the same as `latest`. */
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

/** Running the same version again without --force changes nothing and says it is already active. */
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

/** --force reinstalls the same version over whatever is there. */
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

/** A missing Engines is installed first and checked again before Workers is placed. */
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

/** An Engines that is too old is replaced by the latest one when its installer fixes it. */
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

/** If Engines is old or lacks the read-only lock and cannot be fixed, nothing of Workers is installed. */
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

/** An Engines installer that fails leaves Workers untouched. */
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

/** A wrong digest stops everything: no Workers folder and no Engines installation either. */
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

/** The installer never edits shell profiles or adds anything to PATH (Workers is an internal dependency). */
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
    expect(readdirSync(home).sort()).toEqual([".bash_profile", ".bashrc", ".config", ".forge614", ".profile", ".zshrc"]);
    expect(readdirSync(forge).sort()).toEqual(["engines", "workers"]);
  } finally {
    server.stop(true);
  }
});

/** The layout already on the first Mac (an old version folder and a relative link) is taken over without writing through the link. */
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

/** A plain file in the place of the link is only replaced when --force asks for it. */
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

/** The test-only release endpoint is refused unless it is loopback HTTP and the test sentinel is set. */
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

/** Release metadata that points assets outside loopback is refused in test mode. */
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

/** The Engines installer override only accepts local files. */
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

/** An absolute FORGE614_HOME moves the whole installation there and leaves `<home>/.forge614` alone. */
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

/** A relative FORGE614_HOME is refused before anything is downloaded or created. */
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

/** The help text runs without network and states the requirement. */
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
