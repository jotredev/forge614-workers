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
    let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
    try {
      proc = Bun.spawn([options.command, ...options.args], {
        cwd: tempDir,
        // Pass process.env explicitly (rather than omitting `env`, which
        // Bun instead resolves from an internal snapshot taken at Bun's own
        // startup and does NOT reflect later runtime mutations to
        // process.env) so the child always inherits the parent's true,
        // live, completely untouched environment.
        env: process.env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (err) {
      return { ok: false, reason: "spawn_error", message: (err as Error).message };
    }

    // Write stdin and end it as a fire-and-forget background operation. We
    // deliberately do NOT await this before arming the timeout timers or
    // starting stdout/stderr capture below: if the child is slow to read
    // stdin (e.g. it writes substantial stdout first, and the OS pipe
    // buffer fills before it gets around to reading), awaiting here would
    // block indefinitely with the timers not yet armed — defeating
    // timeoutMs for that entire, plausible class of child behavior. We
    // still attach a synchronous .catch() so a write/end failure (e.g.
    // EPIPE from a child that closes or never reads stdin — also a normal,
    // valid condition) never surfaces as an unhandled rejection; it doesn't
    // mean the process itself failed, only that the stdin pipe write did.
    void Promise.resolve()
      .then(() => proc.stdin.write(options.stdin))
      .then(() => proc.stdin.end())
      .catch(() => {
        // Ignore: see comment above.
      });

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
