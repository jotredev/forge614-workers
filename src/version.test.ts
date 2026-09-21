import { describe, test, expect } from "bun:test";
import { VERSION } from "./version";

describe("VERSION", () => {
  test("matches package.json", () => {
    expect(VERSION).toBe("0.1.0");
  });
});
