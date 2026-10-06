// Lee todo su stdin y lo devuelve tal cual en stdout. Lo usa la prueba «runs a command, pipes stdin, and captures stdout»
// de `src/process-runner.test.ts` para comprobar que el texto enviado llega al proceso y su salida se captura.
const data = await new Response(Bun.stdin.stream()).text();
process.stdout.write(data);
