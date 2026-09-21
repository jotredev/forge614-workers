import type { EngineAdapter } from "./contract";

// Codex CLI surfaces quota/rate-limit failures with one of these substrings
// in stderr or the start of stdout. Reconfirm the exact text against the
// installed CLI version per docs/adding-a-new-engine-adapter.md before
// relying on this in production.
const QUOTA_PATTERNS = ["usage limit", "rate limit"];

export const codexAdapter: EngineAdapter = {
  agentId: "codex",
  detectQuotaExhausted(stderr, stdoutPrefix) {
    const haystacks = [stderr.toLowerCase(), stdoutPrefix.toLowerCase()];
    for (const pattern of QUOTA_PATTERNS) {
      if (haystacks.some((text) => text.includes(pattern))) {
        return { matched: true, pattern };
      }
    }
    return { matched: false };
  },
  isolationEnv(tempDir) {
    // Codex CLI reads its config/session directory from $CODEX_HOME.
    return { CODEX_HOME: tempDir };
  },
};
