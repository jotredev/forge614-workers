/**
 * Guards that every place that states the product version says the same one: `package.json` (the single
 * source), the version line of `docs/08` in both languages and the matching entry of `CHANGELOG.md`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json";

const root = join(import.meta.dir, "..");

/** Reads a repository file as UTF-8 text. */
function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

/** Finds the version a source-index manual declares on its `package.json` line, or `undefined`. */
function sourceIndexVersion(text: string): string | undefined {
  return /`package\.json`: (?:versión|version) `([^`]+)`/.exec(text)?.[1];
}

describe("aligned versions", () => {
  /** The Spanish source index must declare the version of `package.json`. */
  test("docs/08 (es) declares the package.json version", () => {
    expect(sourceIndexVersion(read("docs/08-source-index.md"))).toBe(pkg.version);
  });

  /** The English source index must declare the version of `package.json`. */
  test("docs/08 (en) declares the package.json version", () => {
    expect(sourceIndexVersion(read("docs/08-source-index.en.md"))).toBe(pkg.version);
  });

  /** The changelog must have a `## <version>` entry for the version of `package.json`. */
  test("CHANGELOG.md has a '## <version>' entry for the package.json version", () => {
    expect(read("CHANGELOG.md").split("\n")).toContain(`## ${pkg.version}`);
  });
});
