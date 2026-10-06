/**
 * Comprueba que todos los lugares que declaran la versión del producto digan la misma: `package.json` (la fuente
 * única), la línea de versión de `docs/08` en español y en inglés, y la entrada correspondiente de `CHANGELOG.md`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";

const root = join(import.meta.dir, "..");

/**
 * Lee un archivo del repositorio como texto UTF-8.
 *
 * @param path Ruta relativa a la raíz del repositorio, por ejemplo `CHANGELOG.md`.
 * @returns El contenido completo del archivo.
 */
function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

/**
 * Busca en un índice de código fuente (`docs/08`) la versión que declara en su línea de `package.json`, que en
 * español dice `versión` y en inglés `version`, con el número entre acentos graves.
 *
 * @param text Contenido completo del índice.
 * @returns La versión escrita entre acentos graves, o `undefined` si la línea no existe o no tiene esa forma.
 */
function sourceIndexVersion(text: string): string | undefined {
  // El primer grupo con `?:` solo acepta una de las dos palabras sin capturarla; el segundo grupo captura el número.
  return /`package\.json`: (?:versión|version) `([^`]+)`/.exec(text)?.[1];
}

/** Agrupa las tres comprobaciones que comparan cada lugar que declara la versión con la de `package.json`. */
describe("aligned versions", () => {
  /**
   * Comprueba que `docs/08-source-index.md` (español) declara la misma versión que `package.json`. Importa porque
   * al subir de versión es fácil olvidar este manual.
   */
  test("docs/08 (es) declares the package.json version", () => {
    expect(sourceIndexVersion(read("docs/08-source-index.md"))).toBe(pkg.version);
  });

  /**
   * Comprueba lo mismo para `docs/08-source-index.en.md` (inglés). Importa porque las dos traducciones del
   * manual deben subir juntas.
   */
  test("docs/08 (en) declares the package.json version", () => {
    expect(sourceIndexVersion(read("docs/08-source-index.en.md"))).toBe(pkg.version);
  });

  /**
   * Comprueba que `CHANGELOG.md` tiene una línea exacta `## <versión>` para la versión de `package.json`. Importa
   * porque una versión publicada sin entrada en el registro de cambios queda sin explicar.
   */
  test("CHANGELOG.md has a '## <version>' entry for the package.json version", () => {
    // Se compara línea por línea, no por subcadena, para que `## 1.0.10` no cuente como `## 1.0.1`.
    expect(read("CHANGELOG.md").split("\n")).toContain(`## ${pkg.version}`);
  });
});
