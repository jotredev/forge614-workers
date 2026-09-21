// Never touches stdin. Sleeps far longer than any timeoutMs used against it
// in tests, so it only ever exits via the runner's SIGTERM/SIGKILL.
await new Promise((resolve) => setTimeout(resolve, 60_000));
process.exit(0);
