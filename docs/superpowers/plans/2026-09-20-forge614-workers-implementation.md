# forge614-workers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `forge614-workers`, the sequential, non-interactive task executor consumed by `forge614-atlas`: it reads a JSON list of AI-engine tasks from stdin, runs each through `forge614-engines headless`, and streams NDJSON progress events to stdout.

**Architecture:** A small set of decoupled TypeScript modules — `types` (input/output contracts), `adapters/*` (per-engine quota detection + env isolation), `engines-client` (resolves OS commands via the real `forge614-engines` binary), `process-runner` (adapter-agnostic subprocess execution with isolation/timeout/truncation), `runner` (sequential orchestration), and a thin `cli`/`main` entrypoint. Every component is unit-testable in isolation via dependency injection; only `engines-client` and the registry-completeness test talk to a real external binary.

**Tech Stack:** Bun + TypeScript, `bun test`, `tsc --noEmit`, `bun build --compile`.

**Spec:** `docs/superpowers/specs/2026-09-20-forge614-workers-design.md`

## Global Constraints

- Sequential execution only — tasks run one at a time, never in parallel.
- `maxOutputBytes` default: `10485760` (10 MiB), applied independently to stdout and stderr per task.
- Quota-detection stdout prefix: exactly `4096` bytes (4 KiB), independent of `maxOutputBytes`.
- Default per-task timeout: `600000` ms (10 minutes) when `timeoutMs` is omitted from a task.
- Timeout escalation: `SIGTERM` at `timeoutMs`, then `SIGKILL` after a configurable grace period (`sigkillGraceMs`, default `5000` ms).
- Exit codes of the `forge614-workers` process: `0` = batch ran to completion (regardless of individual task failures); `75` = stopped early on `quota_exhausted`; `2` = fatal error, no task ran.
- `engines-client` always requests `--stdin-prompt` from `forge614-engines headless`; `process-runner` always writes the prompt to the child's stdin, never as a CLI argument.
- `forge614-engines headless` failures return process exit code `1` with the JSON error on **stdout** (not stderr), shaped `{schemaVersion, error: {code, message}}`. Success is `{schemaVersion, headless: {command, args, stdin?}}`.
- `forge614-engines agents list` succeeds with `{schemaVersion, agents: [{id, label, supportsMcp, supportsHooks, supportsHeadlessExec}]}`.
- Workers never queries Engines' `capabilities`, never retries a task with corrected parameters, never reports token usage, and never persists state between runs.
- `engines-client.test.ts` and the registry-completeness test run against the real, installed `forge614-engines` binary (resolved via `FORGE614_ENGINES_BIN` env var or `Bun.which("forge614-engines")`) — never a test double. Test doubles are reserved for simulating AI engine subprocesses (and, only in the Task 19 end-to-end suite, a fake `forge614-engines` binary used to prove Workers' own wiring without depending on any specific agent being installed).

---

## File structure

```
package.json
tsconfig.json
src/
  version.ts
  types.ts
  types.test.ts
  adapters/
    contract.ts
    claude-code.ts
    claude-code.test.ts
    codex.ts
    codex.test.ts
    registry.ts
    registry.test.ts
    registry.completeness.test.ts
    _template.ts
  engines-client.ts
  engines-client.test.ts
  process-runner.ts
  process-runner.test.ts
  runner.ts
  runner.test.ts
  cli.ts
  cli.test.ts
  main.ts
test/
  support/
    resolve-engines-bin.ts
    fixture-path.ts
  fixtures/
    echo-stdin.js
    print-env.js
    big-output.js
    ignore-sigterm.js
    exit-with-code.js
    fake-engines-headless.js
    fake-agent-echo.js
    fake-agent-quota.js
  e2e.test.ts
docs/
  adding-a-new-engine-adapter.md
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/version.ts`
- Test: `src/version.test.ts`

**Interfaces:**
- Produces: `VERSION: string` (exported constant), consumed by nothing yet but proves the toolchain (`bun test`, `tsc --noEmit`) works end-to-end.

- [ ] **Step 1: Write the failing test**

```ts
// src/version.test.ts
import { describe, test, expect } from "bun:test";
import { VERSION } from "./version";

describe("VERSION", () => {
  test("matches package.json", () => {
    expect(VERSION).toBe("0.1.0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/version.test.ts`
Expected: FAIL — `./version` module not found.

- [ ] **Step 3: Create package.json, tsconfig.json, and the implementation**

```json
// package.json
{
  "name": "forge614-workers",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "build": "bun build ./src/main.ts --compile --outfile dist/forge614-workers"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "bun-types": "^1.3.8"
  },
  "engines": {
    "node": ">=20"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["bun-types"],
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

```ts
// src/version.ts
export const VERSION = "0.1.0";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/version.test.ts`
Expected: PASS

- [ ] **Step 5: Verify typecheck**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json src/version.ts src/version.test.ts
git commit -m "chore: scaffold forge614-workers project"
```

---

### Task 2: Shared types and input validation

**Files:**
- Create: `src/types.ts`
- Test: `src/types.test.ts`

**Interfaces:**
- Produces: `ReasoningLevel`, `TaskSpec`, `RunInput`, `TaskFailureReason`, `TaskEvent`, `InvalidInputError`, `DEFAULT_MAX_OUTPUT_BYTES`, `DEFAULT_TASK_TIMEOUT_MS`, `parseRunInput(raw: string): RunInput` — all consumed by every later task.

- [ ] **Step 1: Write the failing tests**

```ts
// src/types.test.ts
import { describe, test, expect } from "bun:test";
import {
  parseRunInput,
  InvalidInputError,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TASK_TIMEOUT_MS,
} from "./types";

describe("parseRunInput", () => {
  test("parses a minimal valid input and applies defaults", () => {
    const input = parseRunInput(
      JSON.stringify({
        enginesBin: "/bin/forge614-engines",
        tasks: [{ id: "t1", agentId: "claude-code", executable: "/bin/claude", prompt: "hi" }],
      })
    );

    expect(input.enginesBin).toBe("/bin/forge614-engines");
    expect(input.maxOutputBytes).toBe(DEFAULT_MAX_OUTPUT_BYTES);
    expect(input.tasks).toEqual([
      {
        id: "t1",
        agentId: "claude-code",
        executable: "/bin/claude",
        prompt: "hi",
        model: undefined,
        reasoningLevel: null,
        timeoutMs: DEFAULT_TASK_TIMEOUT_MS,
      },
    ]);
  });

  test("honors explicit maxOutputBytes and per-task overrides", () => {
    const input = parseRunInput(
      JSON.stringify({
        enginesBin: "/bin/forge614-engines",
        maxOutputBytes: 2048,
        tasks: [
          {
            id: "t1",
            agentId: "codex",
            executable: "/bin/codex",
            prompt: "hi",
            model: "gpt-5-codex",
            reasoningLevel: "high",
            timeoutMs: 5000,
          },
        ],
      })
    );

    expect(input.maxOutputBytes).toBe(2048);
    expect(input.tasks[0]).toEqual({
      id: "t1",
      agentId: "codex",
      executable: "/bin/codex",
      prompt: "hi",
      model: "gpt-5-codex",
      reasoningLevel: "high",
      timeoutMs: 5000,
    });
  });

  test("throws InvalidInputError on malformed JSON", () => {
    expect(() => parseRunInput("{not json")).toThrow(InvalidInputError);
  });

  test("throws InvalidInputError when enginesBin is missing", () => {
    expect(() => parseRunInput(JSON.stringify({ tasks: [] }))).toThrow(InvalidInputError);
  });

  test("throws InvalidInputError when tasks is missing", () => {
    expect(() =>
      parseRunInput(JSON.stringify({ enginesBin: "/bin/forge614-engines" }))
    ).toThrow(InvalidInputError);
  });

  test("throws InvalidInputError when a task is missing a required field", () => {
    expect(() =>
      parseRunInput(
        JSON.stringify({
          enginesBin: "/bin/forge614-engines",
          tasks: [{ id: "t1", agentId: "claude-code", executable: "/bin/claude" }],
        })
      )
    ).toThrow(InvalidInputError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/types.test.ts`
Expected: FAIL — `./types` module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/types.ts
export type ReasoningLevel = "low" | "medium" | "high";

export interface TaskSpec {
  id: string;
  agentId: string;
  executable: string;
  prompt: string;
  model?: string;
  reasoningLevel: ReasoningLevel | null;
  timeoutMs: number;
}

export interface RunInput {
  enginesBin: string;
  maxOutputBytes: number;
  tasks: TaskSpec[];
}

export type TaskFailureReason =
  | "timeout"
  | "engine_unsupported"
  | "spawn_error"
  | "generic_error";

export type TaskEvent =
  | { event: "task_started"; taskId: string; agentId: string; startedAt: string }
  | {
      event: "task_completed";
      taskId: string;
      exitCode: number;
      durationMs: number;
      stdout: string;
      stdoutBytes: number;
      stdoutTruncated: boolean;
      stderr: string;
      stderrBytes: number;
      stderrTruncated: boolean;
    }
  | {
      event: "task_failed";
      taskId: string;
      reason: TaskFailureReason;
      exitCode: number | null;
      stdout: string;
      stdoutBytes: number;
      stdoutTruncated: boolean;
      stderr: string;
      stderrBytes: number;
      stderrTruncated: boolean;
    }
  | {
      event: "quota_exhausted";
      taskId: string;
      agentId: string;
      matchedPattern: string;
      stdout: string;
      stdoutBytes: number;
      stdoutTruncated: boolean;
      stderr: string;
      stderrBytes: number;
      stderrTruncated: boolean;
    }
  | {
      event: "run_completed";
      totalTasks: number;
      completed: number;
      failed: number;
      notStarted: number;
      pausedByQuota: boolean;
      totalDurationMs: number;
    }
  | { event: "fatal_error"; reason: "invalid_input" | "engines_bin_not_found"; message: string };

export const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000;

export class InvalidInputError extends Error {}

export function parseRunInput(raw: string): RunInput {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new InvalidInputError(`Input is not valid JSON: ${(err as Error).message}`);
  }

  if (typeof data !== "object" || data === null) {
    throw new InvalidInputError("Input must be a JSON object");
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj.enginesBin !== "string" || obj.enginesBin.length === 0) {
    throw new InvalidInputError('"enginesBin" is required and must be a non-empty string');
  }
  if (!Array.isArray(obj.tasks)) {
    throw new InvalidInputError('"tasks" is required and must be an array');
  }

  const maxOutputBytes =
    obj.maxOutputBytes === undefined ? DEFAULT_MAX_OUTPUT_BYTES : Number(obj.maxOutputBytes);
  if (!Number.isFinite(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new InvalidInputError('"maxOutputBytes" must be a positive number');
  }

  const tasks = obj.tasks.map((rawTask, index) => parseTask(rawTask, index));

  return { enginesBin: obj.enginesBin, maxOutputBytes, tasks };
}

function parseTask(raw: unknown, index: number): TaskSpec {
  if (typeof raw !== "object" || raw === null) {
    throw new InvalidInputError(`tasks[${index}] must be an object`);
  }
  const t = raw as Record<string, unknown>;
  for (const field of ["id", "agentId", "executable", "prompt"] as const) {
    if (typeof t[field] !== "string" || (t[field] as string).length === 0) {
      throw new InvalidInputError(
        `tasks[${index}].${field} is required and must be a non-empty string`
      );
    }
  }
  const timeoutMs = t.timeoutMs === undefined ? DEFAULT_TASK_TIMEOUT_MS : Number(t.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new InvalidInputError(`tasks[${index}].timeoutMs must be a positive number`);
  }
  const reasoningLevel =
    t.reasoningLevel === undefined || t.reasoningLevel === null
      ? null
      : (t.reasoningLevel as ReasoningLevel);

  return {
    id: t.id as string,
    agentId: t.agentId as string,
    executable: t.executable as string,
    prompt: t.prompt as string,
    model: typeof t.model === "string" ? t.model : undefined,
    reasoningLevel,
    timeoutMs,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/types.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/types.test.ts
git commit -m "feat: add shared types and task-list input validation"
```

---

### Task 3: Adapter contract and the Claude Code adapter

**Files:**
- Create: `src/adapters/contract.ts`
- Create: `src/adapters/claude-code.ts`
- Test: `src/adapters/claude-code.test.ts`

**Interfaces:**
- Produces: `EngineAdapter` interface, `QUOTA_STDOUT_PREFIX_BYTES = 4096`, `claudeCodeAdapter: EngineAdapter` with `agentId: "claude-code"`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/adapters/claude-code.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/adapters/claude-code.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/adapters/contract.ts
export interface QuotaDetectionResult {
  matched: boolean;
  pattern?: string;
}

export interface EngineAdapter {
  agentId: string;
  detectQuotaExhausted(stderr: string, stdoutPrefix: string): QuotaDetectionResult;
  isolationEnv(tempDir: string): Record<string, string>;
}

export const QUOTA_STDOUT_PREFIX_BYTES = 4096;
```

```ts
// src/adapters/claude-code.ts
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
  isolationEnv(_tempDir) {
    // Claude Code only reads $HOME for its config (~/.claude); the
    // universal HOME override applied by process-runner is sufficient.
    return {};
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/adapters/claude-code.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/adapters/contract.ts src/adapters/claude-code.ts src/adapters/claude-code.test.ts
git commit -m "feat: add adapter contract and the claude-code adapter"
```

---

### Task 4: Codex adapter

**Files:**
- Create: `src/adapters/codex.ts`
- Test: `src/adapters/codex.test.ts`

**Interfaces:**
- Consumes: `EngineAdapter` from `src/adapters/contract.ts` (Task 3).
- Produces: `codexAdapter: EngineAdapter` with `agentId: "codex"`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/adapters/codex.test.ts
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

describe("codexAdapter.isolationEnv", () => {
  test("points CODEX_HOME at the isolated temp dir", () => {
    expect(codexAdapter.isolationEnv("/tmp/abc123")).toEqual({ CODEX_HOME: "/tmp/abc123" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/adapters/codex.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/adapters/codex.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/adapters/codex.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/adapters/codex.ts src/adapters/codex.test.ts
git commit -m "feat: add the codex adapter"
```

---

### Task 5: Adapter registry

**Files:**
- Create: `src/adapters/registry.ts`
- Test: `src/adapters/registry.test.ts`

**Interfaces:**
- Consumes: `claudeCodeAdapter` (Task 3), `codexAdapter` (Task 4).
- Produces: `getAdapter(agentId: string): EngineAdapter | undefined`, `listAdapterIds(): string[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/adapters/registry.test.ts
import { describe, test, expect } from "bun:test";
import { getAdapter, listAdapterIds } from "./registry";

describe("adapter registry", () => {
  test("returns the claude-code adapter", () => {
    expect(getAdapter("claude-code")?.agentId).toBe("claude-code");
  });

  test("returns the codex adapter", () => {
    expect(getAdapter("codex")?.agentId).toBe("codex");
  });

  test("returns undefined for an unregistered agent", () => {
    expect(getAdapter("cursor")).toBeUndefined();
  });

  test("lists all registered adapter ids", () => {
    expect(listAdapterIds().sort()).toEqual(["claude-code", "codex"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/adapters/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/adapters/registry.ts
import type { EngineAdapter } from "./contract";
import { claudeCodeAdapter } from "./claude-code";
import { codexAdapter } from "./codex";

const adapters: EngineAdapter[] = [claudeCodeAdapter, codexAdapter];
const byId = new Map(adapters.map((a) => [a.agentId, a]));

export function getAdapter(agentId: string): EngineAdapter | undefined {
  return byId.get(agentId);
}

export function listAdapterIds(): string[] {
  return adapters.map((a) => a.agentId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/adapters/registry.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/adapters/registry.ts src/adapters/registry.test.ts
git commit -m "feat: add the adapter registry"
```

---

### Task 6: Engines client (against the real forge614-engines binary)

**Files:**
- Create: `src/engines-client.ts`
- Create: `test/support/resolve-engines-bin.ts`
- Test: `src/engines-client.test.ts`

**Interfaces:**
- Consumes: `ReasoningLevel` from `src/types.ts` (Task 2).
- Produces: `HeadlessCommand { command, args, stdin? }`, `ResolveHeadlessResult`, `resolveHeadlessCommand(options): Promise<ResolveHeadlessResult>`, `ResolveHeadlessCommand` (type alias for DI in Task 12+).

- [ ] **Step 1: Write the test support helper**

```ts
// test/support/resolve-engines-bin.ts
export function resolveEnginesBinForTests(): string {
  const fromEnv = process.env.FORGE614_ENGINES_BIN;
  if (fromEnv) return fromEnv;

  const onPath = Bun.which("forge614-engines");
  if (onPath) return onPath;

  throw new Error(
    "Could not find the forge614-engines binary. Install it, or set " +
      "FORGE614_ENGINES_BIN to its path, before running this test suite."
  );
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/engines-client.test.ts
import { describe, test, expect } from "bun:test";
import { resolveHeadlessCommand } from "./engines-client";
import { resolveEnginesBinForTests } from "../test/support/resolve-engines-bin";

describe("resolveHeadlessCommand (against the real forge614-engines binary)", () => {
  const enginesBin = resolveEnginesBinForTests();

  test("resolves a supported agent to a runnable command with stdin delivery", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
    });

    expect(result).toEqual({
      ok: true,
      command: { command: "/bin/claude", args: ["-p"], stdin: true },
    });
  });

  test("forwards --model", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
      model: "claude-haiku-4-5",
    });

    expect(result).toEqual({
      ok: true,
      command: { command: "/bin/claude", args: ["-p", "--model", "claude-haiku-4-5"], stdin: true },
    });
  });

  test("reports HEADLESS_UNSUPPORTED for an agent without headless support", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "cursor",
      executable: "/bin/cursor",
      prompt: "hello",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("HEADLESS_UNSUPPORTED");
  });

  test("reports REASONING_LEVEL_UNSUPPORTED when claude-code is asked for a reasoning level", async () => {
    const result = await resolveHeadlessCommand({
      enginesBin,
      agentId: "claude-code",
      executable: "/bin/claude",
      prompt: "hello",
      reasoningLevel: "high",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("REASONING_LEVEL_UNSUPPORTED");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test src/engines-client.test.ts`
Expected: FAIL — `./engines-client` module not found.

- [ ] **Step 4: Write the implementation**

```ts
// src/engines-client.ts
import type { ReasoningLevel } from "./types";

export interface HeadlessCommand {
  command: string;
  args: string[];
  stdin?: boolean;
}

export interface ResolveHeadlessOptions {
  enginesBin: string;
  agentId: string;
  executable: string;
  prompt: string;
  model?: string;
  reasoningLevel?: ReasoningLevel | null;
}

export type ResolveHeadlessResult =
  | { ok: true; command: HeadlessCommand }
  | { ok: false; code: string; message: string };

export async function resolveHeadlessCommand(
  options: ResolveHeadlessOptions
): Promise<ResolveHeadlessResult> {
  const args = [
    "headless",
    "--agent", options.agentId,
    "--executable", options.executable,
    "--prompt", options.prompt,
    "--stdin-prompt",
  ];
  if (options.model) args.push("--model", options.model);
  if (options.reasoningLevel) args.push("--reasoning-level", options.reasoningLevel);

  const proc = Bun.spawn([options.enginesBin, ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  const parsed = JSON.parse(stdout) as
    | { headless: HeadlessCommand }
    | { error: { code: string; message: string } };

  if ("error" in parsed) {
    return { ok: false, code: parsed.error.code, message: parsed.error.message };
  }
  return { ok: true, command: parsed.headless };
}

export type ResolveHeadlessCommand = typeof resolveHeadlessCommand;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/engines-client.test.ts`
Expected: PASS (4 tests) — requires `forge614-engines` on `PATH` or `FORGE614_ENGINES_BIN` set.

- [ ] **Step 6: Commit**

```bash
git add src/engines-client.ts src/engines-client.test.ts test/support/resolve-engines-bin.ts
git commit -m "feat: resolve headless commands via the real forge614-engines binary"
```

---

### Task 7: Process runner — happy path and cleanup

**Files:**
- Create: `src/process-runner.ts`
- Create: `test/support/fixture-path.ts`
- Create: `test/fixtures/echo-stdin.js`
- Test: `src/process-runner.test.ts`

**Interfaces:**
- Produces: `CapturedOutput { text, bytes, truncated }`, `RunProcessOptions`, `RunProcessResult`, `runProcess(options): Promise<RunProcessResult>`, `RunProcess` (type alias for DI in Task 12+).

- [ ] **Step 1: Write the test support helper and fixture**

```ts
// test/support/fixture-path.ts
import { join } from "node:path";

export function fixturePath(name: string): string {
  return join(import.meta.dir, "..", "fixtures", name);
}
```

```js
// test/fixtures/echo-stdin.js
const data = await new Response(Bun.stdin.stream()).text();
process.stdout.write(data);
```

- [ ] **Step 2: Write the failing tests**

```ts
// src/process-runner.test.ts
import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { runProcess } from "./process-runner";
import { fixturePath } from "../test/support/fixture-path";

describe("runProcess", () => {
  test("runs a command, pipes stdin, and captures stdout", async () => {
    const result = await runProcess({
      command: process.execPath,
      args: [fixturePath("echo-stdin.js")],
      stdin: "hello world",
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stdout.text).toBe("hello world");
      expect(result.exitCode).toBe(0);
    }
  });

  test("cleans up the isolated temp working directory after the process exits", async () => {
    let usedTempDir = "";
    await runProcess({
      command: process.execPath,
      args: [fixturePath("echo-stdin.js")],
      stdin: "x",
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      buildExtraEnv: (tempDir) => {
        usedTempDir = tempDir;
        return {};
      },
    });

    expect(usedTempDir).not.toBe("");
    expect(existsSync(usedTempDir)).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test src/process-runner.test.ts`
Expected: FAIL — `./process-runner` module not found.

- [ ] **Step 4: Write the implementation**

```ts
// src/process-runner.ts
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

    let proc: ReturnType<typeof Bun.spawn>;
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

    proc.stdin.write(options.stdin);
    proc.stdin.end();

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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/process-runner.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/process-runner.ts src/process-runner.test.ts test/support/fixture-path.ts test/fixtures/echo-stdin.js
git commit -m "feat: run subprocesses in an isolated temp dir with stdin piping"
```

---

### Task 8: Process runner — environment isolation

**Files:**
- Modify: `src/process-runner.test.ts`
- Create: `test/fixtures/print-env.js`

**Interfaces:**
- Consumes: `runProcess`, `buildExtraEnv` option (both from Task 7 — already implemented, this task only adds test coverage).

- [ ] **Step 1: Create the fixture**

```js
// test/fixtures/print-env.js
process.stdout.write(JSON.stringify(process.env));
```

- [ ] **Step 2: Write the failing test**

Add to `src/process-runner.test.ts`:

```ts
  test("sets HOME to the isolated temp dir and applies buildExtraEnv on top", async () => {
    let capturedTempDir = "";
    const result = await runProcess({
      command: process.execPath,
      args: [fixturePath("print-env.js")],
      stdin: "",
      timeoutMs: 5000,
      maxOutputBytes: 1024 * 1024,
      buildExtraEnv: (tempDir) => {
        capturedTempDir = tempDir;
        return { CODEX_HOME: tempDir };
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const env = JSON.parse(result.stdout.text);
      expect(env.HOME).toBe(capturedTempDir);
      expect(env.CODEX_HOME).toBe(capturedTempDir);
    }
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/process-runner.test.ts`
Expected: FAIL if `print-env.js` fixture is missing; once added, this specific test should already PASS against the Task 7 implementation (env isolation was built in from the start) — if it fails for another reason, fix `process-runner.ts` before continuing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/process-runner.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/process-runner.test.ts test/fixtures/print-env.js
git commit -m "test: cover process-runner environment isolation"
```

---

### Task 9: Process runner — output truncation

**Files:**
- Modify: `src/process-runner.test.ts`
- Create: `test/fixtures/big-output.js`

- [ ] **Step 1: Create the fixture**

```js
// test/fixtures/big-output.js
const byteCount = Number(Bun.argv[2]);
process.stdout.write("a".repeat(byteCount));
```

- [ ] **Step 2: Write the failing test**

Add to `src/process-runner.test.ts`:

```ts
  test("truncates stdout at maxOutputBytes and reports the true observed size", async () => {
    const result = await runProcess({
      command: process.execPath,
      args: [fixturePath("big-output.js"), "1000"],
      stdin: "",
      timeoutMs: 5000,
      maxOutputBytes: 100,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stdout.text.length).toBe(100);
      expect(result.stdout.bytes).toBe(1000);
      expect(result.stdout.truncated).toBe(true);
    }
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/process-runner.test.ts`
Expected: FAIL until `big-output.js` exists — the truncation logic itself was already implemented in Task 7's `captureStream`, so once the fixture exists this should PASS immediately.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/process-runner.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/process-runner.test.ts test/fixtures/big-output.js
git commit -m "test: cover process-runner output truncation"
```

---

### Task 10: Process runner — timeout escalation

**Files:**
- Modify: `src/process-runner.test.ts`
- Create: `test/fixtures/ignore-sigterm.js`

- [ ] **Step 1: Create the fixture**

```js
// test/fixtures/ignore-sigterm.js
process.on("SIGTERM", () => {
  // Deliberately ignore SIGTERM so the test must escalate to SIGKILL.
});
setInterval(() => {}, 1000);
```

- [ ] **Step 2: Write the failing test**

Add to `src/process-runner.test.ts`:

```ts
  test("kills a process that ignores SIGTERM after the grace period", async () => {
    const result = await runProcess({
      command: process.execPath,
      args: [fixturePath("ignore-sigterm.js")],
      stdin: "",
      timeoutMs: 50,
      sigkillGraceMs: 50,
      maxOutputBytes: 1024,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("timeout");
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/process-runner.test.ts`
Expected: FAIL until the fixture exists; the escalation logic itself was already implemented in Task 7.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/process-runner.test.ts`
Expected: PASS (5 tests, completes in well under a second thanks to the small `timeoutMs`/`sigkillGraceMs`)

- [ ] **Step 5: Commit**

```bash
git add src/process-runner.test.ts test/fixtures/ignore-sigterm.js
git commit -m "test: cover process-runner SIGTERM-then-SIGKILL escalation"
```

---

### Task 11: Process runner — spawn errors

**Files:**
- Modify: `src/process-runner.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/process-runner.test.ts`:

```ts
  test("reports spawn_error when the resolved executable does not exist", async () => {
    const result = await runProcess({
      command: "/definitely/does/not/exist/binary",
      args: [],
      stdin: "",
      timeoutMs: 1000,
      maxOutputBytes: 1024,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("spawn_error");
  });
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `bun test src/process-runner.test.ts`
Expected: The `spawn_error` branch was already implemented in Task 7's `try/catch` around `Bun.spawn`, so this should PASS immediately. If `Bun.spawn` instead throws asynchronously in a way the current `try/catch` doesn't catch, this test will reveal it — fix `runProcess` so the `try/catch` around the `Bun.spawn` call also covers the case where the ENOENT surfaces on the first read/write instead of on `spawn()` itself.

- [ ] **Step 3: Run tests to verify they pass**

Run: `bun test src/process-runner.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 4: Commit**

```bash
git add src/process-runner.test.ts
git commit -m "test: cover process-runner spawn_error handling"
```

---

### Task 12: Runner — single successful task

**Files:**
- Create: `src/runner.ts`
- Test: `src/runner.test.ts`

**Interfaces:**
- Consumes: `TaskSpec`, `TaskEvent` (Task 2); `getAdapter` (Task 5); `resolveHeadlessCommand`, `ResolveHeadlessResult`, `ResolveHeadlessCommand` (Task 6); `runProcess`, `RunProcessResult`, `RunProcess` (Task 7); `QUOTA_STDOUT_PREFIX_BYTES` (Task 3).
- Produces: `RunBatchOptions`, `RunBatchDeps`, `RunBatchResult`, `runBatch(options, onEvent, deps?): Promise<RunBatchResult>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/runner.test.ts
import { describe, test, expect } from "bun:test";
import { runBatch } from "./runner";
import type { TaskSpec, TaskEvent } from "./types";
import type { ResolveHeadlessResult } from "./engines-client";
import type { RunProcessResult } from "./process-runner";

function makeTask(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    id: "t1",
    agentId: "claude-code",
    executable: "/bin/claude",
    prompt: "hi",
    model: undefined,
    reasoningLevel: null,
    timeoutMs: 60000,
    ...overrides,
  };
}

describe("runBatch", () => {
  test("emits task_started, task_completed, and run_completed for a successful task", async () => {
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/bin/claude", args: ["-p"], stdin: true },
      }),
      runProcess: async (): Promise<RunProcessResult> => ({
        ok: true,
        exitCode: 0,
        durationMs: 10,
        stdout: { text: "ok", bytes: 2, truncated: false },
        stderr: { text: "", bytes: 0, truncated: false },
      }),
    };

    const result = await runBatch(
      { enginesBin: "/bin/engines", maxOutputBytes: 1024, tasks: [makeTask()] },
      (e) => events.push(e),
      deps
    );

    expect(result.pausedByQuota).toBe(false);
    expect(events.map((e) => e.event)).toEqual(["task_started", "task_completed", "run_completed"]);
    const finalEvent = events[2];
    if (finalEvent.event === "run_completed") {
      expect(finalEvent).toMatchObject({ totalTasks: 1, completed: 1, failed: 0, notStarted: 0 });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/runner.test.ts`
Expected: FAIL — `./runner` module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/runner.ts
import type { TaskSpec, TaskEvent } from "./types";
import { getAdapter } from "./adapters/registry";
import { QUOTA_STDOUT_PREFIX_BYTES } from "./adapters/contract";
import { resolveHeadlessCommand, type ResolveHeadlessCommand } from "./engines-client";
import { runProcess, type RunProcess } from "./process-runner";

export interface RunBatchOptions {
  enginesBin: string;
  maxOutputBytes: number;
  tasks: TaskSpec[];
}

export interface RunBatchDeps {
  resolveHeadlessCommand: ResolveHeadlessCommand;
  runProcess: RunProcess;
}

export interface RunBatchResult {
  pausedByQuota: boolean;
}

const defaultDeps: RunBatchDeps = { resolveHeadlessCommand, runProcess };

export async function runBatch(
  options: RunBatchOptions,
  onEvent: (event: TaskEvent) => void,
  deps: RunBatchDeps = defaultDeps
): Promise<RunBatchResult> {
  const batchStart = Date.now();
  let completed = 0;
  let failed = 0;
  let pausedByQuota = false;
  let tasksRun = 0;

  for (const task of options.tasks) {
    tasksRun++;
    onEvent({
      event: "task_started",
      taskId: task.id,
      agentId: task.agentId,
      startedAt: new Date().toISOString(),
    });

    const resolved = await deps.resolveHeadlessCommand({
      enginesBin: options.enginesBin,
      agentId: task.agentId,
      executable: task.executable,
      prompt: task.prompt,
      model: task.model,
      reasoningLevel: task.reasoningLevel,
    });

    if (!resolved.ok) {
      failed++;
      onEvent({
        event: "task_failed",
        taskId: task.id,
        reason: "engine_unsupported",
        exitCode: null,
        stdout: "",
        stdoutBytes: 0,
        stdoutTruncated: false,
        stderr: resolved.message,
        stderrBytes: resolved.message.length,
        stderrTruncated: false,
      });
      continue;
    }

    const adapter = getAdapter(task.agentId);
    const result = await deps.runProcess({
      command: resolved.command.command,
      args: resolved.command.args,
      stdin: task.prompt,
      timeoutMs: task.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
      buildExtraEnv: adapter ? (tempDir) => adapter.isolationEnv(tempDir) : undefined,
    });

    if (!result.ok && result.reason === "spawn_error") {
      failed++;
      onEvent({
        event: "task_failed",
        taskId: task.id,
        reason: "spawn_error",
        exitCode: null,
        stdout: "",
        stdoutBytes: 0,
        stdoutTruncated: false,
        stderr: result.message,
        stderrBytes: result.message.length,
        stderrTruncated: false,
      });
      continue;
    }

    if (!result.ok && result.reason === "timeout") {
      failed++;
      onEvent({
        event: "task_failed",
        taskId: task.id,
        reason: "timeout",
        exitCode: null,
        stdout: result.stdout.text,
        stdoutBytes: result.stdout.bytes,
        stdoutTruncated: result.stdout.truncated,
        stderr: result.stderr.text,
        stderrBytes: result.stderr.bytes,
        stderrTruncated: result.stderr.truncated,
      });
      continue;
    }

    if (!result.ok) continue; // exhaustiveness guard; all failure branches handled above

    const stdoutPrefix = result.stdout.text.slice(0, QUOTA_STDOUT_PREFIX_BYTES);
    const quota = adapter?.detectQuotaExhausted(result.stderr.text, stdoutPrefix) ?? { matched: false };

    if (quota.matched) {
      pausedByQuota = true;
      onEvent({
        event: "quota_exhausted",
        taskId: task.id,
        agentId: task.agentId,
        matchedPattern: quota.pattern ?? "",
        stdout: result.stdout.text,
        stdoutBytes: result.stdout.bytes,
        stdoutTruncated: result.stdout.truncated,
        stderr: result.stderr.text,
        stderrBytes: result.stderr.bytes,
        stderrTruncated: result.stderr.truncated,
      });
      break;
    }

    if (result.exitCode !== 0) {
      failed++;
      onEvent({
        event: "task_failed",
        taskId: task.id,
        reason: "generic_error",
        exitCode: result.exitCode,
        stdout: result.stdout.text,
        stdoutBytes: result.stdout.bytes,
        stdoutTruncated: result.stdout.truncated,
        stderr: result.stderr.text,
        stderrBytes: result.stderr.bytes,
        stderrTruncated: result.stderr.truncated,
      });
      continue;
    }

    completed++;
    onEvent({
      event: "task_completed",
      taskId: task.id,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stdout: result.stdout.text,
      stdoutBytes: result.stdout.bytes,
      stdoutTruncated: result.stdout.truncated,
      stderr: result.stderr.text,
      stderrBytes: result.stderr.bytes,
      stderrTruncated: result.stderr.truncated,
    });
  }

  onEvent({
    event: "run_completed",
    totalTasks: options.tasks.length,
    completed,
    failed,
    notStarted: options.tasks.length - tasksRun,
    pausedByQuota,
    totalDurationMs: Date.now() - batchStart,
  });

  return { pausedByQuota };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/runner.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/runner.ts src/runner.test.ts
git commit -m "feat: add sequential batch runner with injectable dependencies"
```

---

### Task 13: Runner — generic_error handling

**Files:**
- Modify: `src/runner.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/runner.test.ts`:

```ts
  test("marks a task as generic_error when the process exits non-zero without a quota match", async () => {
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/bin/claude", args: [], stdin: true },
      }),
      runProcess: async (): Promise<RunProcessResult> => ({
        ok: true,
        exitCode: 1,
        durationMs: 5,
        stdout: { text: "", bytes: 0, truncated: false },
        stderr: { text: "boom", bytes: 4, truncated: false },
      }),
    };

    await runBatch(
      { enginesBin: "/bin/engines", maxOutputBytes: 1024, tasks: [makeTask()] },
      (e) => events.push(e),
      deps
    );

    const failedEvent = events.find((e) => e.event === "task_failed");
    expect(failedEvent).toMatchObject({ reason: "generic_error", exitCode: 1 });
  });
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `bun test src/runner.test.ts`
Expected: This branch was already implemented in Task 12 — PASS immediately. If it fails, fix the `generic_error` branch in `runner.ts`.

- [ ] **Step 3: Run tests to verify they pass**

Run: `bun test src/runner.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 4: Commit**

```bash
git add src/runner.test.ts
git commit -m "test: cover runner generic_error handling"
```

---

### Task 14: Runner — engine_unsupported handling

**Files:**
- Modify: `src/runner.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/runner.test.ts`:

```ts
  test("marks a task as engine_unsupported when Engines rejects it and never calls runProcess", async () => {
    const events: TaskEvent[] = [];
    let runProcessCalled = false;
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: false,
        code: "REASONING_LEVEL_UNSUPPORTED",
        message: "claude-code does not support reasoning levels",
      }),
      runProcess: async (): Promise<RunProcessResult> => {
        runProcessCalled = true;
        throw new Error("should not be called");
      },
    };

    await runBatch(
      { enginesBin: "/bin/engines", maxOutputBytes: 1024, tasks: [makeTask()] },
      (e) => events.push(e),
      deps
    );

    expect(runProcessCalled).toBe(false);
    const failedEvent = events.find((e) => e.event === "task_failed");
    expect(failedEvent).toMatchObject({ reason: "engine_unsupported" });
  });
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `bun test src/runner.test.ts`
Expected: This branch was already implemented in Task 12 — PASS immediately.

- [ ] **Step 3: Run tests to verify they pass**

Run: `bun test src/runner.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 4: Commit**

```bash
git add src/runner.test.ts
git commit -m "test: cover runner engine_unsupported handling"
```

---

### Task 15: Runner — spawn_error does not stop the batch

**Files:**
- Modify: `src/runner.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/runner.test.ts`:

```ts
  test("marks a task as spawn_error and continues with the next task", async () => {
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/does/not/exist", args: [], stdin: true },
      }),
      runProcess: async (): Promise<RunProcessResult> => ({
        ok: false,
        reason: "spawn_error",
        message: "ENOENT",
      }),
    };

    const result = await runBatch(
      {
        enginesBin: "/bin/engines",
        maxOutputBytes: 1024,
        tasks: [makeTask({ id: "t1" }), makeTask({ id: "t2" })],
      },
      (e) => events.push(e),
      deps
    );

    expect(result.pausedByQuota).toBe(false);
    expect(events.filter((e) => e.event === "task_failed")).toHaveLength(2);
    const runCompleted = events.find((e) => e.event === "run_completed");
    expect(runCompleted).toMatchObject({ totalTasks: 2, failed: 2, completed: 0, notStarted: 0 });
  });
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `bun test src/runner.test.ts`
Expected: This branch was already implemented in Task 12 — PASS immediately.

- [ ] **Step 3: Run tests to verify they pass**

Run: `bun test src/runner.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 4: Commit**

```bash
git add src/runner.test.ts
git commit -m "test: cover runner spawn_error handling across multiple tasks"
```

---

### Task 16: Runner — quota_exhausted stops the batch

**Files:**
- Modify: `src/runner.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/runner.test.ts`:

```ts
  test("stops the batch immediately on quota_exhausted and leaves later tasks not started", async () => {
    const events: TaskEvent[] = [];
    const deps = {
      resolveHeadlessCommand: async (): Promise<ResolveHeadlessResult> => ({
        ok: true,
        command: { command: "/bin/claude", args: [], stdin: true },
      }),
      runProcess: async (): Promise<RunProcessResult> => ({
        ok: true,
        exitCode: 1,
        durationMs: 5,
        stdout: { text: "", bytes: 0, truncated: false },
        stderr: { text: "Claude AI usage limit reached", bytes: 30, truncated: false },
      }),
    };

    const result = await runBatch(
      {
        enginesBin: "/bin/engines",
        maxOutputBytes: 1024,
        tasks: [makeTask({ id: "t1" }), makeTask({ id: "t2" })],
      },
      (e) => events.push(e),
      deps
    );

    expect(result.pausedByQuota).toBe(true);
    expect(events.map((e) => e.event)).toEqual(["task_started", "quota_exhausted", "run_completed"]);
    const runCompleted = events[2];
    if (runCompleted.event === "run_completed") {
      expect(runCompleted).toMatchObject({ notStarted: 1, pausedByQuota: true, completed: 0, failed: 0 });
    }
  });
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `bun test src/runner.test.ts`
Expected: This branch was already implemented in Task 12, and relies on the real `claudeCodeAdapter` registered in Task 5 correctly matching "Claude AI usage limit reached" — PASS immediately.

- [ ] **Step 3: Run tests to verify they pass**

Run: `bun test src/runner.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 4: Commit**

```bash
git add src/runner.test.ts
git commit -m "test: cover runner quota_exhausted batch-stop semantics"
```

---

### Task 17: CLI entrypoint

**Files:**
- Create: `src/cli.ts`
- Create: `src/main.ts`
- Test: `src/cli.test.ts`

**Interfaces:**
- Consumes: `parseRunInput`, `InvalidInputError`, `TaskEvent` (Task 2); `runBatch` (Task 12).
- Produces: `CliResult { exitCode }`, `runCli(stdinText, writeLine): Promise<CliResult>`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/cli.test.ts
import { describe, test, expect } from "bun:test";
import { runCli } from "./cli";

describe("runCli", () => {
  test("returns exit code 2 and a fatal_error event on malformed JSON", async () => {
    const lines: string[] = [];
    const { exitCode } = await runCli("{not json", (l) => lines.push(l));

    expect(exitCode).toBe(2);
    expect(JSON.parse(lines[0])).toMatchObject({ event: "fatal_error", reason: "invalid_input" });
  });

  test("returns exit code 2 and a fatal_error event when enginesBin does not exist", async () => {
    const lines: string[] = [];
    const input = JSON.stringify({ enginesBin: "/definitely/does/not/exist", tasks: [] });
    const { exitCode } = await runCli(input, (l) => lines.push(l));

    expect(exitCode).toBe(2);
    expect(JSON.parse(lines[0])).toMatchObject({
      event: "fatal_error",
      reason: "engines_bin_not_found",
    });
  });

  test("returns exit code 0 for an empty task list against a real executable enginesBin", async () => {
    const lines: string[] = [];
    // process.execPath is always a real, executable file — used here only to
    // pass the enginesBin existence/executable check; it is never invoked
    // because there are no tasks to run.
    const input = JSON.stringify({ enginesBin: process.execPath, tasks: [] });
    const { exitCode } = await runCli(input, (l) => lines.push(l));

    expect(exitCode).toBe(0);
    const finalEvent = JSON.parse(lines[lines.length - 1]);
    expect(finalEvent).toMatchObject({ event: "run_completed", totalTasks: 0, pausedByQuota: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/cli.test.ts`
Expected: FAIL — `./cli` module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/cli.ts
import { accessSync, constants } from "node:fs";
import { parseRunInput, type TaskEvent } from "./types";
import { runBatch } from "./runner";

export interface CliResult {
  exitCode: number;
}

export async function runCli(
  stdinText: string,
  writeLine: (line: string) => void
): Promise<CliResult> {
  let input;
  try {
    input = parseRunInput(stdinText);
  } catch (err) {
    writeLine(
      JSON.stringify({
        event: "fatal_error",
        reason: "invalid_input",
        message: (err as Error).message,
      })
    );
    return { exitCode: 2 };
  }

  try {
    accessSync(input.enginesBin, constants.X_OK);
  } catch {
    writeLine(
      JSON.stringify({
        event: "fatal_error",
        reason: "engines_bin_not_found",
        message: `enginesBin is not an executable file: ${input.enginesBin}`,
      })
    );
    return { exitCode: 2 };
  }

  const onEvent = (event: TaskEvent) => writeLine(JSON.stringify(event));
  const result = await runBatch(
    { enginesBin: input.enginesBin, maxOutputBytes: input.maxOutputBytes, tasks: input.tasks },
    onEvent
  );

  return { exitCode: result.pausedByQuota ? 75 : 0 };
}
```

```ts
// src/main.ts
import { runCli } from "./cli";

async function readStdin(): Promise<string> {
  return await new Response(Bun.stdin.stream()).text();
}

const stdinText = await readStdin();
const { exitCode } = await runCli(stdinText, (line) => console.log(line));
process.exit(exitCode);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/cli.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full unit test suite**

Run: `bun test`
Expected: PASS (all tests across `src/`, excluding the not-yet-created `test/e2e.test.ts` and `registry.completeness.test.ts`)

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/main.ts src/cli.test.ts
git commit -m "feat: add the stdin/NDJSON CLI entrypoint"
```

---

### Task 18: Adapter registry completeness (against the real forge614-engines binary)

**Files:**
- Test: `src/adapters/registry.completeness.test.ts`

**Interfaces:**
- Consumes: `listAdapterIds` (Task 5); `resolveEnginesBinForTests` (Task 6).

- [ ] **Step 1: Write the failing test**

```ts
// src/adapters/registry.completeness.test.ts
import { describe, test, expect } from "bun:test";
import { listAdapterIds } from "./registry";
import { resolveEnginesBinForTests } from "../../test/support/resolve-engines-bin";

interface AgentsListResponse {
  agents: { id: string; supportsHeadlessExec: boolean }[];
}

describe("adapter registry completeness", () => {
  test("every agent with supportsHeadlessExec has a registered adapter", async () => {
    const enginesBin = resolveEnginesBinForTests();
    const proc = Bun.spawn([enginesBin, "agents", "list"], { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const parsed = JSON.parse(stdout) as AgentsListResponse;
    const requiredIds = parsed.agents.filter((a) => a.supportsHeadlessExec).map((a) => a.id);
    const registered = listAdapterIds();

    for (const id of requiredIds) {
      expect(registered).toContain(id);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test src/adapters/registry.completeness.test.ts`
Expected: PASS — `claude-code` and `codex` both have `supportsHeadlessExec: true` and are already registered (Task 5); `cursor` has `supportsHeadlessExec: false` and is correctly excluded.

- [ ] **Step 3: Commit**

```bash
git add src/adapters/registry.completeness.test.ts
git commit -m "test: verify every headless-capable engine has a registered adapter"
```

---

### Task 19: End-to-end smoke test and build

**Files:**
- Create: `test/fixtures/fake-engines-headless.js`
- Create: `test/fixtures/fake-agent-echo.js`
- Create: `test/fixtures/fake-agent-quota.js`
- Test: `test/e2e.test.ts`

**Interfaces:**
- Consumes: the compiled behavior of `src/main.ts` (Task 17), invoked as a real subprocess.

- [ ] **Step 1: Write the fixtures**

```js
// test/fixtures/fake-engines-headless.js
#!/usr/bin/env bun
// Stands in for `forge614-engines headless` in the end-to-end test, so the
// test doesn't depend on forge614-engines being installed. Always resolves
// successfully and honors --stdin-prompt by leaving the prompt out of args.
const args = Bun.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}
if (args[0] === "headless") {
  const executable = flag("--executable");
  console.log(
    JSON.stringify({ schemaVersion: 1, headless: { command: executable, args: [], stdin: true } })
  );
  process.exit(0);
} else {
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      error: { code: "UNKNOWN_COMMAND", message: "fake engines only supports headless" },
    })
  );
  process.exit(1);
}
```

```js
// test/fixtures/fake-agent-echo.js
#!/usr/bin/env bun
// Stands in for a real AI engine CLI: echoes whatever it receives on stdin.
const data = await new Response(Bun.stdin.stream()).text();
process.stdout.write(`echoed: ${data}`);
```

```js
// test/fixtures/fake-agent-quota.js
#!/usr/bin/env bun
// Stands in for a real AI engine CLI reporting a quota/usage-limit failure.
process.stderr.write("Claude AI usage limit reached|1732000000");
process.exit(1);
```

- [ ] **Step 2: Make the fixtures executable**

Run: `chmod +x test/fixtures/fake-engines-headless.js test/fixtures/fake-agent-echo.js test/fixtures/fake-agent-quota.js`

- [ ] **Step 3: Write the failing tests**

```ts
// test/e2e.test.ts
import { describe, test, expect } from "bun:test";
import { join } from "node:path";

const MAIN_ENTRY = join(import.meta.dir, "..", "src", "main.ts");
const FIXTURES = join(import.meta.dir, "fixtures");

async function runWorkers(input: string): Promise<{ stdout: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", MAIN_ENTRY], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(input);
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, exitCode };
}

describe("forge614-workers end-to-end", () => {
  test("runs a successful task against a fake engines binary and a fake agent, exit 0", async () => {
    const input = JSON.stringify({
      enginesBin: join(FIXTURES, "fake-engines-headless.js"),
      tasks: [
        {
          id: "t1",
          agentId: "claude-code",
          executable: join(FIXTURES, "fake-agent-echo.js"),
          prompt: "hello",
        },
      ],
    });

    const { stdout, exitCode } = await runWorkers(input);
    const lines = stdout.trim().split("\n").map((l) => JSON.parse(l));

    expect(exitCode).toBe(0);
    expect(lines.map((l) => l.event)).toEqual(["task_started", "task_completed", "run_completed"]);
    expect(lines[1].stdout).toBe("echoed: hello");
  });

  test("stops with exit 75 when the fake agent reports quota exhaustion", async () => {
    const input = JSON.stringify({
      enginesBin: join(FIXTURES, "fake-engines-headless.js"),
      tasks: [
        {
          id: "t1",
          agentId: "claude-code",
          executable: join(FIXTURES, "fake-agent-quota.js"),
          prompt: "hello",
        },
      ],
    });

    const { stdout, exitCode } = await runWorkers(input);
    const lines = stdout.trim().split("\n").map((l) => JSON.parse(l));

    expect(exitCode).toBe(75);
    expect(lines.map((l) => l.event)).toEqual(["task_started", "quota_exhausted", "run_completed"]);
  });

  test("reports fatal_error and exit 2 on malformed input JSON", async () => {
    const { stdout, exitCode } = await runWorkers("{not json");
    const parsed = JSON.parse(stdout.trim());

    expect(exitCode).toBe(2);
    expect(parsed).toMatchObject({ event: "fatal_error", reason: "invalid_input" });
  });

  test("reports fatal_error and exit 2 when enginesBin does not exist", async () => {
    const input = JSON.stringify({ enginesBin: "/definitely/does/not/exist", tasks: [] });
    const { stdout, exitCode } = await runWorkers(input);
    const parsed = JSON.parse(stdout.trim());

    expect(exitCode).toBe(2);
    expect(parsed).toMatchObject({ event: "fatal_error", reason: "engines_bin_not_found" });
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test test/e2e.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Build the compiled binary**

Run: `bun run build`
Expected: produces `dist/forge614-workers`

- [ ] **Step 6: Smoke-test the compiled binary manually**

Run:
```bash
echo '{"enginesBin":"test/fixtures/fake-engines-headless.js","tasks":[{"id":"t1","agentId":"claude-code","executable":"test/fixtures/fake-agent-echo.js","prompt":"hi"}]}' | ./dist/forge614-workers; echo "exit: $?"
```
Expected: three NDJSON lines (`task_started`, `task_completed`, `run_completed`) and `exit: 0`.

- [ ] **Step 7: Commit**

```bash
git add test/e2e.test.ts test/fixtures/fake-engines-headless.js test/fixtures/fake-agent-echo.js test/fixtures/fake-agent-quota.js
git commit -m "test: add end-to-end smoke tests and verify the compiled build"
```

---

### Task 20: Maintenance runbook and adapter template

**Files:**
- Create: `docs/adding-a-new-engine-adapter.md`
- Create: `src/adapters/_template.ts`

**Interfaces:**
- Consumes: `EngineAdapter` (Task 3) — the template implements it with placeholder values, by design (it is copied and edited, never registered or tested as-is).

- [ ] **Step 1: Write the adapter template**

```ts
// src/adapters/_template.ts
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
  isolationEnv(_tempDir) {
    return {};
  },
};
```

- [ ] **Step 2: Write the runbook**

```markdown
<!-- docs/adding-a-new-engine-adapter.md -->
# Adding a new engine adapter

When `forge614-engines` adds support for a new agent, follow these steps to
add a matching adapter to `forge614-workers`. No extra context should be
needed beyond this document.

1. Confirm via `forge614-engines agents list` that the new agent has
   `supportsHeadlessExec: true`. If it is `false`, no Workers adapter is
   needed — Workers can never invoke that agent headlessly.
2. Copy `src/adapters/_template.ts` to `src/adapters/<agentId>.ts`.
3. Run that engine's real CLI, force a quota/session-exhausted error, and
   record the exact textual pattern(s) it prints (to stderr, or to the start
   of stdout) in the new adapter's `QUOTA_PATTERN`(s).
4. If the CLI reads its config/session state from an environment variable
   other than `HOME`, add it in the adapter's `isolationEnv(tempDir)`.
5. Register the new adapter in `src/adapters/registry.ts` (add it to the
   `adapters` array).
6. Add `src/adapters/<agentId>.test.ts` with fixtures for both a real
   quota-exhausted case and a generic, unrelated error (to guard against
   false positives).
7. Run `bun test` — `src/adapters/registry.completeness.test.ts` fails if
   the new agent isn't registered.
```

- [ ] **Step 3: Verify the project still builds and typechecks with the template file present**

Run: `bun run typecheck && bun test`
Expected: no errors; `_template.ts` typechecks (it fully implements `EngineAdapter`) but is not imported by `registry.ts` or exercised by any test.

- [ ] **Step 4: Commit**

```bash
git add docs/adding-a-new-engine-adapter.md src/adapters/_template.ts
git commit -m "docs: add the new-engine-adapter runbook and template"
```

---

## Self-review notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-09-20-forge614-workers-design.md` maps to at least one task — architecture/components → Tasks 1–17; data contracts → Task 2 (input), Task 12 (output events); adapters/runbook → Tasks 3, 4, 20; process isolation → Tasks 7–11; error handling/exit codes → Tasks 12–17, 19; testing strategy → Tasks 6, 18, 19 (real-binary vs. test-double split honored exactly as specified).
- **Type consistency:** `TaskFailureReason`, `TaskEvent`, `HeadlessCommand`, `RunProcessResult`, and `RunBatchDeps` are defined once (Tasks 2, 6, 7, 12) and reused verbatim by every later task — no renamed duplicates.
- **No placeholders:** the only intentional placeholder values (`REPLACE_WITH_REAL_PATTERN`, `REPLACE_WITH_AGENT_ID`) live in `_template.ts`, whose entire purpose is to be copied and filled in — it is not registered or relied upon by any other task.
