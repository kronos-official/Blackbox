import { describe, expect, it } from "vitest";
import { parseStatsPublication } from "./useNobitexRealtime";

describe("live market publication parser", () => {
  it("converts public rial market updates into exact toman quotes and preserves bid/ask", () => {
    expect(parseStatsPublication({
      "usdt-rls": { latest: "2023400", bestBuy: "2021200", bestSell: "2023400", dayChange: "1.17", isClosed: false },
      "btc-rls": { latest: "157901571180", bestBuy: "157800000000", bestSell: "158000000000", dayChange: "-0.48", isClosed: false },
    })).toEqual([
      expect.objectContaining({ symbol: "USDT", latestToman: 202_340, bestBuyToman: 202_120, bestSellToman: 202_340, dayChangePercent: 1.17 }),
      expect.objectContaining({ symbol: "BTC", latestToman: 15_790_157_118, dayChangePercent: -0.48 }),
    ]);
  });

  it("drops closed, malformed, and non-rial markets instead of displaying an invented price", () => {
    expect(parseStatsPublication({
      "test-rls": { latest: "1", bestBuy: "1", bestSell: "1", dayChange: "0", isClosed: true },
      "eth-usdt": { latest: "1", bestBuy: "1", bestSell: "1", dayChange: "0", isClosed: false },
      "doge-rls": { latest: "not-a-price", bestBuy: "1", bestSell: "1", dayChange: "0", isClosed: false },
    })).toEqual([]);
  });
});
