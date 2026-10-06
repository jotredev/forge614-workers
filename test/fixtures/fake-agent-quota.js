#!/usr/bin/env bun
// Simula el programa de un asistente que agotó su cuota: escribe en stderr «Claude AI usage limit reached|1732000000» (el texto de cuota de claude-code seguido de un número que el adaptador no usa) y sale con 1.
// Lo usa la prueba de cuota de `test/e2e.test.ts`, que espera el evento `quota_exhausted` y el código de salida 75.
process.stderr.write("Claude AI usage limit reached|1732000000");
process.exit(1);
