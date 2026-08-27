import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const component = fs.readFileSync(path.resolve(process.cwd(), "client/src/components/ClassicCryptoMarket.tsx"), "utf8");

describe("ClassicCryptoMarket data contract", () => {
  it("uses the OHLC-validated primary-market endpoint instead of an unfiltered stats list", () => {
    expect(component).toContain("nobitexPrimaryMarkets.useQuery(");
    expect(component).toContain("nobitexSearch.useQuery");
    expect(component).toContain("starsReference.useQuery");
    expect(component).toContain("favorites.useQuery");
  });

  it("keeps the user-visible order centered on Stars then core assets, without source branding copy", () => {
    expect(component).toContain("copy.starsTitle");
    expect(component).not.toContain(">Telegram Stars<");
    expect(component).toContain('const PINNED_SYMBOLS = ["TON", "GRAM", "USDT"]');
    expect(component).toContain('"GRAM",');
    expect(component).toContain('GRAM: "گرام"');
    expect(component).toContain("const MARKET_PAGE_SIZE = 8");
    expect(component).toContain("uniqueItems");
    expect(component).toContain("copy.loadMoreMarkets");
    expect(component).toContain("stars-calculator");
    expect(component).toContain("asset-calculator-");
    expect(component).toContain("priceUsd");
    expect(component).toContain("asset-detail-panel");
    expect(component).not.toContain(">Nobitex<");
    expect(component).not.toContain("نوبیتکس");
  });

  it("contains Persian display names for at least 60 live-market assets including FLOW", () => {
    const assetNameEntries = component.match(/^  [A-Z0-9]+: "/gm) ?? [];
    expect(assetNameEntries.length).toBeGreaterThanOrEqual(60);
    expect(component).toContain('FLOW: "فلو"');
  });
});
