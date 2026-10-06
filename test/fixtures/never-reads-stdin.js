// Simula un proceso colgado que nunca lee su stdin: duerme 60 s, mucho más que cualquier `timeoutMs` usado contra él, así que solo termina por el
// SIGTERM/SIGKILL del ejecutor. Lo usa la prueba «timeoutMs still engages when the child never reads a large stdin payload» de `src/process-runner.test.ts`.
await new Promise((resolve) => setTimeout(resolve, 60_000));
process.exit(0);
