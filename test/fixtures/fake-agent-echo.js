#!/usr/bin/env bun
// Stands in for a real AI engine CLI: echoes whatever it receives on stdin.
const data = await new Response(Bun.stdin.stream()).text();
process.stdout.write(`echoed: ${data}`);
