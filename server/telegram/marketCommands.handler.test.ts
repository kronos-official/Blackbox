import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), findGroupByChatId: vi.fn(), writeAuditLog: vi.fn(), resolveAccessLevel: vi.fn(), hasKronosModerationAccess: vi.fn(), resolve: vi.fn(), publicMeme: vi.fn(), top: vi.fn(), asset: vi.fn(), stars: vi.fn(), macro: vi.fn() }));

vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../../drizzle/schema", () => ({ groupSettings: { groupId: "groupId", marketCommandsEnabled: "marketCommandsEnabled" } }));
vi.mock("../market/nobitexMarket", () => ({ resolveNobitexActiveMarket: mocks.resolve, getNobitexTopMarkets: mocks.top, getNobitexAssetMarket: mocks.asset }));
vi.mock("../market/iranMacroMarket", () => ({ getIranMacroMarkets: mocks.macro }));
vi.mock("../market/publicMemeMarkets", () => ({ resolvePublicMemeAssetId: mocks.publicMeme }));
vi.mock("../marketplace/starsReferenceRate", () => ({ getStarsReferenceMarketData: mocks.stars }));
vi.mock("./authorization", () => ({ resolveAccessLevel: mocks.resolveAccessLevel, hasKronosModerationAccess: mocks.hasKronosModerationAccess }));
vi.mock("./repository", () => ({ findGroupByChatId: mocks.findGroupByChatId, writeAuditLog: mocks.writeAuditLog }));

import { handleMarketCommand, handleMarketPriceCallback } from "./marketCommands";

const reply = vi.fn();
const ctx = (text: string) => ({ chat: { id: -1001, type: "supergroup" }, from: { id: 47 }, message: { message_id: 91, text }, telegram: { getChatMember: vi.fn() }, reply });
const liveAsset = { assetId: "btc", symbol: "BTC", market: "BTC/IRT", latestToman: 12_345_678, priceUsd: 61_234.5, markToman: 12_300_000, bestBuyToman: 12_300_000, bestSellToman: 12_400_000, dayLowToman: 12_000_000, dayHighToman: 12_600_000, dayOpenToman: 12_100_000, dayChangePercent: 2.12, volumeAsset: 10, volumeToman: 1_000_000, updatedAt: "2026-08-26T00:00:00.000Z", chart: [], isStale: false, chartIsStale: false };

