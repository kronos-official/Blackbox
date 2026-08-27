import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPublicMemeMarketCache, getPublicMemeChart, getPublicMemeQuotes, resolvePublicMemeAssetId } from "./publicMemeMarkets";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("public meme market fallback", () => {
  afterEach(() => { vi.unstubAllGlobals(); clearPublicMemeMarketCache(); });

  it("resolves Persian and English aliases without hard-coded prices", () => {
    expect(resolvePublicMemeAssetId("SHIB")).toBe("shib");
    expect(resolvePublicMemeAssetId("شیبا اینو")).toBe("shib");
    expect(resolvePublicMemeAssetId("PEPE")).toBe("pepe");
    expect(resolvePublicMemeAssetId("بیبی دوج")).toBe("babydoge");
  });

  it("converts live USD quotes to Toman and preserves 24-hour metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      "shiba-inu": { usd: 0.00002, usd_24h_change: 4.2, usd_24h_vol: 12_000_000, usd_24h_low: 0.000019, usd_24h_high: 0.000021, last_updated_at: 1_700_000_000 },
      pepe: { usd: 0.00001, usd_24h_change: -2.5, usd_24h_vol: 8_000_000, last_updated_at: 1_700_000_001 },
      "baby-doge-coin": { usd: 0.000000001, usd_24h_change: 1.1, usd_24h_vol: 2_000_000, last_updated_at: 1_700_000_002 },
    })));

    const quotes = await getPublicMemeQuotes(200_000, 1_700_004_000_000);

    expect(quotes).toHaveLength(3);
    expect(quotes).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: "shib", symbol: "SHIB", priceUsd: 0.00002, latestToman: 4, dayChangePercent: 4.2, volumeToman: 2_400_000_000_000 }),
      expect.objectContaining({ assetId: "pepe", symbol: "PEPE", dayChangePercent: -2.5 }),
      expect.objectContaining({ assetId: "babydoge", symbol: "BABYDOGE", priceUsd: 0.000000001 }),
    ]));
  });

  it("converts live price history into renderable toman candles for tiny-price assets", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      expect(String(input)).toContain("/coins/shiba-inu/market_chart");
      return jsonResponse({ prices: [[1_700_000_000_000, 0.000005], [1_700_003_600_000, 0.0000052]], total_volumes: [[1_700_000_000_000, 1_000_000], [1_700_003_600_000, 1_100_000]] });
    }));

    const chart = await getPublicMemeChart("shib", 200_000, "1d");

    expect(chart).toHaveLength(2);
    expect(chart[0]).toMatchObject({ closeToman: 1, openToman: 1 });
    expect(chart[0].volumeUsdt).toBeCloseTo(200_000_000_000, 3);
    expect(chart[1]).toMatchObject({ closeToman: 1.04, openToman: 1, highToman: 1.04, lowToman: 1 });
  });

  it("reuses a recent successful quote snapshot when the public source temporarily returns 429", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ "shiba-inu": { usd: 0.00002 }, pepe: { usd: 0.00001 }, "baby-doge-coin": { usd: 0.000000001 } }))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await getPublicMemeQuotes(200_000, 1_700_000_000_000);
    const quotes = await getPublicMemeQuotes(200_000, 1_700_000_025_000);
    expect(quotes).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(quotes.every(quote => quote.isStale === true)).toBe(true);
  });
});
