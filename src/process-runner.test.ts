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
});
