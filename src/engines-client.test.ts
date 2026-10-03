import { describe, test, expect, beforeAll } from "bun:test";
import { resolveHeadlessCommand } from "./engines-client";
import type { ReasoningLevel } from "./types";
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

  test("forwards --readable-dir as --add-dir for claude-code", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
      readableDir: "/tmp/some-real-dir",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const addDirIndex = result.command.args.indexOf("--add-dir");
      expect(addDirIndex).toBeGreaterThanOrEqual(0);
      expect(result.command.args[addDirIndex + 1]).toBe("/tmp/some-real-dir");
    }
  });

  test("reports UNKNOWN_AGENT for an agent id that Engines does not know", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "not-a-real-agent",
      executable: "/bin/not-a-real-agent",
      prompt: "hello",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("UNKNOWN_AGENT");
  });

  test("resolves claude-code with a reasoning level and passes it as --effort", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
      reasoningLevel: "high",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const effortIndex = result.command.args.indexOf("--effort");
      expect(effortIndex).toBeGreaterThanOrEqual(0);
      expect(result.command.args[effortIndex + 1]).toBe("high");
    }
  });

  // With Engines 1.17.0 every agent accepts all five levels that Workers
  // accepts, so no level is valid for Workers yet invalid for an agent and a
  // test of that exact case cannot be written. The Engines-side rejection is
  // exercised instead by calling the client directly with a level that
  // Workers' own parseTask would already have refused.
  test("reports INVALID_REASONING_LEVEL when Engines is given a level it does not know", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
      reasoningLevel: "banana" as ReasoningLevel,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_REASONING_LEVEL");
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
