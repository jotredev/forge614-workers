import { describe, test, expect } from "bun:test";
import { getAdapter, listAdapterIds } from "./registry";

describe("adapter registry", () => {
  test("returns the claude-code adapter", () => {
    expect(getAdapter("claude-code")?.agentId).toBe("claude-code");
  });

  test("returns the codex adapter", () => {
    expect(getAdapter("codex")?.agentId).toBe("codex");
  });

  test("returns undefined for an unregistered agent", () => {
    expect(getAdapter("cursor")).toBeUndefined();
  });

  test("lists all registered adapter ids", () => {
    expect(listAdapterIds().sort()).toEqual(["claude-code", "codex"]);
  });
});
