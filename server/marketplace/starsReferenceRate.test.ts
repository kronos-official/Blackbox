import { describe, expect, it } from "vitest";
import { calculateStarsReference, readFragmentStarUsdReference, readNobitexUsdtIrrReference } from "./starsReferenceRate";

describe("Stars reference rate service", () => {
  it("extracts the current Stars/USD price from the Fragment response", () => {
    const payload = { success: true, stars: { price_per_star_usdt_ton: "0.015000" } };
    expect(readFragmentStarUsdReference(payload)).toBe(0.015);
  });

  it("rejects unavailable or malformed Fragment Stars prices", () => {
    expect(() => readFragmentStarUsdReference({ success: false })).toThrow("Fragment Stars price is unavailable");
    expect(() => readFragmentStarUsdReference({ success: true, stars: { price_per_star_usdt_ton: "0" } })).toThrow("Fragment Stars/USD reference is invalid");
  });

  it("extracts the USDT/IRR mark conversion from Nobitex and falls back to latest", () => {
    expect(readNobitexUsdtIrrReference({ stats: { "usdt-rls": { mark: "750000", latest: "748000" } } })).toBe(750000);
    expect(readNobitexUsdtIrrReference({ stats: { "usdt-rls": { latest: "748000" } } })).toBe(748000);
  });

  it("calculates a Stars amount in USD and Iranian Toman", () => {
    expect(calculateStarsReference(100, 0.015, 750000)).toEqual({
      starsAmount: 100,
      usd: 1.5,
      toman: 112500,
    });
  });

  it("rejects non-positive calculator values", () => {
    expect(() => calculateStarsReference(0, 0.015, 750000)).toThrow("Stars amount is invalid");
  });
});
