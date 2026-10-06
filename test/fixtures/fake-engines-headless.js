#!/usr/bin/env bun
// Simula `forge614-engines headless` para las dos pruebas de punta a punta de `test/e2e.test.ts` (éxito y cuota): siempre responde
// que el comando es el valor de `--executable`, sin argumentos y con `stdin: true`, así que el prompt nunca viaja en los argumentos.
// Cualquier otro subcomando (por ejemplo `capabilities`) devuelve `UNKNOWN_COMMAND` y sale con 1; así la prueba no depende de tener Engines instalado.
const args = Bun.argv.slice(2);
// Devuelve el valor que sigue a la bandera dada en los argumentos, o `undefined` si la bandera no está.
function flag(name) {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}
if (args[0] === "headless") {
  const executable = flag("--executable");
  console.log(
    JSON.stringify({ schemaVersion: 1, headless: { command: executable, args: [], stdin: true } })
  );
  process.exit(0);
} else {
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      error: { code: "UNKNOWN_COMMAND", message: "fake engines only supports headless" },
    })
  );
  process.exit(1);
}
