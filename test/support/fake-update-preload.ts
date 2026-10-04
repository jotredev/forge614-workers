/**
 * Bun preload that replaces `fetch` for an end-to-end `update` run: instead of the network it serves a
 * tiny installer that only records its arguments in the file named by `FAKE_UPDATE_MARKER`. Used with
 * `bun --preload` so the real `src/main.ts` runs without network and without a real installer.
 */
import { appendFileSync } from "node:fs";

const marker = process.env.FAKE_UPDATE_MARKER;
if (!marker) throw new Error("FAKE_UPDATE_MARKER must name the file that records the fake update calls.");

globalThis.fetch = (async (input: unknown) => {
  appendFileSync(marker, `fetch ${String(input)}\n`);
  return new Response(`#!/usr/bin/env bash\nprintf 'installer %s\\n' "$*" >> "${marker}"\n`);
}) as unknown as typeof fetch;
