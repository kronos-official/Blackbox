import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DashboardLayout.tsx", import.meta.url), "utf8");

describe("DashboardLayout navigation", () => {
  it("keeps a direct, labeled route to the theme gallery", () => {
    expect(source).toContain('path: "/themes"');
    expect(source).toContain('themes: "گالری تم"');
    expect(source).toContain("Palette");
  });
});
