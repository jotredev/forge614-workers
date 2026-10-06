// Imprime en stdout su carpeta de trabajo actual. Lo usa la prueba «cleans up the isolated temp working directory after the process exits»
// de `src/process-runner.test.ts` para saber qué carpeta temporal usó `runProcess` y comprobar que desaparece al terminar.
process.stdout.write(process.cwd());
