// @vitest-environment jsdom
import React, { type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ primary: vi.fn(), stars: vi.fn(), macro: vi.fn(), favorites: vi.fn(), favoriteMarkets: vi.fn(), search: vi.fn(), selected: vi.fn(), mutation: vi.fn(), invalidate: vi.fn(), realtime: vi.fn() }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ dashboard: { cryptoMarket: { favorites: { invalidate: mocks.invalidate } } } }),
    dashboard: { cryptoMarket: {
      nobitexPrimaryMarkets: { useQuery: mocks.primary }, starsReference: { useQuery: mocks.stars }, iranMacroMarkets: { useQuery: mocks.macro }, favorites: { useQuery: mocks.favorites }, nobitexFavoriteMarkets: { useQuery: mocks.favoriteMarkets }, nobitexSearch: { useQuery: mocks.search }, nobitexAsset: { useQuery: mocks.selected }, setFavorite: { useMutation: mocks.mutation },
    } },
  },
}));
vi.mock("@/lib/useNobitexRealtime", () => ({ useNobitexRealtime: mocks.realtime }));
vi.mock("recharts", () => {
  const Frame = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Area: Frame, CartesianGrid: Frame, ResponsiveContainer: Frame, Tooltip: Frame, XAxis: Frame, YAxis: Frame, AreaChart: () => <div data-testid="market-chart" /> };
});

import { ClassicCryptoMarket, formatMarketNumber, formatMarketUsd } from "./ClassicCryptoMarket";

const symbols = ["USDT", "BTC", "ETH", "TRX", "TON", "GRAM", "SOL", "DOGE"];
const names = ["USDT (تتر)", "BTC (بیت‌کوین)", "ETH (اتریوم)", "TRX (ترون)", "TON (تون‌کوین)", "GRAM (گرام)", "SOL (سولانا)", "DOGE (دوج‌کوین)"];
const refetch = vi.fn();
const mutate = vi.fn();
function asset(symbol: string, offset: number) { return { assetId: symbol.toLowerCase(), symbol, market: `${symbol}/IRT`, latestToman: 100_000 + offset, markToman: 100_000 + offset, bestBuyToman: 99_900 + offset, bestSellToman: 100_100 + offset, dayLowToman: 98_000 + offset, dayHighToman: 102_000 + offset, dayChangePercent: 1.5, volumeAsset: 100, volumeToman: 10_000_000, updatedAt: "2026-08-25T00:00:00.000Z", isStale: false, chartIsStale: false, chart: [{ time: 1_700_000_000_000, openToman: 99_000 + offset, highToman: 100_000 + offset, lowToman: 98_000 + offset, closeToman: 99_500 + offset, volumeUsdt: 12 }, { time: 1_700_003_600_000, openToman: 99_500 + offset, highToman: 101_000 + offset, lowToman: 99_000 + offset, closeToman: 100_000 + offset, volumeUsdt: 13 }] }; }

