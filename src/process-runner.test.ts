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
    let usedTempDir = "";
    await runProcess({
      command: process.execPath,
      args: [fixturePath("echo-stdin.js")],
      stdin: "x",
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      buildExtraEnv: (tempDir) => {
        usedTempDir = tempDir;
        return {};
      },
    });

    expect(usedTempDir).not.toBe("");
    expect(existsSync(usedTempDir)).toBe(false);
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
});
