import type { Context } from "telegraf";
import { eq } from "drizzle-orm";
import { groupSettings } from "../../drizzle/schema";
import { getDb } from "../db";
import { getNobitexAssetMarket, getNobitexTopMarkets, resolveNobitexActiveMarket, type NobitexAssetMarket } from "../market/nobitexMarket";
import { getIranMacroMarkets, type MacroMarketAsset, type MacroMarketGradeQuote } from "../market/iranMacroMarket";
import { resolvePublicMemeAssetId } from "../market/publicMemeMarkets";
import { getStarsReferenceMarketData } from "../marketplace/starsReferenceRate";
import { hasKronosModerationAccess, resolveAccessLevel } from "./authorization";
import { findGroupByChatId, writeAuditLog } from "./repository";
import { deleteTemporaryCommandSuccess, telegramMessageId } from "./temporarySuccess";

const MARKET_COMMAND_RE = /^(?:قیمت|price)\s+(.+?)\s*$/i;
const MARKET_TOGGLE_RE = /^صرافی\s+(روشن|خاموش)\s*$/;

const PERSIAN_MARKET_NAMES: Record<string, string> = {
  stars: "استارز تلگرام", usdt: "تتر", btc: "بیت‌کوین", eth: "اتریوم", trx: "ترون", ton: "تون‌کوین", gram: "گرام", sol: "سولانا", doge: "دوج‌کوین", shib: "شیبا اینو", pepe: "پپه", babydoge: "بیبی دوج", xrp: "ریپل", ada: "کاردانو", avax: "آوالانچ", dot: "پولکادات", link: "چین‌لینک", ltc: "لایت‌کوین", bnb: "بایننس کوین", xlm: "استلار", uni: "یونی‌سواپ", near: "نیر", apt: "آپتوس", arb: "آربیتروم", op: "آپتیمیسم", fil: "فایل‌کوین", aave: "آوه", atom: "کازماس", not: "نات‌کوین", sand: "سندباکس", mana: "مانا", gala: "گالا", xmr: "مونرو", algo: "الگوراند", icp: "اینترنت کامپیوتر", eos: "ایاس", qnt: "کوانت", pol: "پالیگان", ftm: "فانتوم", inj: "اینجکتیو", sui: "سوئی", sei: "سئی", etc: "اتریوم کلاسیک", bch: "بیت‌کوین کش", dash: "دش", zec: "زیکش", comp: "کامپاند", crv: "کرو", mkr: "میکر", snx: "سینتتیکس", grt: "گراف", theta: "تتا", vet: "وی‌چین", one: "هارمونی", enj: "انجین", chz: "چیلیز", bat: "بت", ape: "ایپ‌کوین", lrc: "لوپرینگ", rose: "اوسیس نتورک", flow: "فلو",
};

const RELATED_MARKETS: Record<string, string[]> = {
  stars: ["ton", "usdt", "btc"], btc: ["eth", "usdt", "ton"], eth: ["btc", "usdt", "ton"], usdt: ["btc", "eth", "ton"], ton: ["gram", "usdt", "btc"], gram: ["ton", "usdt", "btc"],
  shib: ["doge", "pepe", "babydoge"], doge: ["shib", "pepe", "babydoge"], pepe: ["shib", "doge", "babydoge"],
};

export type MarketCommand = { kind: "price"; query: string } | { kind: "toggle"; enabled: boolean };

type PriceReplyAsset = Pick<NobitexAssetMarket, "assetId" | "symbol" | "market" | "latestToman" | "priceUsd" | "markToman" | "bestBuyToman" | "bestSellToman" | "dayLowToman" | "dayHighToman" | "dayOpenToman" | "dayChangePercent" | "volumeAsset" | "volumeToman" | "updatedAt" | "isStale" | "chartIsStale"> & { referenceOnly?: boolean; globalReferenceOnly?: boolean; macroReferenceOnly?: boolean; displayName?: string; quoteUnit?: string; priceUsdPerGram?: number | null; tomanPerGram?: number | null; iranGramOnly?: boolean; gradeQuotes?: MacroMarketGradeQuote[] };

