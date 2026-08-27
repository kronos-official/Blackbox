import { describe, expect, it } from "vitest";
import { formatMarketReply, marketInlineKeyboard, parseMarketCommand } from "./marketCommands";

describe("market command parser and formatter", () => {
  it("recognizes public Persian/English price lookups and administrator toggles", () => {
    expect(parseMarketCommand("قیمت بیت‌کوین")).toEqual({ kind: "price", query: "بیت‌کوین" });
    expect(parseMarketCommand("price BTC")).toEqual({ kind: "price", query: "BTC" });
    expect(parseMarketCommand("قیمت شیبا اینو")).toEqual({ kind: "price", query: "شیبا اینو" });
    expect(parseMarketCommand("price BABYDOGE")).toEqual({ kind: "price", query: "BABYDOGE" });
    expect(parseMarketCommand("قیمت PEPE")).toEqual({ kind: "price", query: "PEPE" });
    expect(parseMarketCommand("صرافی روشن")).toEqual({ kind: "toggle", enabled: true });
    expect(parseMarketCommand("صرافی خاموش")).toEqual({ kind: "toggle", enabled: false });
    expect(parseMarketCommand("قیمت")).toBeNull();
  });

  it("formats live market data in a compact USD-first hierarchy", () => {
    const message = formatMarketReply({ assetId: "btc", symbol: "BTC", market: "BTC/IRT", latestToman: 12_345_678, priceUsd: 61_234.5, markToman: 12_300_000, bestBuyToman: 12_300_000, bestSellToman: 12_400_000, dayLowToman: 12_000_000, dayHighToman: 12_600_000, dayOpenToman: 12_100_000, dayChangePercent: 2.12, volumeAsset: 10, volumeToman: 1_000_000, updatedAt: "2026-08-26T00:00:00.000Z", chart: [], isStale: false, chartIsStale: false });
    expect(message).toContain("BTC · بیت‌کوین");
    expect(message).toContain("دلار");
    expect(message).toContain("تومان");
    expect(message).toContain("تغییر ۲۴ساعته");
    expect(message).toContain("کف/سقف امروز");
    expect(message).toContain("حجم ۲۴ساعته");
    expect(message).toContain("خرید ");
    expect(message).toContain("فاصله ");
    expect(message).toContain("۱٬۰۰۰٬۰۰۰ تومان");
    expect(message).not.toContain("قیمت آغاز ۲۴ ساعته");
    expect(message).not.toContain("موقعیت در بازهٔ روزانه");
    expect(message).not.toContain("فاصلهٔ خرید/فروش");
    expect(message).toContain("$61,234.5");
  });

  it("builds compact related-market callbacks with native primary styling and no emoji prefix", () => {
    const keyboard = marketInlineKeyboard({ assetId: "btc", symbol: "BTC", market: "BTC/IRT", latestToman: 1, priceUsd: 1, markToman: 1, bestBuyToman: 1, bestSellToman: 1, dayLowToman: 1, dayHighToman: 1, dayOpenToman: 1, dayChangePercent: 0, volumeAsset: null, volumeToman: null, updatedAt: "2026-08-26T00:00:00.000Z", chart: [], isStale: false, chartIsStale: false });
    expect(keyboard.inline_keyboard[0]).toEqual(expect.arrayContaining([expect.objectContaining({ text: "ETH (اتریوم)", callback_data: "market-price:eth", style: "primary" })]));
  });

  it("does not offer inactive related markets in inline buttons", () => {
    const keyboard = marketInlineKeyboard({ assetId: "btc", symbol: "BTC", market: "BTC/IRT", latestToman: 1, priceUsd: 1, markToman: 1, bestBuyToman: 1, bestSellToman: 1, dayLowToman: 1, dayHighToman: 1, dayOpenToman: 1, dayChangePercent: 0, volumeAsset: null, volumeToman: null, updatedAt: "2026-08-26T00:00:00.000Z", chart: [], isStale: false, chartIsStale: false }, new Set(["btc", "usdt"]));
    expect(keyboard.inline_keyboard[0]).toEqual([expect.objectContaining({ callback_data: "market-price:usdt" })]);
  });
});
