import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const docsDirectory = path.resolve(process.cwd(), "docs");
const publishedDocs = ["README.md", "bot-help-fa.md", "group-admin-guide-fa.md", "owner-operations-guide-fa.md", "privacy-policy-fa.md", "digi-anti-parity.md"];

describe("published operational documentation", () => {
  it("includes a linked index and every required operational guide", () => {
    for (const filename of publishedDocs) expect(existsSync(path.join(docsDirectory, filename))).toBe(true);
    const index = readFileSync(path.join(docsDirectory, "README.md"), "utf8");
    for (const filename of publishedDocs.slice(1)) expect(index).toContain(filename);
    expect(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")).toContain("scripts/copyDocs.mjs");
    expect(existsSync(path.resolve(process.cwd(), "client", "public", "docs", "index.html"))).toBe(true);
  });
});
