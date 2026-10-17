#!/usr/bin/env bun
// Emite las formas de respuesta JSON rotas que `src/engines-client.test.ts` debe rechazar.
const agent = Bun.argv[Bun.argv.indexOf("--agent") + 1];
const responses = {
  "error-null": { error: null },
  "error-string": { error: "x" },
  "error-object": { error: {} },
  "headless-null": { headless: null },
};
console.log(JSON.stringify(responses[agent]));
