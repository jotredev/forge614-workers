import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CapturedOutput {
  text: string;
  bytes: number;
  truncated: boolean;
}

export interface RunProcessOptions {
  command: string;
  args: string[];
  stdin: string;
  timeoutMs: number;
  maxOutputBytes: number;
  buildExtraEnv?: (tempDir: string) => Record<string, string>;
  sigkillGraceMs?: number;
}

export type RunProcessResult =
  | { ok: true; exitCode: number; durationMs: number; stdout: CapturedOutput; stderr: CapturedOutput }
  | { ok: false; reason: "timeout"; stdout: CapturedOutput; stderr: CapturedOutput }
  | { ok: false; reason: "spawn_error"; message: string };

const DEFAULT_SIGKILL_GRACE_MS = 5000;

async function captureStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number
): Promise<CapturedOutput> {
  if (!stream) return { text: "", bytes: 0, truncated: false };
  const reader = stream.getReader();
  const kept: Uint8Array[] = [];
  let keptBytes = 0;
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (keptBytes < maxBytes) {
      const room = maxBytes - keptBytes;
      const slice = value.byteLength > room ? value.subarray(0, room) : value;
      kept.push(slice);
      keptBytes += slice.byteLength;
    }
  }

  return {
    text: Buffer.concat(kept).toString("utf8"),
    bytes: totalBytes,
    truncated: totalBytes > maxBytes,
  };
}

export async function runProcess(options: RunProcessOptions): Promise<RunProcessResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "forge614-workers-"));
  try {
    const extraEnv = options.buildExtraEnv ? options.buildExtraEnv(tempDir) : {};
    const env = { ...process.env, HOME: tempDir, ...extraEnv };

    let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
    try {
      proc = Bun.spawn([options.command, ...options.args], {
        cwd: tempDir,
        env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (err) {
      return { ok: false, reason: "spawn_error", message: (err as Error).message };
    }

    try {
      // write()/end() can fail synchronously OR return a pending Promise
      // that later rejects (e.g. EPIPE once the child has closed/never read
      // stdin). Awaiting them here lets this same try/catch observe both
      // forms of failure instead of leaving an unhandled rejection behind.
      const writeResult = proc.stdin.write(options.stdin);
      if (writeResult instanceof Promise) await writeResult;
      const endResult = proc.stdin.end();
      if (endResult instanceof Promise) await endResult;
    } catch {
      // The child may close or never read stdin (e.g. it exits immediately
      // without consuming input). That's a normal, valid condition — it
      // doesn't mean the process itself failed, so we ignore the write/end
      // error here and continue on to await its exit and capture output.
    }

    const start = Date.now();
    const stdoutPromise = captureStream(proc.stdout, options.maxOutputBytes);
    const stderrPromise = captureStream(proc.stderr, options.maxOutputBytes);

    let timedOut = false;
    const graceMs = options.sigkillGraceMs ?? DEFAULT_SIGKILL_GRACE_MS;
    const termTimer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, options.timeoutMs);
    const killTimer = setTimeout(() => {
      if (timedOut) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // already exited
        }
      }
    }, options.timeoutMs + graceMs);

    const exitCode = await proc.exited;
    clearTimeout(termTimer);
    clearTimeout(killTimer);
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);

    if (timedOut) {
      return { ok: false, reason: "timeout", stdout, stderr };
    }
    return { ok: true, exitCode, durationMs: Date.now() - start, stdout, stderr };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export type RunProcess = typeof runProcess;
