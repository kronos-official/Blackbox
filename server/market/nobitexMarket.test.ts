import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getNobitexAssetMarket, getNobitexPrimaryMarkets, getNobitexTopMarkets, getNobitexUsdtMarket, NOBITEX_PRIMARY_ASSET_IDS, resetNobitexMarketCacheForTests, resolveNobitexActiveMarket, searchNobitexMarkets } from "./nobitexMarket";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function statsResponse(latest = "2023400") {
  return {
    status: "ok",
    stats: {
      "usdt-rls": {
        bestSell: "2023400", bestBuy: "2021200", volumeSrc: "183.5", volumeDst: "371337000", latest,
        mark: "2022200", dayLow: "1990000", dayHigh: "2040000", dayOpen: "2000000", dayClose: latest, dayChange: "1.17",
      },
    },
  };
}

function chartResponse() {
  return { s: "ok", t: [1_700_000_000, 1_700_003_600], o: [202_000, 202_100], h: [202_300, 202_500], l: [201_900, 202_000], c: [202_100, 202_340], v: [20, 32] };
}

describe("Nobitex USDT market adapter", () => {
  beforeEach(() => {
    resetNobitexMarketCacheForTests();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/market/stats")) return jsonResponse(statsResponse());
      if (url.includes("/market/udf/history")) return jsonResponse(chartResponse());
      throw new Error(`Unexpected URL: ${url}`);
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("converts official IRR ticker values to Toman and returns real OHLC candles", async () => {
    const market = await getNobitexUsdtMarket("1d", 1_700_004_000_000);

    expect(market).toMatchObject({
      source: "nobitex", market: "USDT/IRT", latestToman: 202_340, markToman: 202_220,
      bestBuyToman: 202_120, bestSellToman: 202_340, dayLowToman: 199_000, dayHighToman: 204_000,
      dayChangePercent: 1.17, isStale: false, chartIsStale: false,
    });
    expect(market.chart).toEqual([
      expect.objectContaining({ time: 1_700_000_000_000, openToman: 202_000, highToman: 202_300, lowToman: 201_900, closeToman: 202_100, volumeUsdt: 20 }),
      expect.objectContaining({ time: 1_700_003_600_000, closeToman: 202_340, volumeUsdt: 32 }),
    ]);
    expect(vi.mocked(fetch).mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
      expect.stringContaining("srcCurrency=usdt&dstCurrency=rls"),
      expect.stringContaining("symbol=USDTIRT"),
    ]));
  });

  it("refreshes the live ticker after the five-second coalescing window", async () => {
    await getNobitexUsdtMarket("1d", 1_700_004_000_000);
    const callsAfterFirstRead = vi.mocked(fetch).mock.calls.length;
    await getNobitexUsdtMarket("1d", 1_700_004_004_999);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(callsAfterFirstRead);
    await getNobitexUsdtMarket("1d", 1_700_004_005_001);
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(callsAfterFirstRead);
  });

  it("returns the last known valid Nobitex snapshot as explicitly stale when the provider is temporarily unavailable", async () => {
    await getNobitexUsdtMarket("1d", 1_700_004_000_000);
    vi.mocked(fetch).mockRejectedValue(new Error("provider offline"));

    await expect(getNobitexUsdtMarket("1d", 1_700_004_060_000)).resolves.toMatchObject({ latestToman: 202_340, isStale: true, chartIsStale: true });
  });

  it("returns a selected primary asset with its own live ticker and real IRT chart", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("srcCurrency=btc")) return jsonResponse({ status: "ok", stats: { "btc-rls": { bestSell: "157000000000", bestBuy: "156900000000", volumeSrc: "15", volumeDst: "2300000000000", latest: "156950000000", mark: "156920000000", dayLow: "152000000000", dayHigh: "160000000000", dayOpen: "154000000000", dayChange: "1.92" } } });
      if (url.includes("srcCurrency=usdt")) return jsonResponse(statsResponse());
      if (url.includes("symbol=BTCIRT")) return jsonResponse({ s: "ok", t: [1_700_000_000, 1_700_003_600], o: [15_620_000_000, 15_650_000_000], h: [15_700_000_000, 15_720_000_000], l: [15_610_000_000, 15_640_000_000], c: [15_650_000_000, 15_695_000_000], v: [0.2, 0.4] });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const market = await getNobitexAssetMarket("btc", "1d", 1_700_004_000_000);

    expect(market).toMatchObject({ assetId: "btc", symbol: "BTC", market: "BTC/IRT", latestToman: 15_695_000_000, bestBuyToman: 15_690_000_000, bestSellToman: 15_700_000_000, volumeAsset: 15, isStale: false, chartIsStale: false });
    expect(market.priceUsd).toBeCloseTo(15_695_000_000 / 202_340, 4);
    expect(market.chart).toEqual(expect.arrayContaining([expect.objectContaining({ closeToman: 15_695_000_000 })]));
  });

  it("returns primary market cards from one active ticker snapshot so initial Mini App loading stays bounded", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("dstCurrency")).toBe("rls");
      expect(url.searchParams.get("srcCurrency")).toBeNull();
      return jsonResponse({ status: "ok", stats: Object.fromEntries(NOBITEX_PRIMARY_ASSET_IDS.map((asset, index) => [`${asset}-rls`, { bestSell: "1010", bestBuy: "990", latest: "1000", dayChange: "2.04", volumeDst: String(10_000 + index), isClosed: false }])) });
    });

    const result = await getNobitexPrimaryMarkets("1d", 1_700_004_000_000);

    expect(result.markets.slice(0, 6).map(item => item.symbol)).toEqual(["USDT", "BTC", "ETH", "TRX", "TON", "GRAM"]);
    expect(result.markets).toHaveLength(60);
    expect(new Set(result.markets.map(item => item.id))).toHaveLength(60);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(result.markets.every(item => item.priceUsd !== null)).toBe(true);
  });

  it("fills an unavailable configured primary market from the same active snapshot to preserve 60 live cards", async () => {
    const availablePrimary = NOBITEX_PRIMARY_ASSET_IDS.filter(assetId => assetId !== "flow");
    const fillerAssets = ["rnd0", "rnd1", "rnd2"];
    vi.mocked(fetch).mockImplementation(async () => jsonResponse({ status: "ok", stats: Object.fromEntries([...availablePrimary, ...fillerAssets].map((asset, index) => [`${asset}-rls`, { bestSell: "1010", bestBuy: "990", latest: "1000", dayChange: "2.04", volumeDst: String(10_000 + index), isClosed: false }])) }));

    const result = await getNobitexPrimaryMarkets("1d", 1_700_007_000_000);

    expect(result.markets).toHaveLength(60);
    expect(result.markets.some(item => item.symbol.startsWith("RND"))).toBe(true);
    expect(result.markets.map(item => item.symbol)).not.toContain("FLOW");
  });

  it("retains SHIB, PEPE and BABYDOGE through their dedicated live tickers when the bulk snapshot omits them", async () => {
    const omittedMemeAssets = new Set(["shib", "pepe", "babydoge"]);
    const snapshotAssets = NOBITEX_PRIMARY_ASSET_IDS.filter(assetId => !omittedMemeAssets.has(assetId));
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("dstCurrency=rls") && !url.includes("srcCurrency=")) {
        return jsonResponse({ status: "ok", stats: Object.fromEntries(snapshotAssets.map((asset, index) => [`${asset}-rls`, { bestSell: "1010", bestBuy: "990", latest: "1000", dayChange: "2.04", volumeDst: String(10_000 + index), isClosed: false }])) });
      }
      if (url.includes("srcCurrency=usdt")) return jsonResponse({ status: "ok", stats: { "usdt-rls": { bestSell: "2001000", bestBuy: "1999000", latest: "2000000", dayChange: "0", volumeDst: "10000", isClosed: false } } });
      const asset = ["shib", "pepe", "babydoge"].find(candidate => url.includes(`srcCurrency=${candidate}`));
      if (asset) return jsonResponse({ status: "ok", stats: { [`${asset}-rls`]: { bestSell: "1010", bestBuy: "990", latest: "1000", dayChange: "2.04", volumeDst: "10000", isClosed: false } } });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await getNobitexPrimaryMarkets("1d", 1_700_008_000_000);

    expect(result.markets.map(item => item.symbol)).toEqual(expect.arrayContaining(["SHIB", "PEPE", "BABYDOGE"]));
  });

  it("uses a live public fallback for SHIB, PEPE and BABYDOGE when Nobitex omits them", async () => {
    const omitted = new Set(["shib", "pepe", "babydoge"]);
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("dstCurrency=rls") && !url.includes("srcCurrency=")) {
        return jsonResponse({ status: "ok", stats: Object.fromEntries(NOBITEX_PRIMARY_ASSET_IDS.filter(asset => !omitted.has(asset)).map((asset, index) => [`${asset}-rls`, { latest: "1000", bestBuy: "990", bestSell: "1010", volumeDst: String(10_000 + index), dayChange: "0", isClosed: false }])) });
      }
      if (url.includes("srcCurrency=usdt")) return jsonResponse(statsResponse("2000000"));
      if (url.includes("api.coingecko.com")) return jsonResponse({
        "shiba-inu": { usd: 0.00002, usd_24h_change: 1, usd_24h_vol: 1000 },
        pepe: { usd: 0.00001, usd_24h_change: 2, usd_24h_vol: 1000 },
        "baby-doge-coin": { usd: 0.000000001, usd_24h_change: 3, usd_24h_vol: 1000 },
      });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await getNobitexPrimaryMarkets("1d", 1_700_009_000_000);

    expect(result.markets.map(item => item.symbol)).toEqual(expect.arrayContaining(["SHIB", "PEPE", "BABYDOGE"]));
    expect(result.markets.filter(item => ["SHIB", "PEPE", "BABYDOGE"].includes(item.symbol)).every(item => item.priceUsd !== null)).toBe(true);
  });

  it("uses Wallex USDT/TMN as a live conversion fallback for a public SHIB quote when Nobitex is unavailable", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("srcCurrency=usdt")) throw new Error("Nobitex DNS unavailable");
      if (url.includes("api.wallex.ir/v1/markets")) return jsonResponse({ result: { symbols: { USDTTMN: { stats: { lastPrice: 205000 } } } } });
      if (url.includes("api.coingecko.com")) return jsonResponse({ "shiba-inu": { usd: 0.000005, usd_24h_change: 2, usd_24h_vol: 1000 } });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const market = await getNobitexAssetMarket("shib", "1d", 1_700_010_000_000, { allowMissingChart: true });
    expect(market).toMatchObject({ assetId: "shib", symbol: "SHIB", priceUsd: 0.000005, isStale: false });
    expect(market.latestToman).toBeCloseTo(1.025, 10);
  });

  it("resolves important configured assets directly when the bulk snapshot omits them", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("dstCurrency=rls") && !url.includes("srcCurrency=")) return jsonResponse({ status: "ok", stats: { "btc-rls": { latest: "1000000000", bestBuy: "999000000", bestSell: "1001000000", volumeDst: "10000", dayChange: "0", isClosed: false } } });
      if (url.includes("srcCurrency=avax")) return jsonResponse({ status: "ok", stats: { "avax-rls": { latest: "250000000", bestBuy: "249000000", bestSell: "251000000", volumeDst: "20000", dayChange: "1.5", isClosed: false } } });
      if (url.includes("srcCurrency=usdt")) return jsonResponse(statsResponse("2050000"));
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(resolveNobitexActiveMarket("آوالانچ", 1_700_011_000_000)).resolves.toMatchObject({ id: "avax-rls", symbol: "AVAX", latestToman: 25_000_000 });
    await expect(searchNobitexMarkets("آوالانچ", "1d", 1_700_011_000_000)).resolves.toMatchObject({ markets: [expect.objectContaining({ id: "avax-rls", symbol: "AVAX", chartVerified: false })] });
  });

  it("returns active rial markets in descending actual toman volume and excludes closed markets", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("dstCurrency=rls") && !url.includes("srcCurrency=usdt")) {
        return jsonResponse({ status: "ok", stats: {
          "btc-rls": { bestSell: "1500000000", bestBuy: "1490000000", latest: "1495000000", dayChange: "2.4", volumeDst: "100000000000", isClosed: false },
          "usdt-rls": { bestSell: "2023400", bestBuy: "2021200", latest: "2023400", dayChange: "1.17", volumeDst: "300000000000", isClosed: false },
          "test-rls": { bestSell: "1", bestBuy: "1", latest: "1", dayChange: "0", volumeDst: "999999999999", isClosed: true },
        } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await getNobitexTopMarkets(10, 1_700_004_000_000);

    expect(result).toMatchObject({ source: "nobitex", isStale: false });
    expect(result.markets).toEqual([
      expect.objectContaining({ id: "usdt-rls", market: "USDT/IRT", latestToman: 202_340, bestBuyToman: 202_120 }),
      expect.objectContaining({ id: "btc-rls", market: "BTC/IRT", latestToman: 149_500_000 }),
    ]);
  });

  it("searches across the complete active rial-market snapshot while excluding closed or invalid quotes", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("dstCurrency=rls") && !url.includes("srcCurrency=")) return jsonResponse({ status: "ok", stats: {
        "avax-rls": { bestSell: "0", bestBuy: "0", latest: "219500000", dayChange: "1.1", volumeDst: "90000000000", isClosed: false },
        "atom-rls": { bestSell: "20000000", bestBuy: "19900000", latest: "19950000", dayChange: "-0.4", volumeDst: "20000000000", isClosed: false },
        "avax2-rls": { bestSell: "1", bestBuy: "1", latest: "1", dayChange: "0", volumeDst: "99999999999", isClosed: true },
      } });
      if (url.includes("srcCurrency=avax")) return jsonResponse({ status: "ok", stats: { "avax-rls": { bestSell: "0", bestBuy: "0", latest: "219500000", mark: "219500000", dayLow: "210000000", dayHigh: "225000000", dayOpen: "217000000", dayChange: "1.1", volumeSrc: "8", volumeDst: "90000000000", isClosed: false } } });
      if (url.includes("srcCurrency=atom")) return jsonResponse({ status: "ok", stats: { "atom-rls": { bestSell: "20000000", bestBuy: "19900000", latest: "19950000", mark: "19950000", dayLow: "19000000", dayHigh: "21000000", dayOpen: "20000000", dayChange: "-0.4", volumeSrc: "12", volumeDst: "20000000000", isClosed: false } } });
      if (url.includes("symbol=AVAXIRT")) return jsonResponse(chartResponse());
      if (url.includes("symbol=ATOMIRT")) return jsonResponse({ s: "ok", t: [1_700_000_000], o: [100], h: [110], l: [90], c: [100], v: [2] });
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await searchNobitexMarkets("av", "1d", 1_700_004_000_000);

    expect(result.markets).toEqual([expect.objectContaining({ id: "avax-rls", symbol: "AVAX", latestToman: 21_950_000, bestBuyToman: 21_950_000, bestSellToman: 21_950_000 })]);
    await expect(searchNobitexMarkets("آوالانچ", "1d", 1_700_004_000_000)).resolves.toMatchObject({ markets: [expect.objectContaining({ symbol: "AVAX" })] });
  });

  it("resolves active Mini App assets by exact symbol and Persian aliases without requesting an OHLC chart", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("dstCurrency=rls") && !url.includes("srcCurrency=")) return jsonResponse({ status: "ok", stats: {
        "shib-rls": { bestSell: "100", bestBuy: "99", latest: "100", dayChange: "1", volumeDst: "10000", isClosed: false },
        "avax-rls": { bestSell: "200", bestBuy: "199", latest: "200", dayChange: "1", volumeDst: "10000", isClosed: false },
        "babydoge-rls": { bestSell: "300", bestBuy: "299", latest: "300", dayChange: "1", volumeDst: "10000", isClosed: false },
      } });
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(resolveNobitexActiveMarket("SHIB", 1_700_005_000_000)).resolves.toMatchObject({ id: "shib-rls" });
    await expect(resolveNobitexActiveMarket("آوالانچ", 1_700_005_000_000)).resolves.toMatchObject({ id: "avax-rls" });
    await expect(resolveNobitexActiveMarket("بیبی دوج", 1_700_005_000_000)).resolves.toMatchObject({ id: "babydoge-rls" });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("resolves every configured Mini App primary asset from one active market snapshot", async () => {
    const stats = Object.fromEntries(NOBITEX_PRIMARY_ASSET_IDS.map((assetId, index) => [`${assetId}-rls`, {
      bestSell: String(1_000 + index), bestBuy: String(999 + index), latest: String(1_000 + index), dayChange: "0", volumeDst: "10000", isClosed: false,
    }]));
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      if (String(input).includes("dstCurrency=rls") && !String(input).includes("srcCurrency=")) return jsonResponse({ status: "ok", stats });
      throw new Error(`Unexpected URL: ${String(input)}`);
    });

    const results = await Promise.all(NOBITEX_PRIMARY_ASSET_IDS.map(assetId => resolveNobitexActiveMarket(assetId, 1_700_006_000_000)));
    expect(results).toHaveLength(NOBITEX_PRIMARY_ASSET_IDS.length);
    expect(results.every((market, index) => market?.id === `${NOBITEX_PRIMARY_ASSET_IDS[index]}-rls`)).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("does not silently return a zero or fabricated price when no valid Nobitex snapshot exists", async () => {
    resetNobitexMarketCacheForTests();
    vi.mocked(fetch).mockRejectedValue(new Error("provider offline"));
    await expect(getNobitexUsdtMarket("1d", 1_700_004_000_000)).rejects.toThrow("provider offline");
  });
});
