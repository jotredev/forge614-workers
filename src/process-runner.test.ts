import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { runProcess } from "./process-runner";
import { fixturePath } from "../test/support/fixture-path";

describe("runProcess", () => {
  test("runs a command, pipes stdin, and captures stdout", async () => {
    const result = await runProcess({
      command: process.execPath,
      args: [fixturePath("echo-stdin.js")],
      stdin: "hello world",
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stdout.text).toBe("hello world");
      expect(result.exitCode).toBe(0);
    }
  });

  test("cleans up the isolated temp working directory after the process exits", async () => {
    const result = await runProcess({
      command: process.execPath,
      args: [fixturePath("print-cwd.js")],
      stdin: "",
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const usedTempDir = result.stdout.text;
      expect(usedTempDir).not.toBe("");
      expect(existsSync(usedTempDir)).toBe(false);
    }
  });

  test("resolves normally when the child exits without reading stdin", async () => {
    // exit-immediately.js exits before ever consuming stdin. Writing a
    // large string to its stdin pipe reliably fails (EPIPE, often via a
    // rejected Promise from FileSink#write) once the child has closed it;
    // runProcess must swallow that and still resolve instead of
    // throwing/rejecting with an unhandled error.
    const result = await runProcess({
      command: process.execPath,
      args: [fixturePath("exit-immediately.js")],
      stdin: "x".repeat(2_000_000),
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.exitCode).toBe(0);
    }
  });

  test("timeoutMs still engages when the child never reads a large stdin payload", async () => {
    // never-reads-stdin.js sleeps for 60s without ever reading stdin. With a
    // large enough payload, Bun's FileSink#write() returns a Promise that
    // stays pending for as long as the child is alive and not reading (OS
    // pipe backpressure) — confirmed by direct experimentation against this
    // runtime. If runProcess awaited that write before arming its timeout
    // timers, timeoutMs would never get a chance to fire and this call
    // would hang for the full 60s. Asserting it resolves quickly, with a
    // timeout result, proves the write is backgrounded instead of blocking
    // timer setup.
    const startedAt = Date.now();
    const result = await runProcess({
      command: process.execPath,
      args: [fixturePath("never-reads-stdin.js")],
      stdin: "x".repeat(5_000_000),
      timeoutMs: 300,
      sigkillGraceMs: 200,
      maxOutputBytes: 1024,
    });
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(5_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("timeout");
    }
  }, 10_000);

  test("inherits the parent process's environment untouched (no HOME override)", async () => {
    const result = await runProcess({
      command: process.execPath,
      args: [fixturePath("print-env.js")],
      stdin: "",
      timeoutMs: 5000,
      maxOutputBytes: 1024 * 1024,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const env = JSON.parse(result.stdout.text);
      expect(env.HOME).toBe(process.env.HOME);
    }
  });

  test("truncates stdout at maxOutputBytes and reports the true observed size", async () => {
    const result = await runProcess({
      command: process.execPath,
      args: [fixturePath("big-output.js"), "1000"],
      stdin: "",
      timeoutMs: 5000,
      maxOutputBytes: 100,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stdout.text.length).toBe(100);
      expect(result.stdout.bytes).toBe(1000);
      expect(result.stdout.truncated).toBe(true);
    }
  });

  test("kills a process that ignores SIGTERM after the grace period", async () => {
    const result = await runProcess({
      command: process.execPath,
      args: [fixturePath("ignore-sigterm.js")],
      stdin: "",
      timeoutMs: 50,
      sigkillGraceMs: 50,
      maxOutputBytes: 1024,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("timeout");
  });

  test("reports spawn_error when the resolved executable does not exist", async () => {
    const result = await runProcess({
      command: "/definitely/does/not/exist/binary",
      args: [],
      stdin: "",
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("spawn_error");
  });
});
