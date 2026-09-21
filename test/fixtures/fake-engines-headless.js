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