function normalizeMarketQuery(query: string) {
  return query.trim().toLowerCase().replace(/[‌\s\-_/]/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک");
}

function isStarsQuery(query: string) {
  return ["stars", "telegramstars", "استارز", "استارزتلگرام"].includes(normalizeMarketQuery(query));
}

const MACRO_ALIASES: Record<string, string> = {
  دلار: "USD", دلارآمریکا: "USD", dollar: "USD", usd: "USD",
  یورو: "EUR", euro: "EUR", eur: "EUR",
  پوند: "GBP", پوندانگلیس: "GBP", pound: "GBP", gbp: "GBP",
  یوان: "CNY", یوآن: "CNY", چین: "CNY", yuan: "CNY", cny: "CNY",
  درهم: "AED", امارات: "AED", dirham: "AED", aed: "AED",
  لیر: "TRY", ترکیه: "TRY", lira: "TRY", try: "TRY",
  ین: "JPY", ژاپن: "JPY", yen: "JPY", jpy: "JPY",
  روبل: "RUB", روسیه: "RUB", ruble: "RUB", rub: "RUB",
  روپیه: "INR", هند: "INR", rupee: "INR", inr: "INR",
  فرانک: "CHF", سوئیس: "CHF", franc: "CHF", chf: "CHF",
  دلارکانادا: "CAD", کانادا: "CAD", cad: "CAD",
  دلاراسترالیا: "AUD", استرالیا: "AUD", aud: "AUD",
  ریالسعودی: "SAR", عربستان: "SAR", sar: "SAR",
  دینارکویت: "KWD", کویت: "KWD", kwd: "KWD",
  ریالعمان: "OMR", عمان: "OMR", omr: "OMR",
  ریالقطر: "QAR", قطر: "QAR", qar: "QAR",
  دیناربحرین: "BHD", بحرین: "BHD", bhd: "BHD",
  دیناراردن: "JOD", اردن: "JOD", jod: "JOD",
  ریالیمن: "YER", یمن: "YER", yer: "YER",
  طلا: "GOLD", طلای۱۸عیار: "GOLD", طلای18عیار: "GOLD", gold: "GOLD", gold18: "GOLD", gold18k: "GOLD",
  نقره: "SILVER", نقره۹۹۹: "SILVER", silver: "SILVER",
  طلایجهانی: "XAU", xau: "XAU", xag: "XAG",
  مس: "XCU", copper: "XCU", xcu: "XCU",
  پلاتین: "XPT", platinum: "XPT", xpt: "XPT",
  پالادیوم: "XPD", palladium: "XPD", xpd: "XPD",
};

function macroSymbol(query: string) {
  const normalized = normalizeMarketQuery(query);
  if (MACRO_ALIASES[normalized]) return MACRO_ALIASES[normalized];
  return /^[a-z0-9]{3,6}$/i.test(query.trim()) ? query.trim().toUpperCase() : null;
}

function isExplicitMacroAlias(query: string) {
  return Boolean(MACRO_ALIASES[normalizeMarketQuery(query)]);
}

async function getMacroPriceReplyAsset(query: string): Promise<PriceReplyAsset | null> {
  const symbol = macroSymbol(query);
  if (!symbol) return null;
  const macro = await getIranMacroMarkets();
  const market = macro.markets.find(item => item.symbol === symbol);
  if (!market) return null;
  return toMacroPriceReplyAsset(market);
}

function toMacroPriceReplyAsset(market: MacroMarketAsset): PriceReplyAsset {
  return {
    assetId: `fx-${market.id}`, symbol: market.symbol, market: `GLOBAL/${market.symbol}`,
    latestToman: market.latestToman, priceUsd: market.priceUsd ?? 0, markToman: market.latestToman,
    bestBuyToman: market.buyToman ?? market.latestToman, bestSellToman: market.sellToman ?? market.latestToman,
    dayLowToman: market.latestToman, dayHighToman: market.latestToman, dayOpenToman: market.latestToman,
    dayChangePercent: 0, volumeAsset: null, volumeToman: null, updatedAt: market.updatedAt,
    isStale: market.isStale, chartIsStale: false, globalReferenceOnly: market.source === "global-fx" || (market.category === "metal" && !market.iranGramOnly), macroReferenceOnly: true, displayName: market.name, quoteUnit: market.quoteUnit, priceUsdPerGram: market.priceUsdPerGram, tomanPerGram: market.tomanPerGram, iranGramOnly: market.iranGramOnly, gradeQuotes: market.gradeQuotes,
  };
}

async function getStarsPriceReplyAsset(now = Date.now()): Promise<PriceReplyAsset> {
  const rate = await getStarsReferenceMarketData(now);
  return {
    assetId: "stars", symbol: "STARS", market: "STARS/USDT · REFERENCE",
    latestToman: rate.starTomanReference, priceUsd: rate.starUsdReference, markToman: rate.starTomanReference,
    bestBuyToman: rate.starTomanReference, bestSellToman: rate.starTomanReference,
    dayLowToman: rate.starTomanReference, dayHighToman: rate.starTomanReference, dayOpenToman: rate.starTomanReference,
    dayChangePercent: 0, volumeAsset: null, volumeToman: null, updatedAt: rate.updatedAt,
    isStale: rate.isStale, chartIsStale: false, referenceOnly: true,
  };
}

export function parseMarketCommand(text: string): MarketCommand | null {
  const trimmed = text.trim();
  const toggle = trimmed.match(MARKET_TOGGLE_RE);
  if (toggle) return { kind: "toggle", enabled: toggle[1] === "روشن" };
  const price = trimmed.match(MARKET_COMMAND_RE);
  return price?.[1] ? { kind: "price", query: price[1].trim() } : null;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function toman(value: number) {
  const formatted = Math.abs(value) >= 1
    ? Math.round(value).toLocaleString("fa-IR")
    : value.toLocaleString("fa-IR", { maximumSignificantDigits: 8 });
  return `${formatted} تومان`;
}

function usd(value: number) {
  return `$${value.toLocaleString("en-US", value >= 1 ? { maximumFractionDigits: value >= 100 ? 2 : 4 } : { maximumSignificantDigits: 8 })}`;
}

function marketName(asset: PriceReplyAsset) {
  return asset.displayName ?? PERSIAN_MARKET_NAMES[asset.assetId.toLowerCase()] ?? asset.symbol;
}

function relatedMarketIds(assetId: string) {
  const fallback = ["btc", "eth", "usdt"];
  return (RELATED_MARKETS[assetId.toLowerCase()] ?? fallback).filter(id => id !== assetId.toLowerCase()).slice(0, 3);
}

export function marketInlineKeyboard(asset: PriceReplyAsset, activeAssetIds?: ReadonlySet<string>) {
  const related = asset.globalReferenceOnly || asset.iranGramOnly ? [] : relatedMarketIds(asset.assetId).filter(assetId => !activeAssetIds || activeAssetIds.has(assetId));
  if (!related.length) return undefined;
  return {
    inline_keyboard: [related.map(assetId => ({
      text: `${assetId.toUpperCase()} (${PERSIAN_MARKET_NAMES[assetId] ?? assetId.toUpperCase()})`,
      callback_data: `market-price:${assetId}`,
      // Bot API 9.4+: native blue button styling. The field is passed through Telegraf's raw payload.
      style: "primary" as const,
    }))],
  };
}

export function formatMarketReply(asset: PriceReplyAsset) {
  const direction = asset.dayChangePercent > 0 ? "🟢" : asset.dayChangePercent < 0 ? "🔴" : "⚪️";
  const sign = asset.dayChangePercent > 0 ? "+" : "";
  const freshness = asset.isStale || asset.chartIsStale ? "آخرین دادهٔ معتبر" : asset.referenceOnly ? "نرخ مرجع زندهٔ Stars" : "نرخ زندهٔ بازار";
  const updatedAt = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Tehran" }).format(new Date(asset.updatedAt));
  const spreadToman = Math.max(0, asset.bestSellToman - asset.bestBuyToman);
  if (asset.iranGramOnly) return [
    `<b>✦ ${escapeHtml(marketName(asset))}</b>`,
    `<i>${asset.isStale ? "آخرین دادهٔ معتبر بازار ایران" : "نرخ بازار ایران"} · آخرین بررسی: ${updatedAt}</i>`,
    "",
    `💰 <b>قیمت هر گرم</b>  ${toman(asset.latestToman)}`,
    ...(asset.gradeQuotes?.length ? ["", `<b>انواع و عیارها</b>`, ...asset.gradeQuotes.map(quote => `• ${escapeHtml(quote.label)}: ${toman(quote.latestToman)}`)] : []),
  ].join("\n");
  if (asset.macroReferenceOnly) return [
    `<b>✦ ${escapeHtml(asset.symbol)} · ${escapeHtml(marketName(asset))}</b>`,
    `<i>${asset.isStale ? "آخرین دادهٔ معتبر" : asset.globalReferenceOnly ? "نرخ مرجع جهانی" : "نرخ بازار ایران"} · آخرین بررسی: ${updatedAt}</i>`,
    "",
    `💵 <b>قیمت دلاری${asset.quoteUnit ? ` (${escapeHtml(asset.quoteUnit)})` : ""}</b>  ${usd(asset.priceUsd)}`,
    `🇮🇷 <b>معادل تومانی${asset.quoteUnit ? ` (${escapeHtml(asset.quoteUnit)})` : ""}</b>  ${toman(asset.latestToman)}`,
    ...(asset.priceUsdPerGram !== null && asset.priceUsdPerGram !== undefined && asset.tomanPerGram !== null && asset.tomanPerGram !== undefined ? [`⚖️ <b>هر گرم</b>  ${usd(asset.priceUsdPerGram)} · ${toman(asset.tomanPerGram)}`] : []),
    "",
    `<blockquote>${asset.globalReferenceOnly ? `${asset.priceUsdPerGram !== null && asset.priceUsdPerGram !== undefined ? "نرخ هر گرم از تقسیم اونس تروا بر ۳۱٫۱۰۳۴۷۶۸ محاسبه شده است. " : ""}این نرخ از مرجع جهانی و دلار ایران محاسبه شده است؛ نرخ خریدوفروش داخلی می‌تواند متفاوت باشد.` : "این نرخ بازار ایران است؛ نرخ خریدوفروش نهایی می‌تواند با توجه به محل معامله متفاوت باشد."}</blockquote>`,
  ].join("\n");
  if (asset.globalReferenceOnly) return [
    `<b>✦ ${escapeHtml(asset.symbol)} · ${escapeHtml(marketName(asset))}</b>`,
    `<i>${asset.isStale ? "آخرین دادهٔ معتبر" : "نرخ مرجع جهانی"} · آخرین بررسی: ${updatedAt}</i>`,
    "",
    `💵 <b>قیمت مرجع دلاری</b>  ${usd(asset.priceUsd)}`,
    `🇮🇷 <b>معادل تومانی</b>  ${toman(asset.latestToman)}`,
    "",
    `<blockquote>این نرخ از مرجع جهانی و نرخ دلار بازار ایران محاسبه شده است؛ نرخ خریدوفروش صرافی ممکن است متفاوت باشد.</blockquote>`,
  ].join("\n");
  if (asset.referenceOnly) return [
    `<b>✦ بازار ${escapeHtml(asset.symbol)} (${escapeHtml(marketName(asset))})</b>`,
    `<i>${freshness} • ${updatedAt}</i>`,
    "",
    `💵 <b>قیمت مرجع جهانی</b>  ${usd(asset.priceUsd)}`,
    `🇮🇷 <b>معادل مرجع تومان</b>  ${toman(asset.latestToman)}`,
    "",
    `<blockquote>هشدار: این نرخ مرجع Stars است و ممکن است با مبلغ نهایی خرید در تلگرام متفاوت باشد.</blockquote>`,
  ].join("\n");
  return [
    `<b>✦ ${escapeHtml(asset.symbol)} · ${escapeHtml(marketName(asset))}</b>`,
    `<i>${freshness} · آخرین بررسی: ${updatedAt}</i>`,
    "",
    `💵 <b>قیمت دلاری</b>  ${usd(asset.priceUsd)}`,
    `🇮🇷 <b>معادل تومانی</b>  ${toman(asset.latestToman)}`,
    `${direction} <b>تغییر ۲۴ساعته</b>  ${sign}${asset.dayChangePercent.toFixed(2)}٪`,
    `↕️ <b>کف/سقف امروز</b>  ${toman(asset.dayLowToman)} · ${toman(asset.dayHighToman)}`,
    `📊 <b>حجم ۲۴ساعته</b>  ${asset.volumeAsset === null ? "—" : `${asset.volumeAsset.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${escapeHtml(asset.symbol)}`}${asset.volumeToman === null ? "" : ` · ${toman(asset.volumeToman)}`}`,
    "",
    `<blockquote>خرید ${toman(asset.bestBuyToman)}  ·  فروش ${toman(asset.bestSellToman)}  ·  فاصله ${toman(spreadToman)}</blockquote>`,
  ].join("\n");
}

async function marketCommandsEnabled(groupId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const settings = (await db.select({ enabled: groupSettings.marketCommandsEnabled }).from(groupSettings).where(eq(groupSettings.groupId, groupId)).limit(1))[0];
  return settings?.enabled !== false && settings?.enabled !== 0;
}

async function setMarketCommandsEnabled(groupId: number, enabled: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(groupSettings).values({ groupId, marketCommandsEnabled: enabled }).onDuplicateKeyUpdate({ set: { marketCommandsEnabled: enabled } });
}

/** Handles public price lookup and administrator-only per-group feature control. */
export async function handleMarketCommand(ctx: Context): Promise<boolean> {
  if (!ctx.chat || !ctx.from || !ctx.message || !("text" in ctx.message)) return false;
  if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return false;
  const command = parseMarketCommand(ctx.message.text);
  if (!command) return false;
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) return false;
  const replyParameters = { reply_parameters: { message_id: ctx.message.message_id } };

  if (command.kind === "toggle") {
    const access = await resolveAccessLevel({ groupId: group.id, groupChatId: group.chatId, telegramUserId: ctx.from.id }, ctx.telegram);
    if (!hasKronosModerationAccess(access)) {
      await ctx.reply("⛔ فقط مالک یا مدیران مجاز گروه می‌توانند صرافی را روشن یا خاموش کنند.", replyParameters);
      return true;
    }
    await setMarketCommandsEnabled(group.id, command.enabled);
    await writeAuditLog({ category: "market_command", event: command.enabled ? "enabled" : "disabled", groupId: group.id, actorTelegramId: ctx.from.id });
    const response = await ctx.reply(command.enabled ? "✅ <b>بازار صرافی گروه فعال شد</b>\n\nاعضا می‌توانند برای دریافت نرخ زنده بنویسند:\n<code>قیمت BTC</code> یا <code>قیمت شیبا</code>\n\nجزئیات شامل قیمت دلار، معادل تومان، تغییر ۲۴ساعته، حجم و خرید/فروش است." : "✅ <b>بازار صرافی گروه غیرفعال شد</b>\n\nتا زمان فعال‌سازی دوباره، فرمان‌های قیمت در این گروه پاسخی ارسال نمی‌کنند.", { parse_mode: "HTML", ...replyParameters });
    await deleteTemporaryCommandSuccess({ telegram: ctx.telegram, chatId: ctx.chat.id, messageId: telegramMessageId(response) });
    return true;
  }

  const getActiveAssetIds = async () => new Set([
    ...(await getNobitexTopMarkets(1_000)).markets.map(market => market.id.replace(/-rls$/i, "").toLowerCase()),
    "shib", "pepe", "babydoge",
  ]);

  if (!(await marketCommandsEnabled(group.id))) {
    await ctx.reply("ℹ️ بازار صرافی این گروه موقتاً غیرفعال است. مدیر یا مالک گروه می‌تواند با «صرافی روشن» آن را فعال کند.", replyParameters);
    return true;
  }
  try {
    if (isStarsQuery(command.query)) {
      const asset = await getStarsPriceReplyAsset();
      const activeAssetIds = new Set((await getNobitexTopMarkets(1_000)).markets.map(market => market.id.replace(/-rls$/i, "").toLowerCase()));
      await ctx.reply(formatMarketReply(asset), { parse_mode: "HTML", reply_markup: marketInlineKeyboard(asset, activeAssetIds), ...replyParameters });
      return true;
    }
    if (isExplicitMacroAlias(command.query)) {
      const macroAsset = await getMacroPriceReplyAsset(command.query);
      if (macroAsset) {
        await ctx.reply(formatMarketReply(macroAsset), { parse_mode: "HTML", reply_markup: marketInlineKeyboard(macroAsset), ...replyParameters });
        return true;
      }
    }
    const publicAssetId = resolvePublicMemeAssetId(command.query);
    const match = publicAssetId ? { id: `${publicAssetId}-rls` } : await resolveNobitexActiveMarket(command.query);
    if (!match) {
      const macroAsset = await getMacroPriceReplyAsset(command.query);
      if (macroAsset) {
        await ctx.reply(formatMarketReply(macroAsset), { parse_mode: "HTML", reply_markup: marketInlineKeyboard(macroAsset), ...replyParameters });
        return true;
      }
      await ctx.reply("دارایی در بازار فعال پیدا نشد. نمونه: <code>قیمت بیت‌کوین</code>، <code>قیمت شیبا</code>، <code>قیمت دلار</code> یا <code>قیمت طلا</code>", { parse_mode: "HTML", ...replyParameters });
      return true;
    }
    const assetId = match.id.replace(/-rls$/i, "").toLowerCase();
    const asset = await getNobitexAssetMarket(assetId, "1d", Date.now(), { allowMissingChart: true });
    const activeAssetIds = await getActiveAssetIds();
    await ctx.reply(formatMarketReply(asset), { parse_mode: "HTML", reply_markup: marketInlineKeyboard(asset, activeAssetIds), ...replyParameters });
  } catch (error) {
    console.warn("[Kronos Guard] market command failed", error instanceof Error ? error.message : "unknown");
      await ctx.reply("⚠️ <b>نرخ زنده فعلاً در دسترس نیست</b>\n\nمنبع بازار پاسخ معتبر نداد. لطفاً چند لحظهٔ دیگر دوباره تلاش کنید؛ هیچ قیمت تخمینی یا ساختگی نمایش داده نمی‌شود.", { parse_mode: "HTML", ...replyParameters });
  }
  return true;
}

/** Replaces a price card through a compact, whitelisted inline callback. Telegram buttons do not expose custom RGB styling, so the 💠 mark carries Kronos Guard's teal interaction identity. */
export async function handleMarketPriceCallback(ctx: Context & { match: RegExpExecArray }): Promise<void> {
  if (!ctx.chat || !ctx.from || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) return;
  const assetId = ctx.match[1]?.toLowerCase();
  if (!assetId || !/^[a-z0-9]{1,32}$/.test(assetId)) return;
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group || !(await marketCommandsEnabled(group.id))) {
    await ctx.answerCbQuery("صرافی این گروه خاموش است.", { show_alert: true });
    return;
  }
  try {
    const activeAssetIds = new Set((await getNobitexTopMarkets(1_000)).markets.map(market => market.id.replace(/-rls$/i, "").toLowerCase()));
    if (!activeAssetIds.has(assetId)) {
      await ctx.answerCbQuery("این ارز در بازار فعال موجود نیست.", { show_alert: true });
      return;
    }
    const asset = await getNobitexAssetMarket(assetId, "1d", Date.now(), { allowMissingChart: true });
    await ctx.answerCbQuery(`نمایش ${asset.symbol}`);
    await ctx.editMessageText(formatMarketReply(asset), { parse_mode: "HTML", reply_markup: marketInlineKeyboard(asset, activeAssetIds) });
  } catch (error) {
    console.warn("[Kronos Guard] related market callback failed", error instanceof Error ? error.message : "unknown");
    await ctx.answerCbQuery("دریافت نرخ زنده موقتاً ممکن نیست.", { show_alert: true });
  }
}
