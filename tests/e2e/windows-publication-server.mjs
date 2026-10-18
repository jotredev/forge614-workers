/** Sirve una publicación local mínima para la medición Windows de W2g. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dist = join(root, "dist", "windows-e2e");
const names = ["install.sh", "install.ps1", "install.mjs", "forge614.node.json", "forge614-workers-windows-x64.exe"];
const assets = new Map(names.map((name) => [name, readFileSync(name.startsWith("forge614-workers-") ? join(dist, name) : join(root, name))]));
const sums = [...assets].map(([name, bytes]) => `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`).join("");
assets.set("SHA256SUMS", Buffer.from(sums));

const server = createServer((request, response) => {
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (path === "/repos/jotredev/forge614-workers/releases/latest") {
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ tag_name: "v1.1.0" }));
    return;
  }
  const match = /^\/repos\/jotredev\/forge614-workers\/releases\/download\/v1\.1\.0\/([^/]+)$/.exec(path);
  const bytes = match ? assets.get(match[1]) : undefined;
  if (!bytes) {
    response.writeHead(404).end("missing");
    return;
  }
  response.writeHead(200).end(bytes);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") process.exit(1);
  writeFileSync(process.env.FORGE614_W2G_PORT_FILE ?? "", String(address.port));
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
