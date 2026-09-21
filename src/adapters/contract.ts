export interface QuotaDetectionResult {
  matched: boolean;
  pattern?: string;
}

export interface EngineAdapter {
  agentId: string;
  detectQuotaExhausted(stderr: string, stdoutPrefix: string): QuotaDetectionResult;

  // Extra CLI flags this engine needs because Workers always runs it in a
  // fresh, empty, untrusted working directory (e.g. Codex's
  // --skip-git-repo-check). Returns [] when no extra flags are needed. This
  // is narrowly for flags required by that untrusted-cwd constraint — not a
  // general-purpose hook for model/permission/output flags, which belong in
  // forge614-engines' own command resolution instead.
  extraArgs(): string[];
}

export const QUOTA_STDOUT_PREFIX_BYTES = 4096;
