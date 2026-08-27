import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");

describe("Telegram WebView bootstrap resilience", () => {
  it("uses safe storage access for every session credential lookup", () => {
    expect(source).toContain('safeStorageGet("session", "kronos-dashboard-session")');
    expect(source).toContain('safeStorageGet("session", "manus-cookie")');
    expect(source).not.toMatch(/(?<!safeStorageGet\([^\n]*)\bsessionStorage\.getItem/);
  });
});
