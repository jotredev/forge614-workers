import { describe, test, expect, beforeAll } from "bun:test";
import { resolveHeadlessCommand } from "./engines-client";
import { resolveEnginesBinForTests } from "../test/support/resolve-engines-bin";

describe("resolveHeadlessCommand (against the real forge614-engines binary)", () => {
  // Resolved in beforeAll (not at describe-body/module-collection time) so
  // that a missing binary produces a clearly attributed test failure for
  // this file instead of Bun reporting a file-level "error between tests"
  // that silently drops all of this file's tests from the pass/fail count.
  let enginesBin: string;
  beforeAll(() => {
    enginesBin = resolveEnginesBinForTests();
  });

  test("resolves a supported agent to a runnable command with stdin delivery", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
    });

    expect(result).toEqual({
      ok: true,
      command: { command: "/bin/claude", args: ["-p"], stdin: true },
    });
  });

  test("forwards --model", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
      model: "claude-haiku-4-5",
    });

    expect(result).toEqual({
      ok: true,
      command: { command: "/bin/claude", args: ["-p", "--model", "claude-haiku-4-5"], stdin: true },
    });
  });

  test("reports HEADLESS_UNSUPPORTED for an agent without headless support", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "cursor",
      executable: "/bin/cursor",
      prompt: "hello",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("HEADLESS_UNSUPPORTED");
  });

  test("reports REASONING_LEVEL_UNSUPPORTED when claude-code is asked for a reasoning level", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
      reasoningLevel: "high",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("REASONING_LEVEL_UNSUPPORTED");
  });

  test("resolves successfully for a prompt far larger than the OS ARG_MAX, since the prompt is never passed as a CLI arg", async () => {
    // Regression test for the E2BIG crash: previously the full prompt was
    // also passed as `--prompt <value>` alongside `--stdin-prompt`. A
    // prompt this large (>1MB) would exceed ARG_MAX on some platforms
    // (as low as ~128KiB on Linux) and cause Bun.spawn to throw
    // synchronously when invoking forge614-engines itself. This must run
    // against the real binary since it's exercising the real CLI's argv
    // handling, not a fake.
    const largePrompt = "x".repeat(1_100_000);

    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: largePrompt,
    });

    expect(result.ok).toBe(true);
  });

  test("reports ENGINES_RESPONSE_INVALID instead of throwing when the binary prints non-JSON stdout", async () => {
    const fakeBin = new URL(
      "../test/fixtures/fake-engines-invalid-json.sh",
      import.meta.url
    ).pathname;

    const result = await resolveHeadlessCommand({
      enginesBin: fakeBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ENGINES_RESPONSE_INVALID");
  });
});
