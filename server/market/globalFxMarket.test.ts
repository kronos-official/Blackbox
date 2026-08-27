import { beforeEach, describe, expect, it, vi } from "vitest";
import { getGlobalFxRates, resetGlobalFxCacheForTests } from "./globalFxMarket";

describe("global FX market adapter", () => {
  beforeEach(() => {
    resetGlobalFxCacheForTests();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ result: "success", time_last_update_unix: 1_700_004_000, rates: { USD: 1, EUR: 0.5, GBP: 0.25, CNY: 5, IRR: 1_500_000 } }), { status: 200 })));
  });

  it("converts all returned world currencies from USD into toman", async () => {
    const result = await getGlobalFxRates(200_000, 1_700_004_000_000);
    expect(result.source).toBe("global-fx");
    expect(result.rates).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: "EUR", name: "یورو", unitsPerUsd: 0.5 }),
      expect.objectContaining({ symbol: "GBP", name: "پوند انگلیس", unitsPerUsd: 0.25 }),
      expect.objectContaining({ symbol: "CNY", name: "یوان چین", unitsPerUsd: 5 }),
      expect.objectContaining({ symbol: "IRR", name: "ریال ایران", unitsPerUsd: 1_500_000 }),
    ]));
    expect(result.rates).toHaveLength(4);
  });

  it("keeps the last valid global snapshot stale during a short outage", async () => {
    await getGlobalFxRates(200_000, 1_700_004_000_000);
    vi.mocked(fetch).mockRejectedValue(new Error("global provider offline"));
    const result = await getGlobalFxRates(200_000, 1_700_004_060_000);
    expect(result.isStale).toBe(true);
    expect(result.rates).toHaveLength(4);
  });

  it("falls back to the secondary USD-based provider when the primary source is unavailable", async () => {
    vi.mocked(fetch).mockImplementation(async (input: string | URL) => {
      if (String(input).includes("open.er-api.com")) throw new Error("primary offline");
      return new Response(JSON.stringify({ amount: 1, base: "USD", date: "2026-08-26", rates: { EUR: 0.85, GBP: 0.73, CNY: 6.72 } }), { status: 200 });
    });

    const result = await getGlobalFxRates(200_000, 1_700_004_000_000);

    expect(result.rates).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: "EUR", unitsPerUsd: 0.85 }),
      expect.objectContaining({ symbol: "GBP", unitsPerUsd: 0.73 }),
      expect.objectContaining({ symbol: "CNY", unitsPerUsd: 6.72 }),
    ]));
  });
});
