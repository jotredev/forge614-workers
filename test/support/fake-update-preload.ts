/**
 * Precarga (código que `bun --preload` ejecuta antes del programa) que reemplaza `fetch` en la prueba de punta a
 * punta de `update`: en vez de usar la red entrega un instalador mínimo que solo anota sus argumentos en el archivo
 * que indica `FAKE_UPDATE_MARKER`. Así el `src/main.ts` real corre sin red y sin instalador real. Solo lo carga
 * `test/e2e.test.ts` (`runUpdateWithFakeInstaller`).
 */
import { appendFileSync } from "node:fs";

// El archivo donde se anotan las llamadas lo define la prueba; sin él no hay dónde dejar rastro y se falla de inmediato.
const marker = process.env.FAKE_UPDATE_MARKER;
if (!marker) throw new Error("FAKE_UPDATE_MARKER must name the file that records the fake update calls.");

// Sustituye el `fetch` global (el que usa `downloadInstaller` de `src/updater.ts`): anota qué dirección se pidió
// y devuelve un script de bash que, al ejecutarse con `--force`, anota `installer --force` en el mismo archivo.
globalThis.fetch = (async (input: unknown) => {
  appendFileSync(marker, `fetch ${String(input)}\n`);
  return new Response(`#!/usr/bin/env bash\nprintf 'installer %s\\n' "$*" >> "${marker}"\n`);
}) as unknown as typeof fetch;
