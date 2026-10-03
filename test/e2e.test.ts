import { describe, test, expect } from "bun:test";
import { join } from "node:path";

const MAIN_ENTRY = join(import.meta.dir, "..", "src", "main.ts");
const FIXTURES = join(import.meta.dir, "fixtures");

async function runWorkers(input: string): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", MAIN_ENTRY], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(input);
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

/**
 * Launches Workers with command-line arguments and leaves stdin open without
 * writing to it, as a terminal would. A process that waits for input is killed
 * after `hangAfterMs` and reported as hung, so a regression fails the test
 * instead of freezing the suite.
 */
async function runWorkersWithArgs(
  args: string[],
  hangAfterMs = 3000
): Promise<{ stdout: string; exitCode: number | null; hung: boolean }> {
  const proc = Bun.spawn(["bun", MAIN_ENTRY, ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  let hung = false;
  const timer = setTimeout(() => {
    hung = true;
    proc.kill();
  }, hangAfterMs);
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  clearTimeout(timer);
  return { stdout, exitCode: hung ? null : exitCode, hung };
}

describe("forge614-workers --version and --help", () => {
  test.each(["--version", "-v"])("%s prints the name and version and exits 0 without waiting for stdin", async (flag) => {
    const { stdout, exitCode, hung } = await runWorkersWithArgs([flag]);

    expect(hung).toBe(false);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("forge614-workers 0.1.0\n");
  });

  test.each(["--help", "-h"])("%s prints help that names --version and exits 0 without waiting for stdin", async (flag) => {
    const { stdout, exitCode, hung } = await runWorkersWithArgs([flag]);

    expect(hung).toBe(false);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("forge614-workers");
    expect(stdout).toContain("stdin");
    expect(stdout).toContain("--version");
    expect(stdout).toContain("--help");
  });

  test("any other argument still waits for the batch on stdin, as before", async () => {
    const proc = Bun.spawn(["bun", MAIN_ENTRY, "--something-else"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write("{not json");
    proc.stdin.end();
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(2);
    expect(JSON.parse(stdout.trim())).toMatchObject({ event: "fatal_error", reason: "invalid_input" });
  });
});

describe("forge614-workers end-to-end", () => {
  test("runs a successful task against a fake engines binary and a fake agent, exit 0", async () => {
    const input = JSON.stringify({
      enginesBin: join(FIXTURES, "fake-engines-headless.js"),
      tasks: [
        {
          id: "t1",
          agentId: "claude-code",
          executable: join(FIXTURES, "fake-agent-echo.js"),
          prompt: "hello",
        },
      ],
    });

    const { stdout, exitCode } = await runWorkers(input);
    const lines = stdout.trim().split("\n").map((l) => JSON.parse(l));

    expect(exitCode).toBe(0);
    expect(lines.map((l) => l.event)).toEqual(["task_started", "task_completed", "run_completed"]);
    expect(lines[1].stdout).toBe("echoed: hello");
  });

  test("stops with exit 75 when the fake agent reports quota exhaustion", async () => {
    const input = JSON.stringify({
      enginesBin: join(FIXTURES, "fake-engines-headless.js"),
      tasks: [
        {
          id: "t1",
          agentId: "claude-code",
          executable: join(FIXTURES, "fake-agent-quota.js"),
          prompt: "hello",
        },
      ],
    });

    const { stdout, exitCode } = await runWorkers(input);
    const lines = stdout.trim().split("\n").map((l) => JSON.parse(l));

    expect(exitCode).toBe(75);
    expect(lines.map((l) => l.event)).toEqual(["task_started", "quota_exhausted", "run_completed"]);
  });

  test("reports fatal_error and exit 2 on malformed input JSON", async () => {
    const { stdout, exitCode } = await runWorkers("{not json");
    const parsed = JSON.parse(stdout.trim());

    expect(exitCode).toBe(2);
    expect(parsed).toMatchObject({ event: "fatal_error", reason: "invalid_input" });
  });

  test("reports fatal_error and exit 2 when enginesBin does not exist", async () => {
    const input = JSON.stringify({ enginesBin: "/definitely/does/not/exist", tasks: [] });
    const { stdout, exitCode } = await runWorkers(input);
    const parsed = JSON.parse(stdout.trim());

    expect(exitCode).toBe(2);
    expect(parsed).toMatchObject({ event: "fatal_error", reason: "engines_bin_not_found" });
  });
});
