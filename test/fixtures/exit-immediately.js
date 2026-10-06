// Termina con código 0 sin leer su stdin, así que la tubería se cierra mientras `runProcess` aún escribe. Lo usa la prueba
// «resolves normally when the child exits without reading stdin» de `src/process-runner.test.ts`.
process.exit(0);
