/** Sonda si un PowerShell separado sobrevive a la salida inmediata del ejecutable Bun. */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const marker = process.env.FORGE614_DIAG_MARKER;
const spawned = process.env.FORGE614_DIAG_SPAWNED;
const error = process.env.FORGE614_DIAG_ERROR;
if (!marker || !spawned || !error) process.exit(2);

const markerScript = `Start-Sleep -Seconds 3; Set-Content -LiteralPath $env:FORGE614_DIAG_MARKER -Value alive`;
const markerEncoded = Buffer.from(markerScript, "utf16le").toString("base64");
const script = `$powershell = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'; Start-Process -FilePath $powershell -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-NonInteractive','-EncodedCommand','${markerEncoded}') -WindowStyle Hidden`;
const child = spawn("powershell.exe", [
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-NonInteractive",
  "-EncodedCommand",
  Buffer.from(script, "utf16le").toString("base64"),
], { env: process.env, detached: true, stdio: "ignore", windowsHide: true });

child.once("spawn", () => {
  writeFileSync(spawned, "spawned");
  process.exit(0);
});
child.once("error", (cause) => {
  writeFileSync(error, cause.message);
  process.exit(1);
});
