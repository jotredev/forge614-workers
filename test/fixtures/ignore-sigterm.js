process.on("SIGTERM", () => {
  // Deliberately ignore SIGTERM so the test must escalate to SIGKILL.
});
setInterval(() => {}, 1000);
