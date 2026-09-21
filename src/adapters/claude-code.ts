import type { EngineAdapter } from "./contract";

// Claude Code prints this exact phrase when the account's usage limit is
// reached in non-interactive (-p) mode. Reconfirm against the installed CLI
// version per docs/adding-a-new-engine-adapter.md before relying on this in
// production.
const QUOTA_PATTERN = "Claude AI usage limit reached";

export const claudeCodeAdapter: EngineAdapter = {
  agentId: "claude-code",
  detectQuotaExhausted(stderr, stdoutPrefix) {
    if (stderr.includes(QUOTA_PATTERN) || stdoutPrefix.includes(QUOTA_PATTERN)) {
      return { matched: true, pattern: QUOTA_PATTERN };
    }
    return { matched: false };
  },
  extraArgs() {
    return [];
  },
};
