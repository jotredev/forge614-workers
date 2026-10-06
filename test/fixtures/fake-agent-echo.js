#!/usr/bin/env bun
// Simula el programa de un asistente de IA: lee todo su stdin y lo devuelve en stdout con el prefijo `echoed: `.
// Lo usa la prueba de éxito de `test/e2e.test.ts` (espera `echoed: hello`).
const data = await new Response(Bun.stdin.stream()).text();
process.stdout.write(`echoed: ${data}`);
