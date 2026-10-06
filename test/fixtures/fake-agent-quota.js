#!/usr/bin/env bun
// Simula el programa de un asistente que agotó su cuota: escribe en stderr el texto de cuota de claude-code («Claude AI usage limit reached») y sale con 1.
// Lo usa la prueba de cuota de `test/e2e.test.ts`, que espera el evento `quota_exhausted` y el código de salida 75.
process.stderr.write("Claude AI usage limit reached|1732000000");
process.exit(1);
