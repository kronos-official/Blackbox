import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Tabdeal credentials are not used by the live market path", () => {
  it("keeps private credentials and signed account endpoints out of the active Nobitex adapter", () => {
    const source = readFileSync(resolve(import.meta.dirname, "nobitexMarket.ts"), "utf8");
    expect(source).not.toContain("getTabdealIrtAssets");
    expect(source).not.toContain("MARKET_DATA_API_");
    expect(source).not.toContain("/r/api/v1/account");
  });
});
