#!/usr/bin/env node
/** Comprueba la identidad del binario compilado en el corredor nativo. */

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const names = new Map([
  ["darwin-arm64", "forge614-workers-darwin-arm64"],
  ["darwin-x64", "forge614-workers-darwin-x64"],
  ["linux-arm64", "forge614-workers-linux-arm64"],
  ["linux-x64", "forge614-workers-linux-x64"],
  ["windows-x64", "forge614-workers-windows-x64.exe"],
]);
const target = process.env.FORGE614_TARGET;
const name = target === undefined ? undefined : names.get(target);
if (!name) {
  process.stderr.write(`FORGE614_TARGET must be one of ${[...names.keys()].join(", ")}\n`);
  process.exit(2);
}
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const binary = resolve("dist/release", name);
for (const args of [["--version"], ["--version", "--json"]]) {
  const result = spawnSync(binary, args, { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${name} exited ${result.status}: ${result.stderr}`);
  const expected = args.length === 1
    ? `forge614-workers ${pkg.version}\n`
    : `${JSON.stringify({ schemaVersion: 1, name: "forge614-workers", version: pkg.version })}\n`;
  if (result.stdout !== expected) throw new Error(`${name} returned unexpected identity: ${result.stdout.trim()}`);
}
process.stdout.write(`${name}: version smoke checks passed\n`);
