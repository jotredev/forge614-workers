import { join } from "node:path";

export function fixturePath(name: string): string {
  return join(import.meta.dir, "..", "fixtures", name);
}
