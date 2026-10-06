// Termina con código 0 sin leer su stdin: con un stdin grande (la prueba manda 2 millones de caracteres) la tubería se cierra mientras `runProcess` aún escribe. Lo usa la prueba
// «resolves normally when the child exits without reading stdin» de `src/process-runner.test.ts`.
process.exit(0);
