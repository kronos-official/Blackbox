import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ tomanReference: vi.fn() }));
vi.mock("./nobitexMarket", () => ({ getNobitexTomanPerUsdReference: mocks.tomanReference }));

import { getIranMacroMarkets, parseIranGoldGradeQuotes, parseIranGoldGramToman, parseIranSilver925GramToman, parseIranSilverGramToman, resetIranMacroMarketCacheForTests } from "./iranMacroMarket";

const bonbastHtml = `
  <span id="usd1">200,000</span><span id="usd2">199,000</span>
  <span id="eur1">220,000</span><span id="eur2">219,000</span>
  <span id="gbp1">255,000</span><span id="gbp2">254,000</span>
  <span id="gol18">18,500,000</span>
`;

const talaGoldHtml = `<h2>آخرین قیمت</h2><h3 class="bg-green-light">۲۱,۵۹۳,۱۰۲</h3>
  <h4>عیار 24 یا شمش</h4><h5>۲۸,۷۹۱,۰۰۰</h5>
  <h4>عیار 22</h4><h5>۲۶,۳۹۲,۰۰۰</h5>
  <h4>عیار 21</h4><h5>۲۵,۱۹۲,۰۰۰</h5>
  <h4>عیار 20</h4><h5>۲۳,۹۸۲,۰۰۰</h5>
  <h4>عیار 750 یا 18</h4><h5>۲۱,۵۹۳,۱۰۰</h5>
  <h4>عیار 16</h4><h5>۱۹,۱۶۰,۰۰۰</h5>
  <h4>عیار 14</h4><h5>۱۶,۷۵۸,۰۰۰</h5>`;
const tindexSilverHtml = `<div class="value tnum">462,000<span class="unit">Toman/gram</span></div>`;
const tgjuSilver925Html = `<span data-col="info.last_trade.PDrCotVal">4,289,290</span>`;

