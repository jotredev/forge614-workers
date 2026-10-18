/** Sonda de CI: lanza PowerShell directamente o mediante Win32_Process.Create y sale. */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const mode = process.argv.slice(1).find((argument) => argument === "direct" || argument === "wmi");
const marker = process.env.FORGE614_W2G_MARKER;
const spawned = process.env.FORGE614_W2G_SPAWNED;
const spawnError = process.env.FORGE614_W2G_SPAWN_ERROR;
if (!marker || !spawned || !spawnError || (mode !== "direct" && mode !== "wmi")) process.exit(2);

const quotedMarker = marker.replace(/'/g, "''");
const markerScript = mode === "wmi"
  ? `Start-Sleep -Seconds 3; Set-Content -LiteralPath '${quotedMarker}' -Value alive`
  : `Start-Sleep -Seconds 3; Set-Content -LiteralPath $env:FORGE614_W2G_MARKER -Value alive`;
const markerEncoded = Buffer.from(markerScript, "utf16le").toString("base64");
const script = mode === "direct"
  ? markerScript
  : `$command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -NonInteractive -EncodedCommand ${markerEncoded}'; Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $command } | Out-Null`;
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
child.once("error", (error) => {
  writeFileSync(spawnError, error.message);
  process.exit(1);
});
