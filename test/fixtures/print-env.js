// Imprime en stdout todas sus variables de entorno como JSON. Lo usa la prueba «inherits the parent process's environment completely untouched»
// de `src/process-runner.test.ts` para comparar el entorno del hijo con el del proceso padre.
process.stdout.write(JSON.stringify(process.env));
