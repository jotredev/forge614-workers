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