describe("ClassicCryptoMarket", () => {
  afterEach(cleanup);
  beforeEach(() => {
    refetch.mockReset(); mutate.mockReset(); mocks.invalidate.mockReset(); mocks.realtime.mockReturnValue({ status: "live", quotes: {} });
    mocks.primary.mockReturnValue({ data: { updatedAt: "2026-08-25T00:00:00.000Z", markets: symbols.map(asset) }, isLoading: false, isFetching: false, error: null, refetch });
    mocks.stars.mockReturnValue({ data: { starUsdReference: 0.02, starTomanReference: 4_000, updatedAt: "2026-08-25T00:00:00.000Z", isStale: false }, isFetching: false, refetch });
    mocks.macro.mockReturnValue({ data: { markets: [{ id: "usd", category: "currency", symbol: "USD", name: "دلار آمریکا", unit: "تومان", latestToman: 200_000, priceUsd: 1, buyToman: 199_000, sellToman: 200_000, updatedAt: "2026-08-25T00:00:00.000Z", isStale: false, source: "bonbast" }, { id: "eur", category: "currency", symbol: "EUR", name: "یورو", unit: "تومان", latestToman: 230_000, priceUsd: 1.15, buyToman: null, sellToman: 230_000, updatedAt: "2026-08-25T00:00:00.000Z", isStale: false, source: "global-fx" }, { id: "gbp", category: "currency", symbol: "GBP", name: "پوند انگلیس", unit: "تومان", latestToman: 250_000, priceUsd: 1.25, buyToman: null, sellToman: 250_000, updatedAt: "2026-08-25T00:00:00.000Z", isStale: false, source: "global-fx" }, { id: "gold", category: "metal", symbol: "XAU", name: "طلای جهانی", unit: "تومان", latestToman: 400_000_000, priceUsd: 2_000, buyToman: null, sellToman: 400_000_000, updatedAt: "2026-08-25T00:00:00.000Z", isStale: false, source: "gold-api", quoteUnit: "اونس" }, { id: "silver", category: "metal", symbol: "XAG", name: "نقرهٔ جهانی", unit: "تومان", latestToman: 5_000_000, priceUsd: 25, buyToman: null, sellToman: 5_000_000, updatedAt: "2026-08-25T00:00:00.000Z", isStale: false, source: "gold-api", quoteUnit: "اونس" }, { id: "copper", category: "metal", symbol: "XCU", name: "مس جهانی", unit: "تومان", latestToman: 800_000, priceUsd: 4, buyToman: null, sellToman: 800_000, updatedAt: "2026-08-25T00:00:00.000Z", isStale: false, source: "yahoo-finance", quoteUnit: "پوند" }] }, isLoading: false, isFetching: false, refetch });
    mocks.favorites.mockReturnValue({ data: { assetIds: [] }, isFetching: false, refetch });
    mocks.favoriteMarkets.mockReturnValue({ data: { markets: [] }, isFetching: false, refetch });
    mocks.search.mockReturnValue({ data: { markets: [{ id: "avax-rls", symbol: "AVAX", market: "AVAX/IRT", latestToman: 1_000_000, bestBuyToman: 990_000, bestSellToman: 1_010_000, dayChangePercent: 2.2 }] }, isLoading: false, isFetching: false, refetch });
    mocks.selected.mockImplementation((input: { assetId: string }) => ({ data: asset(input.assetId.toUpperCase(), 7), isFetching: false, error: null, refetch }));
    mocks.mutation.mockReturnValue({ mutate, isPending: false });
  });

  it("expands each selected core asset directly beneath its row with a real chart", async () => {
    render(<ClassicCryptoMarket locale="fa" />);
    expect(screen.getByTestId("asset-detail-panel")).toBeTruthy();
    expect(screen.getByTestId("market-chart")).toBeTruthy();
    expect(screen.queryByText("در حال همگام‌سازی نمودار…")).toBeNull();
    names.forEach(name => expect(screen.getAllByText(name).length).toBeGreaterThan(0));
    for (const name of names.slice(1)) {
      fireEvent.click(screen.getByText(name));
      await waitFor(() => expect(screen.getAllByRole("heading", { name }).length).toBeGreaterThan(0));
      expect(screen.getByTestId("asset-detail-panel")).toBeTruthy();
      expect(screen.getByTestId("market-chart")).toBeTruthy();
    }
  });

  it("opens Stars as a calculator with USD/Toman conversion and a checkout-price warning", () => {
    render(<ClassicCryptoMarket locale="fa" />);
    fireEvent.click(screen.getByText("استارز تلگرام"));
    expect(screen.getByTestId("stars-calculator")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain("قیمت نهایی خرید در پرداخت Telegram یا فروشنده می‌تواند متفاوت باشد.");
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "USD" }));
    expect(screen.getByText("$0.06")).toBeTruthy();
  });

  it("pins GRAM as an independent market between TON and USDT", () => {
    render(<ClassicCryptoMarket locale="fa" />);
    const ton = screen.getByTestId("pinned-ton");
    const gram = screen.getByTestId("pinned-gram");
    const usdt = screen.getByTestId("pinned-usdt");
    expect(ton.compareDocumentPosition(gram) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gram.compareDocumentPosition(usdt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(gram.querySelector("button")!);
    expect(screen.getByTestId("pinned-gram").textContent).toContain("GRAM (گرام)");
    expect(screen.getByTestId("asset-calculator-gram")).toBeTruthy();
  });

  it("derives the pinned TON dollar price from the live USDT quote", () => {
    mocks.realtime.mockReturnValue({ status: "live", quotes: { USDT: { latestToman: 200_000, bestBuyToman: 199_900, bestSellToman: 200_100, dayChangePercent: 0 }, TON: { latestToman: 400_000, bestBuyToman: 399_900, bestSellToman: 400_100, dayChangePercent: 1 } } });
    render(<ClassicCryptoMarket locale="fa" />);
    expect(screen.getByTestId("pinned-ton").textContent).toContain("$2");
    expect(screen.getByTestId("pinned-usdt").textContent).toContain("$1");
    const pinnedTonText = screen.getByTestId("pinned-ton").textContent ?? "";
    expect(pinnedTonText.indexOf("$2")).toBeLessThan(pinnedTonText.indexOf("400,000 تومان"));
  });

  it("searches the global currency board by Persian name and shows its toman quote", async () => {
    render(<ClassicCryptoMarket locale="fa" />);
    const input = screen.getByRole("textbox", { name: "جست‌وجوی ارزهای جهانی و فلزات" });
    await userEvent.setup().type(input, "یورو");
    expect(screen.getByText("EUR (یورو)")).toBeTruthy();
    expect(screen.getByText("230,000 تومان")).toBeTruthy();
    expect(screen.queryByText("دلار آمریکا")).toBeNull();
  });

  it("searches active market results and sends a per-user favorite mutation", async () => {
    render(<ClassicCryptoMarket locale="fa" />);
    const user = userEvent.setup();
    const input = screen.getByPlaceholderText("جست‌وجوی نام یا نماد ارز");
    await user.type(input, "avax");
    await waitFor(() => expect(screen.getByText("AVAX (آوالانچ)")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "افزودن به علاقه‌مندی‌ها" }));
    expect(mutate).toHaveBeenCalledWith({ assetId: "avax", enabled: true });
  });

  it("pins USD, EUR and GBP before metals and opens a metal detail card", () => {
    render(<ClassicCryptoMarket locale="fa" />);
    const board = screen.getByTestId("macro-market-board");
    const text = board.textContent ?? "";
    expect(text.indexOf("USD (دلار آمریکا)")).toBeLessThan(text.indexOf("EUR (یورو)"));
    expect(text.indexOf("EUR (یورو)")).toBeLessThan(text.indexOf("GBP (پوند انگلیس)"));
    fireEvent.click(screen.getByText("XCU (مس جهانی)"));
    expect(screen.getByTestId("macro-detail-panel").textContent).toContain("نرخ مرجع جهانی");
  });

  it("shows only the local Iranian per-gram price for gold", () => {
    mocks.macro.mockReturnValue({ data: { markets: [{ id: "gold", category: "metal", symbol: "GOLD", name: "طلای ۱۸ عیار", unit: "تومان", latestToman: 21_593_102, priceUsd: 107.96551, buyToman: null, sellToman: 21_593_102, updatedAt: "2026-08-25T00:00:00.000Z", isStale: false, source: "tala-ir", quoteUnit: "هر گرم", tomanPerGram: 21_593_102, iranGramOnly: true, gradeQuotes: [{ label: "طلای ۲۴ عیار", latestToman: 28_791_000 }, { label: "طلای ۱۸ عیار", latestToman: 21_593_102 }, { label: "طلای ۱۴ عیار", latestToman: 16_758_000 }] }] }, isLoading: false, isFetching: false, error: null, refetch });
    render(<ClassicCryptoMarket locale="fa" />);
    expect(screen.getByTestId("macro-market-board").textContent).toContain("نرخ هر گرم بازار ایران");
    fireEvent.click(screen.getByText("GOLD (طلای ۱۸ عیار)"));
    const detail = screen.getByTestId("macro-detail-panel").textContent ?? "";
    expect(detail).toContain("قیمت هر گرم بازار ایران");
    expect(detail).toContain("انواع و عیارها");
    expect(detail).toContain("طلای ۲۴ عیار");
    expect(detail).not.toContain("اونس");
  });

  it("formats PEPE and BABYDOGE-sized values without a zeroed display", () => {
    expect(formatMarketUsd(0.00000000123)).toBe("$0.00000000123");
    expect(formatMarketNumber(0.000246)).toBe("0.000246");
  });

  it("finds an active non-core market by its Persian alias and opens its chart-backed detail", async () => {
    mocks.selected.mockReturnValue({ data: asset("AVAX", 40), isFetching: false, error: null, refetch });
    render(<ClassicCryptoMarket locale="fa" />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("جست‌وجوی نام یا نماد ارز"), "آوالانچ");
    await waitFor(() => expect(screen.getByText("AVAX (آوالانچ)")).toBeTruthy());
    fireEvent.click(screen.getByText("AVAX (آوالانچ)"));
    await waitFor(() => expect(mocks.selected.mock.calls.some(([input]) => input.assetId === "avax")).toBe(true));
    expect(screen.getByRole("heading", { name: "AVAX (آوالانچ)" })).toBeTruthy();
    expect(screen.getByTestId("market-chart")).toBeTruthy();
  });

  it("places persisted favorites ahead of core assets and search results", async () => {
    mocks.favorites.mockReturnValue({ data: { assetIds: ["btc", "avax"] }, isFetching: false, refetch });
    mocks.favoriteMarkets.mockReturnValue({ data: { markets: [asset("BTC", 10)] }, isFetching: false, refetch });
    mocks.search.mockReturnValue({ data: { markets: [
      { id: "atom-rls", symbol: "ATOM", market: "ATOM/IRT", latestToman: 1_000_000, bestBuyToman: 990_000, bestSellToman: 1_010_000, dayChangePercent: 1.2 },
      { id: "avax-rls", symbol: "AVAX", market: "AVAX/IRT", latestToman: 2_000_000, bestBuyToman: 1_990_000, bestSellToman: 2_010_000, dayChangePercent: 2.2 },
    ] }, isLoading: false, isFetching: false, refetch });
    render(<ClassicCryptoMarket locale="fa" />);
    const btcTicker = screen.getByText("BTC/IRT");
    const usdtTicker = screen.getAllByText("USDT/IRT")[0];
    expect(usdtTicker.compareDocumentPosition(btcTicker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("جست‌وجوی نام یا نماد ارز"), "a");
    await waitFor(() => expect(screen.getByText("AVAX (آوالانچ)")).toBeTruthy());
    const avaxTicker = screen.getByText("AVAX/IRT");
    const atomTicker = screen.getByText("ATOM/IRT");
    expect(avaxTicker.compareDocumentPosition(atomTicker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("derives a favorite card dollar price from the live USDT quote", () => {
    mocks.primary.mockReturnValue({ data: { updatedAt: "2026-08-25T00:00:00.000Z", markets: [asset("USDT", 0), asset("TON", 1)] }, isLoading: false, isFetching: false, error: null, refetch });
    mocks.favorites.mockReturnValue({ data: { assetIds: ["btc"] }, isFetching: false, refetch });
    mocks.favoriteMarkets.mockReturnValue({ data: { markets: [asset("BTC", 10)] }, isFetching: false, refetch });
    mocks.realtime.mockReturnValue({ status: "live", quotes: { USDT: { latestToman: 200_000, bestBuyToman: 199_900, bestSellToman: 200_100, dayChangePercent: 0 }, BTC: { latestToman: 600_000, bestBuyToman: 599_900, bestSellToman: 600_100, dayChangePercent: 1 } } });
    render(<ClassicCryptoMarket locale="fa" />);
    expect(screen.getByText("BTC/IRT").closest("button")?.textContent).toContain("$3");
  });

  it("deduplicates assets, expands a non-pinned card, and paginates the main list in both directions by eight", async () => {
    const many = ["USDT", "BTC", "ETH", "TRX", "TON", "GRAM", "SOL", "DOGE", "XRP", "ADA", "AVAX", "DOT", "LINK", "LTC", "BNB"];
    mocks.primary.mockReturnValue({ data: { updatedAt: "2026-08-25T00:00:00.000Z", markets: [...many.map(asset), asset("BTC", 99)] }, isLoading: false, isFetching: false, error: null, refetch });
    mocks.selected.mockReturnValue({ data: asset("DOT", 50), isFetching: false, error: null, refetch });
    render(<ClassicCryptoMarket locale="fa" />);
    expect(screen.getAllByTestId("market-card-btc")).toHaveLength(1);
    expect(screen.getAllByTestId(/market-card-/)).toHaveLength(8);
    expect(screen.queryByTestId("market-card-dot")).toBeNull();
    expect(screen.queryByRole("button", { name: "نمایش ۸ ارز کمتر" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "مشاهدهٔ ۸ ارز بیشتر" }));
    expect(screen.getByTestId("market-card-dot")).toBeTruthy();
    expect(screen.getByTestId("market-card-dot").closest(".market-card-enter")).toBeTruthy();
    expect(screen.getByRole("button", { name: "نمایش ۸ ارز کمتر" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("market-card-dot"));
    expect(screen.getByRole("heading", { name: "DOT (پولکادات)" })).toBeTruthy();
    expect(screen.getByTestId("market-card-bnb")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "نمایش ۸ ارز کمتر" }));
    expect(screen.getByTestId("market-card-dot").closest(".market-card-leave")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByTestId("market-card-dot")).toBeNull();
      expect(screen.queryByRole("button", { name: "نمایش ۸ ارز کمتر" })).toBeNull();
    }, { timeout: 1000 });
  });

  it("places familiar community assets ahead of lower-priority assets in the initial market list", () => {
    const popularFirst = ["USDT", "BTC", "ETH", "TRX", "TON", "GRAM", "SOL", "DOGE", "SHIB", "PEPE", "BABYDOGE", "XRP", "ADA", "BNB", "AVAX", "LTC", "ROSE", "ONE"];
    mocks.primary.mockReturnValue({ data: { updatedAt: "2026-08-25T00:00:00.000Z", markets: popularFirst.map(asset) }, isLoading: false, isFetching: false, error: null, refetch });
    render(<ClassicCryptoMarket locale="fa" />);
    const doge = screen.getByTestId("market-card-doge");
    const shib = screen.getByTestId("market-card-shib");
    const pepe = screen.getByTestId("market-card-pepe");
    const babyDoge = screen.getByTestId("market-card-babydoge");
    expect(doge.compareDocumentPosition(shib) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shib.compareDocumentPosition(pepe) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pepe.compareDocumentPosition(babyDoge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId("market-card-rose")).toBeNull();
  });

  it("leaves the loading state and exposes a retry action when the primary market request fails", () => {
    mocks.primary.mockReturnValue({ data: undefined, isLoading: false, isFetching: false, error: new Error("provider unavailable"), refetch });
    render(<ClassicCryptoMarket locale="fa" />);
    expect(screen.getByRole("alert").textContent).toContain("دادهٔ بازار");
    const retry = screen.getByRole("alert").querySelector("button");
    expect(retry).toBeTruthy();
    fireEvent.click(retry!);
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps the search, Stars card, and selected detail available in a mobile viewport", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 });
    render(<ClassicCryptoMarket locale="fa" />);
    expect(screen.getByPlaceholderText("جست‌وجوی نام یا نماد ارز")).toBeTruthy();
    expect(screen.getByText("استارز تلگرام")).toBeTruthy();
    expect(screen.getByTestId("asset-detail-panel")).toBeTruthy();
  });

  it("renders the market controls and Stars warning in English when the locale changes", () => {
    render(<ClassicCryptoMarket locale="en" />);
    expect(screen.getByText("Public crypto market")).toBeTruthy();
    expect(screen.getByPlaceholderText("e.g. Stars, Bitcoin, DOGE")).toBeTruthy();
    fireEvent.click(screen.getByText("Telegram Stars"));
    expect(screen.getByText("Telegram Stars calculator")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain("final Telegram or seller checkout pricing may differ");
  });
});
