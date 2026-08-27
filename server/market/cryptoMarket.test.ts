import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCryptoMarketAsset, getCryptoMarketChart, getCryptoMarketTopAssets, getCryptoMarketTrendSummary, resetCryptoMarketCacheForTests, searchCryptoMarketAssets } from "./cryptoMarket";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("public crypto market service", () => {
  beforeEach(() => {
    resetCryptoMarketCacheForTests();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("fragment-api.space")) return jsonResponse({ success: true, stars: { price_per_star_usdt_ton: "0.02" }, cached_at: "2026-08-21T00:00:00.000Z" });
      if (url.includes("nobitex.ir")) return jsonResponse({ stats: { "usdt-rls": { mark: "750000" } } });
      if (url.includes("wallex.ir")) return jsonResponse({ result: { symbols: { USDTTMN: { stats: { lastPrice: "75000" } } } } });
      if (url.includes("coinpaprika.com/v1/tickers")) return jsonResponse([{ id: "btc-bitcoin", name: "Bitcoin", symbol: "BTC", rank: 1, quotes: { USD: { price: 100, percent_change_24h: 2.5, volume_24h: 500 } } }]);
      if (url.includes("market_chart")) return jsonResponse({ prices: [[1_000, 100], [2_000, 105]] });
      if (url.includes("/search?")) return jsonResponse({ coins: [] });
      if (url.includes("coins/markets")) return jsonResponse([{ id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 100, price_change_percentage_24h: 2.5, market_cap_rank: 1, total_volume: 500, last_updated: "2026-08-21T00:00:00.000Z" }]);
      throw new Error(`Unexpected URL: ${url}`);
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("pins the Fragment-backed Telegram Stars reference before crypto assets and converts it to Toman", async () => {
    const result = await getCryptoMarketTopAssets(2, 1_000);

    expect(result.source).toBe("coingecko");
    expect(result.tomanConversionSource).toBe("nobitex");
    expect(result.data[0]).toMatchObject({ id: "telegram-stars", symbol: "XTR", name: "Telegram Stars", priceUsd: 0.02, priceToman: 1_500, change24h: null, volumeUsd: null });
    expect(result.data[1]).toMatchObject({ id: "bitcoin", priceUsd: 100, priceToman: 7_500_000, change24h: 2.5 });
    expect(result.isStale).toBe(false);
  });

  it("derives an informational 24-hour trend summary from the current real market list", async () => {
    const result = await getCryptoMarketTrendSummary(1_000);

    expect(result).toMatchObject({
      source: "coingecko",
      isStale: false,
      data: {
        trackedAssets: 2,
        assetsWithChange: 1,
        gainers: 1,
        decliners: 0,
        unchanged: 0,
        breadthPercent: 100,
        strongestGainer: expect.objectContaining({ id: "bitcoin", symbol: "BTC", change24h: 2.5 }),
        strongestDecliner: null,
      },
    });
  });

  it("keeps repeated reads inside the live caches without requesting sources again", async () => {
    await getCryptoMarketTopAssets(2, 1_000);
    await getCryptoMarketTopAssets(2, 50_000);

    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("coalesces simultaneous reads for Stars, crypto prices, and USD/Toman conversion", async () => {
    await Promise.all([
      getCryptoMarketTopAssets(2, 1_000),
      getCryptoMarketTopAssets(2, 1_000),
      getCryptoMarketTopAssets(2, 1_000),
    ]);

    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("keeps the latest valid market view available and marks it stale when providers fail", async () => {
    await getCryptoMarketTopAssets(2, 1_000);
    vi.mocked(fetch).mockRejectedValue(new Error("source offline"));

    await expect(getCryptoMarketTopAssets(2, 61_001)).resolves.toMatchObject({
      data: [
        expect.objectContaining({ id: "telegram-stars", priceUsd: 0.02 }),
        expect.objectContaining({ id: "bitcoin", priceUsd: 100 }),
      ],
      source: "coingecko",
      isStale: true,
    });
  });

  it("continues with CoinPaprika and Wallex when both preferred crypto sources are limited", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("fragment-api.space")) return jsonResponse({ success: true, stars: { price_per_star_usdt_ton: "0.02" }, cached_at: "2026-08-21T00:00:00.000Z" });
      if (url.includes("coins/markets") || url.includes("nobitex.ir")) throw new Error("provider limited");
      if (url.includes("coinpaprika.com/v1/tickers")) return jsonResponse([{ id: "btc-bitcoin", name: "Bitcoin", symbol: "BTC", rank: 1, quotes: { USD: { price: 100, percent_change_24h: 2.5, volume_24h: 500 } } }]);
      if (url.includes("wallex.ir")) return jsonResponse({ result: { symbols: { USDTTMN: { stats: { lastPrice: "75000" } } } } });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await getCryptoMarketTopAssets(2, 1_000);

    expect(result.source).toBe("coinpaprika");
    expect(result.tomanConversionSource).toBe("wallex");
    expect(result.data[0]).toMatchObject({ id: "telegram-stars", priceUsd: 0.02, priceToman: 1_500 });
    expect(result.data[1]).toMatchObject({ id: "btc-bitcoin", priceUsd: 100, priceToman: 7_500_000 });
  });

  it("keeps USD market data available when both Toman conversion providers are unavailable", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("coins/markets")) return jsonResponse([{ id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 100, market_cap_rank: 1, last_updated: "2026-08-21T00:00:00.000Z" }]);
      if (url.includes("nobitex.ir") || url.includes("wallex.ir") || url.includes("fragment-api.space")) throw new Error("conversion provider unavailable");
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(getCryptoMarketTopAssets(1, 1_000)).resolves.toMatchObject({
      data: [expect.objectContaining({ id: "bitcoin", priceUsd: 100, priceToman: null })],
      isStale: true,
      source: "coingecko",
    });
  });

  it("finds common Persian crypto names locally and enriches them with a current USD price", async () => {
    const result = await searchCryptoMarketAssets("بیت کوین", 1_000);

    expect(result.data).toContainEqual(expect.objectContaining({ id: "bitcoin", symbol: "BTC", priceUsd: 100 }));
    expect(vi.mocked(fetch).mock.calls.map(([input]) => String(input))).toContainEqual(expect.stringContaining("coins/markets"));
  });

  it("finds Telegram Stars by Persian, English, and XTR search terms", async () => {
    const [persian, english, symbol] = await Promise.all([
      searchCryptoMarketAssets("تلگرام استارز", 1_000),
      searchCryptoMarketAssets("telegram stars", 1_000),
      searchCryptoMarketAssets("xtr", 1_000),
    ]);

    [persian, english, symbol].forEach(result => {
      expect(result.data[0]).toMatchObject({ id: "telegram-stars", symbol: "XTR", priceUsd: 0.02, priceToman: 1_500 });
    });
  });

  it("returns Telegram Stars directly from Fragment without a crypto-asset lookup", async () => {
    const result = await getCryptoMarketAsset("telegram-stars", 1_000);

    expect(result).toMatchObject({
      source: "fragment",
      tomanConversionSource: "nobitex",
      data: { id: "telegram-stars", symbol: "XTR", priceUsd: 0.02, priceToman: 1_500 },
    });
  });

  it("uses the expanded safe upper bound when a user requests the market list", async () => {
    await getCryptoMarketTopAssets(999, 1_000);

    expect(vi.mocked(fetch).mock.calls.map(([input]) => String(input))).toContainEqual(expect.stringContaining("per_page=250"));
  });

  it("enriches local search results with a CoinPaprika price when CoinGecko price lookup is unavailable", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("nobitex.ir")) return jsonResponse({ stats: { "usdt-rls": { mark: "750000" } } });
      if (url.includes("coins/markets")) throw new Error("CoinGecko price lookup unavailable");
      if (url.includes("coinpaprika.com/v1/search")) return jsonResponse({ currencies: [{ id: "btc-bitcoin", name: "Bitcoin", symbol: "BTC", rank: 1 }] });
      if (url.includes("coinpaprika.com/v1/tickers/btc-bitcoin")) return jsonResponse({ id: "btc-bitcoin", name: "Bitcoin", symbol: "BTC", rank: 1, quotes: { USD: { price: 99, percent_change_24h: 1.5, volume_24h: 450 } } });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await searchCryptoMarketAssets("بیت کوین", 1_000);

    expect(result.data).toContainEqual(expect.objectContaining({ id: "bitcoin", symbol: "BTC", priceUsd: 99, priceToman: 7_425_000 }));
  });

  it("returns a one-day USD and Toman chart using the same transparent conversion", async () => {
    const result = await getCryptoMarketChart("bitcoin", "1d", 1_000);

    expect(result.data.points).toEqual([
      { time: 1_000, priceUsd: 100, priceToman: 7_500_000 },
      { time: 2_000, priceUsd: 105, priceToman: 7_875_000 },
    ]);
    expect(result.data.range).toBe("1d");
    expect(result.data.candles).toEqual([]);
  });

  it("uses CoinPaprika historical ticks before Kraken when CoinGecko chart data is unavailable", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("nobitex.ir")) return jsonResponse({ stats: { "usdt-rls": { mark: "750000" } } });
      if (url.includes("market_chart")) throw new Error("CoinGecko chart limited");
      if (url.includes("/historical?")) return jsonResponse([
        { timestamp: "2026-08-20T00:00:00Z", price: 90 },
        { timestamp: "2026-08-20T01:00:00Z", price: 92 },
      ]);
      if (url.includes("coinpaprika.com/v1/search/")) return jsonResponse({ currencies: [{ id: "btc-bitcoin", name: "Bitcoin", symbol: "BTC" }] });
      if (url.includes("coinpaprika.com/v1/tickers/btc-bitcoin")) return jsonResponse({ id: "btc-bitcoin", name: "Bitcoin", symbol: "BTC", rank: 1, quotes: { USD: { price: 92 } } });
      if (url.includes("api.kraken.com")) throw new Error("Kraken should not be queried");
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await getCryptoMarketChart("bitcoin", "1d", Date.parse("2026-08-21T00:00:00Z"), true);

    expect(result.source).toBe("coinpaprika");
    expect(result.data.points).toHaveLength(2);
    expect(result.data.points[0]).toMatchObject({ priceUsd: 90, priceToman: 6_750_000 });
    expect(result.data.candles).toHaveLength(2);
    expect(vi.mocked(fetch).mock.calls.map(([input]) => String(input))).not.toContainEqual(expect.stringContaining("api.kraken.com"));
  });

  it("returns an explicit empty non-stale chart for Stars without generating synthetic history", async () => {
    const result = await getCryptoMarketChart("telegram-stars", "7d", 1_000, true);

    expect(result).toMatchObject({
      source: "fragment",
      isStale: false,
      data: { assetId: "telegram-stars", range: "7d", points: [], candles: [], isStale: false },
    });
  });

  it("derives safe OHLC candles from CoinGecko historical prices only when the chart view requests them", async () => {
    const result = await getCryptoMarketChart("bitcoin", "1d", 1_000, true);

    expect(result.data.candles).toEqual([
      { time: 0, openUsd: 100, highUsd: 105, lowUsd: 100, closeUsd: 105 },
    ]);
  });

  it("fetches independent historical chart ranges for 7 and 30 days", async () => {
    const weekly = await getCryptoMarketChart("bitcoin", "7d", 1_000);
    const monthly = await getCryptoMarketChart("bitcoin", "30d", 1_000);
    const urls = vi.mocked(fetch).mock.calls.map(([input]) => String(input));

    expect(weekly.data.range).toBe("7d");
    expect(monthly.data.range).toBe("30d");
    expect(urls.some(url => url.includes("market_chart?vs_currency=usd&days=7"))).toBe(true);
    expect(urls.some(url => url.includes("market_chart?vs_currency=usd&days=30"))).toBe(true);
  });

  it("degrades to an empty stale chart instead of throwing when the chart provider is unavailable", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("market_chart")) throw new Error("chart provider unavailable");
      if (url.includes("nobitex.ir")) return jsonResponse({ stats: { "usdt-rls": { mark: "750000" } } });
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(getCryptoMarketChart("bitcoin", "7d", 1_000)).resolves.toMatchObject({
      data: { assetId: "bitcoin", range: "7d", points: [], isStale: true },
      isStale: true,
    });
  });

  it("falls back to Kraken hourly OHLC when CoinGecko chart data is unavailable", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("market_chart")) throw new Error("CoinGecko unavailable");
      if (url.includes("api.kraken.com")) return jsonResponse({ error: [], result: { XXBTZUSD: [[1, "99", "101", "98", "100", "100", "2", 5], [2, "104", "106", "103", "105", "105", "3", 6]], last: 2 } });
      if (url.includes("nobitex.ir")) return jsonResponse({ stats: { "usdt-rls": { mark: "750000" } } });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await getCryptoMarketChart("bitcoin", "30d", 1_000, true);

    expect(result.source).toBe("kraken");
    expect(result.data.range).toBe("30d");
    expect(result.data.points).toEqual([
      { time: 1_000, priceUsd: 100, priceToman: 7_500_000 },
      { time: 2_000, priceUsd: 105, priceToman: 7_875_000 },
    ]);
    expect(result.data.candles).toEqual([
      { time: 1_000, openUsd: 99, highUsd: 101, lowUsd: 98, closeUsd: 100 },
      { time: 2_000, openUsd: 104, highUsd: 106, lowUsd: 103, closeUsd: 105 },
    ]);
  });

  it("omits Stars safely when Fragment is unavailable while preserving crypto market data", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("fragment-api.space")) throw new Error("Fragment unavailable");
      if (url.includes("nobitex.ir")) return jsonResponse({ stats: { "usdt-rls": { mark: "750000" } } });
      if (url.includes("coins/markets")) return jsonResponse([{ id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 100, market_cap_rank: 1, last_updated: "2026-08-21T00:00:00.000Z" }]);
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(getCryptoMarketTopAssets(2, 1_000)).resolves.toMatchObject({
      data: [expect.objectContaining({ id: "bitcoin", priceUsd: 100, priceToman: 7_500_000 })],
      source: "coingecko",
    });
  });
});
