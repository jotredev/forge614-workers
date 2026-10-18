/** Fixture autocontenible de Workers para comprobar una actualización a una versión distinta. */
const last = process.argv.at(-1);
if (last === "--version") process.stdout.write("forge614-workers 1.1.1\n");
else if (process.argv.at(-2) === "uninstall" && last === "--self") {
  process.stdout.write('{"schemaVersion":1,"result":{"integrationsRemoved":true}}\n');
}
