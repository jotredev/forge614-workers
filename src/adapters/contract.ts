export interface QuotaDetectionResult {
  matched: boolean;
  pattern?: string;
}

export interface EngineAdapter {
  agentId: string;
  detectQuotaExhausted(stderr: string, stdoutPrefix: string): QuotaDetectionResult;
  extraArgs(): string[];
}

export const QUOTA_STDOUT_PREFIX_BYTES = 4096;
