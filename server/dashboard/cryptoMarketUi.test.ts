import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const dashboardSource = readFileSync(resolve(projectRoot, "client/src/pages/OwnerDashboard.tsx"), "utf8");
const classicMarketSource = readFileSync(resolve(projectRoot, "client/src/components/ClassicCryptoMarket.tsx"), "utf8");
const adapterSource = readFileSync(resolve(projectRoot, "server/market/nobitexMarket.ts"), "utf8");
const routerSource = readFileSync(resolve(projectRoot, "server/dashboard/router.ts"), "utf8");

describe("Nobitex market Mini App surface", () => {
  it("exposes the crypto-market tab to regular dashboard users with a classic market surface", () => {
    expect(dashboardSource).toContain('"cryptoMarket"');
    expect(dashboardSource).toContain("<ClassicCryptoMarket locale={locale} />");
    expect(dashboardSource).not.toContain("<CryptoMarketPanel locale={locale} />");
    expect(dashboardSource).toContain("بازار رمزارز");
  });

  it("uses a live market connection with a chart-safe REST recovery refresh and keeps provider branding out of the UI", () => {
    expect(classicMarketSource).toContain("useNobitexRealtime(true)");
    expect(classicMarketSource).toContain("nobitexPrimaryMarkets.useQuery(");
    expect(classicMarketSource).toContain("refetchInterval: 60_000");
    expect(classicMarketSource).not.toContain("نوبیتکس");
    expect(classicMarketSource).not.toContain("منبع:");
  });

  it("pins Stars then TON then independent GRAM then USDT, with real charts and conversion calculators", () => {
    expect(classicMarketSource).toContain('const PINNED_SYMBOLS = ["TON", "GRAM", "USDT"]');
    expect(classicMarketSource).toContain('GRAM: "گرام"');
    expect(classicMarketSource).toContain("const MARKET_PAGE_SIZE = 8");
    expect(classicMarketSource).toContain("copy.loadMoreMarkets");
    expect(classicMarketSource).toContain('selected === "telegram-stars"');
    expect(classicMarketSource).toContain("nobitexPrimaryMarkets.useQuery");
    expect(classicMarketSource).toContain('"1d" | "7d" | "30d"');
    expect(classicMarketSource).toContain("closeToman");
    expect(classicMarketSource).toContain("stars-calculator");
    expect(classicMarketSource).toContain("asset-calculator-");
    expect(classicMarketSource).toContain("priceUsd");
    expect(classicMarketSource).toContain("favorites.useQuery");
  });

  it("uses the authenticated dashboard namespace and public Nobitex adapter with timeout, conversion, and stale fallback", () => {
    expect(routerSource).toContain("cryptoMarket: router({");
    expect(routerSource).toContain("nobitexPrimaryMarkets: dashboardProcedure");
    expect(routerSource).toContain("nobitexSearch: dashboardProcedure");
    expect(routerSource).toContain("setFavorite: dashboardProcedure");
    expect(routerSource).toContain("nobitexAsset: dashboardProcedure");
    expect(routerSource).toContain("nobitexMarkets: dashboardProcedure");
    expect(adapterSource).toContain("AbortSignal.timeout");
    expect(adapterSource).toContain("IRR_PER_TOMAN");
    expect(adapterSource).toContain("STALE_TTL_MS");
    expect(adapterSource).toContain("/market/udf/history");
    expect(adapterSource).toContain("getNobitexTomanPerUsd");
    expect(adapterSource).not.toContain("getTabdealIrtAssets");
  });
});
