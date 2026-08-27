import { describe, expect, it } from "vitest";
import path from "path";
import { resolveStaticDirectory } from "./vite";

describe("resolveStaticDirectory", () => {
  it("uses a co-located public artifact when the production bundle is beside it", () => {
    const moduleDirectory = "/workspace/dist";
    const expected = path.resolve(moduleDirectory, "public");

    expect(resolveStaticDirectory(moduleDirectory, candidate => candidate === expected)).toBe(expected);
  });

  it("falls back to the repository dist artifact when invoked from source", () => {
    const moduleDirectory = "/workspace/server/_core";
    const expected = path.resolve(moduleDirectory, "../..", "dist", "public");

    expect(resolveStaticDirectory(moduleDirectory, candidate => candidate === expected)).toBe(expected);
  });
});
