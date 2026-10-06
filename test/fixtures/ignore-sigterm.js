// Simula un proceso que no obedece SIGTERM y nunca termina solo, para obligar al ejecutor a escalar a SIGKILL. Lo usa la prueba
// «kills a process that ignores SIGTERM after the grace period» de `src/process-runner.test.ts`.
process.on("SIGTERM", () => {
  // Se ignora SIGTERM a propósito para que la prueba tenga que escalar a SIGKILL.
});
setInterval(() => {}, 1000);
