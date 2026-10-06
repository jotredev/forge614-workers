/**
 * Apoyo de pruebas: da la ruta absoluta de un programa falso de `test/fixtures`. Solo lo importa
 * `src/process-runner.test.ts`, que lo usa para pasar cada programa falso como argumento del proceso que lanza.
 */
import { join } from "node:path";

/**
 * Arma la ruta absoluta de un archivo de `test/fixtures` a partir de la carpeta de este archivo; no comprueba que exista.
 *
 * @param name Nombre del programa falso dentro de `test/fixtures`, por ejemplo `echo-stdin.js`.
 * @returns La ruta absoluta de ese archivo.
 */
export function fixturePath(name: string): string {
  return join(import.meta.dir, "..", "fixtures", name);
}
