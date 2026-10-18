#!/usr/bin/env node
/** Compila el ejecutable autocontenido para el destino de la release. */

import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const targets = new Map([
  ["darwin-arm64", ["bun-darwin-arm64", "forge614-workers-darwin-arm64"]],
  ["darwin-x64", ["bun-darwin-x64", "forge614-workers-darwin-x64"]],
  ["linux-arm64", ["bun-linux-arm64", "forge614-workers-linux-arm64"]],
  ["linux-x64", ["bun-linux-x64", "forge614-workers-linux-x64"]],
  ["windows-x64", ["bun-windows-x64", "forge614-workers-windows-x64.exe"]],
]);

const target = process.env.FORGE614_TARGET;
const selected = target === undefined ? undefined : targets.get(target);
if (!selected) {
  process.stderr.write(`FORGE614_TARGET must be one of ${[...targets.keys()].join(", ")}\n`);
  process.exit(2);
}
const output = resolve("dist/release");
await mkdir(output, { recursive: true });
const result = spawnSync("bun", ["build", "./src/main.ts", "--compile", `--target=${selected[0]}`, `--outfile=${resolve(output, selected[1])}`], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
