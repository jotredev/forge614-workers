// Escribe en stdout tantas letras «a» como indique su primer argumento (la salida es ASCII, un byte por carácter). Lo usa la prueba
// «truncates stdout at maxOutputBytes and reports the true observed size» de `src/process-runner.test.ts`, que pide 1000.
const byteCount = Number(Bun.argv[2]);
process.stdout.write("a".repeat(byteCount));
