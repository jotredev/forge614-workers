import type { EngineAdapter } from "./contract";

// Copy this file to `<agentId>.ts`, replace agentId and the quota
// pattern(s) below with the ones confirmed for that engine's CLI per
// docs/adding-a-new-engine-adapter.md, then register it in registry.ts.
const QUOTA_PATTERN = "REPLACE_WITH_REAL_PATTERN";

export const templateAdapter: EngineAdapter = {
  agentId: "REPLACE_WITH_AGENT_ID",
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
