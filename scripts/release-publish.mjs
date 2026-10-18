#!/usr/bin/env node
/** Publica únicamente el conjunto de activos verificado para la versión del paquete. */

import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const tag = process.env.GITHUB_REF_NAME;
if (tag !== `v${pkg.version}`) throw new Error(`release tag must be v${pkg.version}`);
if (!process.env.GH_TOKEN) throw new Error("GH_TOKEN is required to publish a release");
const names = [
  "forge614-workers-darwin-arm64",
  "forge614-workers-darwin-x64",
  "forge614-workers-linux-arm64",
  "forge614-workers-linux-x64",
  "forge614-workers-windows-x64.exe",
  "install.sh",
  "install.ps1",
  "install.mjs",
  "forge614.node.json",
  "SHA256SUMS",
];
const assets = names.map((name) => resolve("dist/release", name));
for (const asset of assets) await access(asset);
const result = spawnSync("gh", ["release", "create", tag, ...assets, "--title", tag, "--generate-notes"], {
  stdio: "inherit",
  env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
