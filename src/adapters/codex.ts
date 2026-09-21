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
  extraArgs() {
    // Codex refuses to run in a directory it doesn't recognize as a trusted
    // git repo. Workers always runs each task in a fresh, isolated,
    // non-repo temp directory by design, so this flag is required on every
    // invocation — confirmed empirically: without it, Codex exits with
    // "Not inside a trusted directory and --skip-git-repo-check was not
    // specified."
    return ["--skip-git-repo-check"];
  },
};
