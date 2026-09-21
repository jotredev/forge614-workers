import { describe, test, expect } from "bun:test";
import { codexAdapter } from "./codex";

describe("codexAdapter.detectQuotaExhausted", () => {
  test("matches a usage-limit message in stderr", () => {
    const result = codexAdapter.detectQuotaExhausted("You have hit your usage limit for today", "");
    expect(result).toEqual({ matched: true, pattern: "usage limit" });
  });

  test("matches a rate-limit message in the stdout prefix", () => {
    const result = codexAdapter.detectQuotaExhausted("", "Rate limit reached for requests");
    expect(result.matched).toBe(true);
  });

  test("does not match on an unrelated error", () => {
    const result = codexAdapter.detectQuotaExhausted("invalid API key", "");
    expect(result).toEqual({ matched: false });
  });
});

describe("codexAdapter.extraArgs", () => {
  test("adds --skip-git-repo-check since Workers always runs in an untrusted temp dir", () => {
    expect(codexAdapter.extraArgs()).toEqual(["--skip-git-repo-check"]);
  });
});
