import { describe, test, expect } from "bun:test";
import {
  parseRunInput,
  InvalidInputError,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TASK_TIMEOUT_MS,
} from "./types";

describe("parseRunInput", () => {
  test("parses a minimal valid input and applies defaults", () => {
    const input = parseRunInput(
      JSON.stringify({
        enginesBin: "/bin/forge614-engines",
        tasks: [{ id: "t1", agentId: "claude-code", executable: "/bin/claude", prompt: "hi" }],
      })
    );

    expect(input.enginesBin).toBe("/bin/forge614-engines");
    expect(input.maxOutputBytes).toBe(DEFAULT_MAX_OUTPUT_BYTES);
    expect(input.tasks).toEqual([
      {
        id: "t1",
        agentId: "claude-code",
        executable: "/bin/claude",
        prompt: "hi",
        model: undefined,
        reasoningLevel: null,
        timeoutMs: DEFAULT_TASK_TIMEOUT_MS,
      },
    ]);
  });

  test("honors explicit maxOutputBytes and per-task overrides", () => {
    const input = parseRunInput(
      JSON.stringify({
        enginesBin: "/bin/forge614-engines",
        maxOutputBytes: 2048,
        tasks: [
          {
            id: "t1",
            agentId: "codex",
            executable: "/bin/codex",
            prompt: "hi",
            model: "gpt-5-codex",
            reasoningLevel: "high",
            timeoutMs: 5000,
          },
        ],
      })
    );

    expect(input.maxOutputBytes).toBe(2048);
    expect(input.tasks[0]).toEqual({
      id: "t1",
      agentId: "codex",
      executable: "/bin/codex",
      prompt: "hi",
      model: "gpt-5-codex",
      reasoningLevel: "high",
      timeoutMs: 5000,
    });
  });

  test("throws InvalidInputError on malformed JSON", () => {
    expect(() => parseRunInput("{not json")).toThrow(InvalidInputError);
  });

  test("throws InvalidInputError when enginesBin is missing", () => {
    expect(() => parseRunInput(JSON.stringify({ tasks: [] }))).toThrow(InvalidInputError);
  });

  test("throws InvalidInputError when tasks is missing", () => {
    expect(() =>
      parseRunInput(JSON.stringify({ enginesBin: "/bin/forge614-engines" }))
    ).toThrow(InvalidInputError);
  });

  test("throws InvalidInputError when a task is missing a required field", () => {
    expect(() =>
      parseRunInput(
        JSON.stringify({
          enginesBin: "/bin/forge614-engines",
          tasks: [{ id: "t1", agentId: "claude-code", executable: "/bin/claude" }],
        })
      )
    ).toThrow(InvalidInputError);
  });
});