describe("Iranian macro market adapter", () => {
  beforeEach(() => {
    resetIranMacroMarketCacheForTests();
    mocks.tomanReference.mockReset();
    mocks.tomanReference.mockResolvedValue({ tomanPerUsd: 200_000, fetchedAtMs: 1_700_004_000_000, isStale: false });
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      if (String(input).includes("tala.ir/price/18k")) return new Response(talaGoldHtml, { status: 200 });
      if (String(input).includes("tindex.app/en/indicators/precious-metals/SILVER-999")) return new Response(tindexSilverHtml, { status: 200 });
      if (String(input).includes("tgju.org/profile/silver_925")) return new Response(tgjuSilver925Html, { status: 200 });
      if (String(input).includes("gold-api.com/price/")) return new Response(JSON.stringify({ price: String(input).endsWith("XAU") ? 2_000 : String(input).endsWith("XAG") ? 25 : 1_000 }), { status: 200 });
      if (String(input).includes("finance.yahoo.com")) return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 4 } }] } }), { status: 200 });
      return new Response(bonbastHtml, { status: 200, headers: { "content-type": "text/html" } });
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("parses live Iranian gram quotes for gold and silver without deriving them from global ounces", async () => {
    const result = await getIranMacroMarkets(1_700_004_000_000);
    const usd = result.markets.find(asset => asset.symbol === "USD");
    const gold = result.markets.find(asset => asset.symbol === "GOLD");
    const silver = result.markets.find(asset => asset.symbol === "SILVER");
    const copper = result.markets.find(asset => asset.symbol === "XCU");

    expect(usd).toMatchObject({ latestToman: 200_000, priceUsd: 1, buyToman: 199_000, sellToman: 200_000, isStale: false, source: "bonbast" });
    expect(result.markets.find(asset => asset.symbol === "EUR")).toMatchObject({ latestToman: 220_000, priceUsd: 1.1 });
    expect(gold).toMatchObject({ latestToman: 21_593_102, unit: "تومان", quoteUnit: "هر گرم", source: "tala-ir", iranGramOnly: true });
    expect(silver).toMatchObject({ latestToman: 462_000, unit: "تومان", quoteUnit: "هر گرم", source: "tindex", iranGramOnly: true });
    expect(gold?.gradeQuotes).toEqual([
      { label: "طلای ۲۴ عیار", latestToman: 28_791_000 },
      { label: "طلای ۲۲ عیار", latestToman: 26_392_000 },
      { label: "طلای ۱۸ عیار", latestToman: 21_593_100 },
    ]);
    expect(gold?.gradeQuotes?.find(quote => quote.label === "طلای ۲۴ عیار")).toMatchObject({ latestToman: 28_791_000 });
    expect(silver?.gradeQuotes).toHaveLength(2);
    expect(silver?.gradeQuotes?.find(quote => quote.label === "نقره ۹۲۵")).toMatchObject({ latestToman: 428_929 });
    expect(gold?.symbol).not.toBe("XAU");
    expect(silver?.symbol).not.toBe("XAG");
    expect(copper).toMatchObject({ latestToman: 800_000, priceUsd: 4, symbol: "XCU", quoteUnit: "پوند", source: "yahoo-finance" });
    expect(result.markets.slice(0, 3).map(asset => asset.symbol)).toEqual(["USD", "EUR", "GBP"]);
    expect(result.markets.length).toBeGreaterThanOrEqual(8);
  });

  it("uses the last valid snapshot as stale rather than inventing a rate", async () => {
    await getIranMacroMarkets(1_700_004_000_000);
    vi.mocked(fetch).mockRejectedValue(new Error("source offline"));
    const result = await getIranMacroMarkets(1_700_004_060_000);
    expect(result.markets.find(asset => asset.symbol === "USD")).toMatchObject({ latestToman: 200_000, isStale: true });
  });

  it("keeps currencies and metals populated when Bonbast is unavailable", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("bonbast.com")) throw new Error("Bonbast unavailable");
      if (url.includes("tala.ir/price/18k")) return new Response(talaGoldHtml, { status: 200 });
      if (url.includes("tindex.app/en/indicators/precious-metals/SILVER-999")) return new Response(tindexSilverHtml, { status: 200 });
      if (url.includes("tgju.org/profile/silver_925")) return new Response(tgjuSilver925Html, { status: 200 });
      if (url.includes("open.er-api.com")) return new Response(JSON.stringify({ result: "success", time_last_update_unix: 1_700_004_000, rates: { USD: 1, EUR: 0.9, GBP: 0.8, CNY: 7.2, BHD: 0.376, JOD: 0.709, YER: 237.01 } }), { status: 200 });
      if (url.includes("gold-api.com/price/")) return new Response(JSON.stringify({ price: url.endsWith("XAU") ? 2_000 : 25 }), { status: 200 });
      if (url.includes("finance.yahoo.com")) return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 4 } }] } }), { status: 200 });
      throw new Error(`Unexpected URL ${url}`);
    });

    const result = await getIranMacroMarkets(1_700_004_000_000);

    expect(mocks.tomanReference).toHaveBeenCalled();
    expect(result.markets.find(asset => asset.symbol === "USD")).toMatchObject({ latestToman: 200_000, priceUsd: 1, source: "nobitex" });
    expect(result.markets.find(asset => asset.symbol === "EUR")).toMatchObject({ latestToman: 222_222.22222222222, priceUsd: 1.1111111111111112, source: "global-fx" });
    expect(result.markets.find(asset => asset.symbol === "BHD")).toMatchObject({ name: "دینار بحرین", source: "global-fx" });
    expect(result.markets.find(asset => asset.symbol === "JOD")).toMatchObject({ name: "دینار اردن", source: "global-fx" });
    expect(result.markets.find(asset => asset.symbol === "YER")).toMatchObject({ name: "ریال یمن", source: "global-fx" });
    expect(result.markets.find(asset => asset.symbol === "GOLD")).toMatchObject({ latestToman: 21_593_102, source: "tala-ir", iranGramOnly: true });
    expect(result.markets.find(asset => asset.symbol === "SILVER")).toMatchObject({ latestToman: 462_000, source: "tindex", iranGramOnly: true });
    expect(result.markets.find(asset => asset.symbol === "XCU")).toMatchObject({ latestToman: 800_000, priceUsd: 4, source: "yahoo-finance" });
  });

  it("parses only the three approved direct Iranian gold purities", () => {
    expect(parseIranGoldGramToman(talaGoldHtml)).toBe(21_593_102);
    expect(parseIranSilverGramToman(tindexSilverHtml)).toBe(462_000);
    expect(parseIranGoldGradeQuotes(talaGoldHtml).map(quote => quote.label)).toEqual([
      "طلای ۲۴ عیار",
      "طلای ۲۲ عیار",
      "طلای ۱۸ عیار",
    ]);
    expect(parseIranSilver925GramToman(tgjuSilver925Html)).toBe(428_929);
  });
});
