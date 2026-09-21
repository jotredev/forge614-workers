import { describe, test, expect } from "bun:test";
import { claudeCodeAdapter } from "./claude-code";

describe("claudeCodeAdapter.detectQuotaExhausted", () => {
  test("matches the quota pattern in stderr", () => {
    const result = claudeCodeAdapter.detectQuotaExhausted(
      "Claude AI usage limit reached|1732000000",
      ""
    );
    expect(result).toEqual({ matched: true, pattern: "Claude AI usage limit reached" });
  });

  test("matches the quota pattern in the stdout prefix", () => {
    const result = claudeCodeAdapter.detectQuotaExhausted(
      "",
      "Claude AI usage limit reached|1732000000"
    );
    expect(result.matched).toBe(true);
  });

  test("does not match on an unrelated error", () => {
    const result = claudeCodeAdapter.detectQuotaExhausted("network timeout", "");
    expect(result).toEqual({ matched: false });
  });
});

describe("claudeCodeAdapter.isolationEnv", () => {
  test("needs no extra environment variables beyond the universal HOME override", () => {
    expect(claudeCodeAdapter.isolationEnv("/tmp/whatever")).toEqual({});
  });
});