describe("market command handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findGroupByChatId.mockResolvedValue({ id: 7, chatId: -1001 });
    mocks.getDb.mockResolvedValue({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ enabled: true }] }) }) }), insert: () => ({ values: () => ({ onDuplicateKeyUpdate: async () => undefined }) }) });
    mocks.resolve.mockResolvedValue({ id: "btc-rls" });
    mocks.publicMeme.mockReturnValue(null);
    mocks.top.mockResolvedValue({ markets: [{ id: "btc-rls" }, { id: "eth-rls" }, { id: "usdt-rls" }, { id: "ton-rls" }] });
    mocks.asset.mockResolvedValue(liveAsset);
    mocks.stars.mockResolvedValue({ starUsdReference: 0.015, starTomanReference: 3_000, updatedAt: "2026-08-26T00:00:00.000Z", isStale: false });
    mocks.macro.mockResolvedValue({ markets: [{ id: "usd", category: "currency", symbol: "USD", name: "دلار آمریکا", unit: "تومان", latestToman: 200_000, priceUsd: 1, buyToman: null, sellToman: 200_000, updatedAt: "2026-08-26T00:00:00.000Z", isStale: false, source: "bonbast" }, { id: "eur", category: "currency", symbol: "EUR", name: "یورو", unit: "تومان", latestToman: 230_000, priceUsd: 1.15, buyToman: null, sellToman: 230_000, updatedAt: "2026-08-26T00:00:00.000Z", isStale: false, source: "global-fx" }, { id: "gold", category: "metal", symbol: "GOLD", name: "طلای ۱۸ عیار", unit: "تومان", latestToman: 21_593_102, priceUsd: 107.96551, buyToman: null, sellToman: 21_593_102, updatedAt: "2026-08-26T00:00:00.000Z", isStale: false, source: "tala-ir", quoteUnit: "هر گرم", tomanPerGram: 21_593_102, iranGramOnly: true, gradeQuotes: [{ label: "طلای ۲۴ عیار", latestToman: 28_791_000 }, { label: "طلای ۱۸ عیار", latestToman: 21_593_102 }, { label: "طلای ۱۴ عیار", latestToman: 16_758_000 }] }, { id: "copper", category: "metal", symbol: "XCU", name: "مس جهانی", unit: "تومان", latestToman: 800_000, priceUsd: 4, buyToman: null, sellToman: 800_000, updatedAt: "2026-08-26T00:00:00.000Z", isStale: false, source: "yahoo-finance", quoteUnit: "پوند" }] });
    mocks.resolveAccessLevel.mockResolvedValue("group_admin");
    mocks.hasKronosModerationAccess.mockReturnValue(true);
  });

  it("allows every group user to request a live price and replies to their message", async () => {
    await expect(handleMarketCommand(ctx("قیمت بیت‌کوین") as never)).resolves.toBe(true);
    expect(mocks.resolve).toHaveBeenCalledWith("بیت‌کوین");
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("BTC · بیت‌کوین"), expect.objectContaining({ parse_mode: "HTML", reply_parameters: { message_id: 91 } }));
  });

  it("resolves Persian شیبا directly through the public meme path", async () => {
    mocks.publicMeme.mockReturnValue("shib");
    mocks.asset.mockResolvedValue({ ...liveAsset, assetId: "shib", symbol: "SHIB", priceUsd: 0.00002 });
    await expect(handleMarketCommand(ctx("قیمت شیبا") as never)).resolves.toBe(true);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.asset).toHaveBeenCalledWith("shib", "1d", expect.any(Number), { allowMissingChart: true });
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("SHIB"), expect.objectContaining({ reply_parameters: { message_id: 91 } }));
  });

  it("resolves global currency commands with a toman reference", async () => {
    mocks.resolve.mockResolvedValue(null);
    await expect(handleMarketCommand(ctx("قیمت یورو") as never)).resolves.toBe(true);
    expect(mocks.macro).toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("EUR · یورو"), expect.objectContaining({ reply_parameters: { message_id: 91 } }));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("معادل تومانی"), expect.anything());
  });

  it("prioritizes the explicit Persian alias پوند as GBP before a conflicting COMP crypto match", async () => {
    mocks.resolve.mockResolvedValue({ id: "comp-rls" });
    mocks.macro.mockResolvedValue({ markets: [{ id: "gbp", category: "currency", symbol: "GBP", name: "پوند انگلیس", unit: "تومان", latestToman: 270_000, priceUsd: 1.35, buyToman: null, sellToman: 270_000, updatedAt: "2026-08-26T00:00:00.000Z", isStale: false, source: "global-fx" }] });

    await expect(handleMarketCommand(ctx("قیمت پوند") as never)).resolves.toBe(true);

    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.asset).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("GBP · پوند انگلیس"), expect.objectContaining({ reply_markup: undefined, reply_parameters: { message_id: 91 } }));
    expect(reply).not.toHaveBeenCalledWith(expect.stringContaining("COMP · کامپاند"), expect.anything());
  });

  it("resolves gold and copper commands through the same macro market as the Mini App", async () => {
    mocks.resolve.mockResolvedValue(null);
    await expect(handleMarketCommand(ctx("قیمت طلا") as never)).resolves.toBe(true);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("طلای ۱۸ عیار"), expect.objectContaining({ reply_markup: undefined }));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("قیمت هر گرم"), expect.anything());
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("انواع و عیارها"), expect.anything());
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("طلای ۲۴ عیار"), expect.anything());
    expect(reply).not.toHaveBeenCalledWith(expect.stringContaining("اونس"), expect.anything());
    await expect(handleMarketCommand(ctx("قیمت مس") as never)).resolves.toBe(true);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("XCU · مس جهانی"), expect.anything());
  });

  it("resolves explicit Arabic currency aliases before crypto lookup", async () => {
    mocks.macro.mockResolvedValue({ markets: [{ id: "qar", category: "currency", symbol: "QAR", name: "ریال قطر", unit: "تومان", latestToman: 55_000, priceUsd: 0.275, buyToman: null, sellToman: 55_000, updatedAt: "2026-08-26T00:00:00.000Z", isStale: false, source: "global-fx" }] });
    await expect(handleMarketCommand(ctx("قیمت ریال قطر") as never)).resolves.toBe(true);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("QAR · ریال قطر"), expect.anything());
  });

  it("keeps very small dollar prices visible instead of rounding them to zero", async () => {
    mocks.asset.mockResolvedValue({ ...liveAsset, assetId: "babydoge", symbol: "BABYDOGE", priceUsd: 0.00000000123, latestToman: 0.000246 });
    await expect(handleMarketCommand(ctx("قیمت BABYDOGE") as never)).resolves.toBe(true);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("$0.00000000123"), expect.anything());
  });

  it("returns the live Mini App Stars reference instead of searching the exchange", async () => {
    await expect(handleMarketCommand(ctx("قیمت استارز") as never)).resolves.toBe(true);
    expect(mocks.stars).toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("STARS (استارز تلگرام)"), expect.objectContaining({ reply_parameters: { message_id: 91 } }));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("ممکن است با مبلغ نهایی خرید در تلگرام متفاوت باشد"), expect.anything());
  });

  it("accepts the English price STARS command through the same live reference path", async () => {
    await expect(handleMarketCommand(ctx("price STARS") as never)).resolves.toBe(true);
    expect(mocks.stars).toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("STARS (استارز تلگرام)"), expect.anything());
  });

  it("does not query the provider when administrators have disabled the feature", async () => {
    mocks.getDb.mockResolvedValue({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ enabled: false }] }) }) }) });
    await expect(handleMarketCommand(ctx("قیمت BTC") as never)).resolves.toBe(true);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("موقتاً غیرفعال"), expect.objectContaining({ reply_parameters: { message_id: 91 } }));
  });

  it("restricts صرافی روشن and صرافی خاموش to authorized administrators", async () => {
    mocks.resolveAccessLevel.mockResolvedValue("user");
    mocks.hasKronosModerationAccess.mockReturnValue(false);
    await expect(handleMarketCommand(ctx("صرافی خاموش") as never)).resolves.toBe(true);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("فقط مالک یا مدیران"), expect.anything());
  });

  it("replaces the existing price card with a related asset through a safe inline callback", async () => {
    const answerCbQuery = vi.fn();
    const editMessageText = vi.fn();
    await handleMarketPriceCallback({ ...ctx("ignored"), match: ["market-price:eth", "eth"] as unknown as RegExpExecArray, answerCbQuery, editMessageText } as never);
    expect(mocks.asset).toHaveBeenCalledWith("eth", "1d", expect.any(Number), { allowMissingChart: true });
    expect(answerCbQuery).toHaveBeenCalledWith("نمایش BTC");
    expect(editMessageText).toHaveBeenCalledWith(expect.stringContaining("BTC · بیت‌کوین"), expect.objectContaining({ parse_mode: "HTML", reply_markup: expect.any(Object) }));
  });
});
