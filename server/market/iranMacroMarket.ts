import { getGlobalFxRates } from "./globalFxMarket";
import { getNobitexTomanPerUsdReference } from "./nobitexMarket";

const BONBAST_URL = "https://bonbast.com/";
const GOLD_API_URL = "https://api.gold-api.com/price";
const COPPER_URL = "https://query1.finance.yahoo.com/v8/finance/chart/HG=F?range=1d&interval=1m";
const IRAN_GOLD_GRAM_URL = "https://www.tala.ir/price/18k";
const IRAN_SILVER_GRAM_URL = "https://tindex.app/en/indicators/precious-metals/SILVER-999/";
const IRAN_SILVER_925_URL = "https://www.tgju.org/profile/silver_925";
const REQUEST_TIMEOUT_MS = 8_000;
const LIVE_TTL_MS = 60_000;
const STALE_TTL_MS = 10 * 60_000;
const USER_AGENT = "KronosGuard/1.0 market-data";

type CacheRecord<T> = { value: T; fetchedAtMs: number };
const cache = new Map<string, CacheRecord<unknown>>();

type BonbastRate = { sellId: string; buyId: string; symbol: string; name: string; multiplier?: number };
const CURRENCY_RATES: BonbastRate[] = [
  { symbol: "USD", name: "دلار آمریکا", sellId: "usd1", buyId: "usd2" },
  { symbol: "EUR", name: "یورو", sellId: "eur1", buyId: "eur2" },
  { symbol: "GBP", name: "پوند انگلیس", sellId: "gbp1", buyId: "gbp2" },
  { symbol: "CHF", name: "فرانک سوئیس", sellId: "chf1", buyId: "chf2" },
  { symbol: "CAD", name: "دلار کانادا", sellId: "cad1", buyId: "cad2" },
  { symbol: "AUD", name: "دلار استرالیا", sellId: "aud1", buyId: "aud2" },
  { symbol: "SEK", name: "کرون سوئد", sellId: "sek1", buyId: "sek2" },
  { symbol: "NOK", name: "کرون نروژ", sellId: "nok1", buyId: "nok2" },
  { symbol: "RUB", name: "روبل روسیه", sellId: "rub1", buyId: "rub2" },
  { symbol: "AED", name: "درهم امارات", sellId: "aed1", buyId: "aed2" },
  { symbol: "TRY", name: "لیر ترکیه", sellId: "try1", buyId: "try2" },
  { symbol: "CNY", name: "یوان چین", sellId: "cny1", buyId: "cny2" },
  { symbol: "SAR", name: "ریال عربستان", sellId: "sar1", buyId: "sar2" },
  { symbol: "INR", name: "روپیه هند", sellId: "inr1", buyId: "inr2" },
  { symbol: "KWD", name: "دینار کویت", sellId: "kwd1", buyId: "kwd2" },
  { symbol: "QAR", name: "ریال قطر", sellId: "qar1", buyId: "qar2" },
  { symbol: "OMR", name: "ریال عمان", sellId: "omr1", buyId: "omr2" },
  { symbol: "JPY", name: "ین ژاپن (هر ۱۰ ین)", sellId: "jpy1", buyId: "jpy2", multiplier: 10 },
];

export type MacroMarketAsset = {
  id: string;
  category: "currency" | "metal";
  symbol: string;
  name: string;
  unit: "تومان" | "دلار";
  latestToman: number;
  priceUsd: number | null;
  buyToman: number | null;
  sellToman: number | null;
  updatedAt: string;
  isStale: boolean;
  source: "bonbast" | "gold-api" | "global-fx" | "yahoo-finance" | "nobitex" | "tala-ir" | "tindex" | "tgju";
  quoteUnit?: string;
  priceUsdPerGram?: number | null;
  tomanPerGram?: number | null;
  iranGramOnly?: boolean;
  gradeQuotes?: MacroMarketGradeQuote[];
};

export type MacroMarketGradeQuote = {
  label: string;
  latestToman: number;
};

const GLOBAL_METALS = [
  { id: "platinum", symbol: "XPT", name: "پلاتین جهانی", quoteUnit: "اونس", sourceSymbol: "XPT" },
  { id: "palladium", symbol: "XPD", name: "پالادیوم جهانی", quoteUnit: "اونس", sourceSymbol: "XPD" },
] as const;

const MACRO_ORDER = ["usd", "eur", "gbp", "sar", "omr", "qar", "aed", "kwd", "bhd", "jod", "yer", "gold", "gold18", "silver", "copper", "platinum", "palladium"];

function parseNumeric(value: string | undefined) {
  if (!value) return null;
  const normalized = value.replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/[,٬\s]/g, "");
  const result = Number(normalized);
  return Number.isFinite(result) && result > 0 ? result : null;
}

function readSpan(html: string, id: string) {
  const match = html.match(new RegExp(`<span[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)</span>`, "i"));
  return match?.[1]?.replace(/<[^>]+>/g, "").trim();
}

function stripMarkup(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").trim();
}

export function parseIranGoldGramToman(html: string) {
  const match = html.match(/آخرین\s*قیمت<\/h2>[\s\S]{0,1000}?<h3[^>]*>([\s\S]*?)<\/h3>/i);
  return parseNumeric(match ? stripMarkup(match[1]) : undefined);
}

export function parseIranSilverGramToman(html: string) {
  const match = html.match(/<div[^>]*class=["'][^"']*value\s+tnum[^"']*["'][^>]*>\s*([^<]+?)\s*<span[^>]*class=["']unit["']>\s*Toman\/gram\s*<\/span>/i);
  return parseNumeric(match?.[1]);
}

function readGradeQuote(html: string, label: string, pattern: string) {
  const headingMatch = html.match(new RegExp(`${pattern}[\\s\\S]{0,200}?<h5[^>]*>\\s*([۰-۹0-9][۰-۹0-9,٬\\s]*)\\s*<\\/h5>`, "i"));
  const tomanMatch = html.match(new RegExp(`${pattern}[\\s\\S]{0,200}?([۰-۹0-9][۰-۹0-9,٬\\s]*)\\s*(?:<[^>]+>\\s*)*(?:تومان|Toman)`, "i"));
  const latestToman = parseNumeric(headingMatch?.[1] ?? tomanMatch?.[1]);
  return latestToman ? { label, latestToman } : null;
}

export function parseIranGoldGradeQuotes(html: string): MacroMarketGradeQuote[] {
  return [
    ["طلای ۲۴ عیار", "عیار\\s*24(?:\\s*یا\\s*شمش)?"],
    ["طلای ۲۲ عیار", "عیار\\s*22"],
    ["طلای ۱۸ عیار", "عیار\\s*750\\s*یا\\s*18"],
  ].flatMap(([label, pattern]) => {
    const quote = readGradeQuote(html, label, pattern);
    return quote ? [quote] : [];
  });
}

export function parseIranSilver925GramToman(html: string) {
  const match = html.match(/data-col=["']info\.last_trade\.PDrCotVal["'][^>]*>\s*([۰-۹0-9][۰-۹0-9,٬\s]*)\s*</i);
  const rial = parseNumeric(match?.[1]);
  return rial ? rial / 10 : null;
}

async function fetchText(url: string) {
  const response = await fetch(url, { headers: { accept: "text/html,application/json", "user-agent": USER_AGENT }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Macro market source failed with ${response.status}`);
  return response.text();
}

function macroOrder(asset: MacroMarketAsset) {
  const position = MACRO_ORDER.indexOf(asset.id);
  return position < 0 ? MACRO_ORDER.length : position;
}

function sortMacroMarkets(markets: MacroMarketAsset[]) {
  return [...markets].sort((left, right) => macroOrder(left) - macroOrder(right) || left.name.localeCompare(right.name, "fa"));
}

async function readCache<T>(key: string, load: () => Promise<T>, now: number) {
  const old = cache.get(key) as CacheRecord<T> | undefined;
  if (old && now - old.fetchedAtMs < LIVE_TTL_MS) return { ...old, isStale: false };
  try {
    const value = await load();
    const fresh = { value, fetchedAtMs: now };
    cache.set(key, fresh);
    return { ...fresh, isStale: false };
  } catch (error) {
    if (old && now - old.fetchedAtMs < STALE_TTL_MS) return { ...old, isStale: true };
    throw error;
  }
}

export async function getIranMacroMarkets(now = Date.now()) {
  const page = await readCache("bonbast:page", () => fetchText(BONBAST_URL), now).catch(error => {
    console.warn("[Kronos Guard] Bonbast page fetch failed; using exchange fallback", error instanceof Error ? error.message : "unknown");
    return null;
  });
  const currencies: MacroMarketAsset[] = page
    ? CURRENCY_RATES.flatMap(rate => {
        const sell = parseNumeric(readSpan(page.value, rate.sellId));
        const buy = parseNumeric(readSpan(page.value, rate.buyId));
        if (!sell) return [];
        const multiplier = rate.multiplier ?? 1;
        return [{ id: rate.symbol.toLowerCase(), category: "currency", symbol: rate.symbol, name: rate.name, unit: "تومان", latestToman: sell * multiplier, priceUsd: null, buyToman: buy ? buy * multiplier : null, sellToman: sell * multiplier, updatedAt: new Date(page.fetchedAtMs).toISOString(), isStale: page.isStale, source: "bonbast" }];
      })
    : [];
  let usd = currencies.find(asset => asset.symbol === "USD")?.latestToman;
  if (!usd) {
    try {
      const fallback = await getNobitexTomanPerUsdReference(now);
      usd = fallback.tomanPerUsd;
      currencies.push({ id: "usd", category: "currency", symbol: "USD", name: "دلار آمریکا", unit: "تومان", latestToman: usd, priceUsd: 1, buyToman: usd, sellToman: usd, updatedAt: new Date(fallback.fetchedAtMs).toISOString(), isStale: fallback.isStale, source: "nobitex" });
    } catch (error) {
      console.warn("[Kronos Guard] USD/Toman fallback fetch failed", error instanceof Error ? error.message : "unknown");
    }
  }
  if (usd) currencies.forEach(asset => { asset.priceUsd = asset.latestToman / usd!; });
  const metals: MacroMarketAsset[] = [];
  const iranGramSnapshots = await Promise.allSettled([
    readCache("tala-ir:gold18", async () => {
      const html = await fetchText(IRAN_GOLD_GRAM_URL);
      return { latestToman: parseIranGoldGramToman(html), gradeQuotes: parseIranGoldGradeQuotes(html) };
    }, now),
    readCache("tindex:silver999", () => fetchText(IRAN_SILVER_GRAM_URL).then(parseIranSilverGramToman), now),
    readCache("tgju:silver925", () => fetchText(IRAN_SILVER_925_URL).then(parseIranSilver925GramToman), now),
  ]);
  const goldSnapshot = iranGramSnapshots[0];
  if (goldSnapshot.status === "fulfilled" && goldSnapshot.value.value.latestToman) {
    const { latestToman: tomanPerGram, gradeQuotes } = goldSnapshot.value.value;
    metals.push({ id: "gold", category: "metal", symbol: "GOLD", name: "طلای ۱۸ عیار", unit: "تومان", latestToman: tomanPerGram, priceUsd: usd ? tomanPerGram / usd : null, buyToman: null, sellToman: tomanPerGram, updatedAt: new Date(goldSnapshot.value.fetchedAtMs).toISOString(), isStale: goldSnapshot.value.isStale, source: "tala-ir", quoteUnit: "هر گرم", tomanPerGram, iranGramOnly: true, gradeQuotes });
  } else if (goldSnapshot.status === "rejected") {
    console.warn("[Kronos Guard] gold Iran grade market fetch failed", goldSnapshot.reason instanceof Error ? goldSnapshot.reason.message : "unknown");
  }
  const silverSnapshot = iranGramSnapshots[1];
  const silver925Snapshot = iranGramSnapshots[2];
  if (silverSnapshot.status === "fulfilled" && silverSnapshot.value.value) {
    const tomanPerGram = silverSnapshot.value.value;
    const gradeQuotes = [{ label: "نقره ۹۹۹", latestToman: tomanPerGram }];
    if (silver925Snapshot.status === "fulfilled" && silver925Snapshot.value.value) gradeQuotes.push({ label: "نقره ۹۲۵", latestToman: silver925Snapshot.value.value });
    metals.push({ id: "silver", category: "metal", symbol: "SILVER", name: "نقره ۹۹۹", unit: "تومان", latestToman: tomanPerGram, priceUsd: usd ? tomanPerGram / usd : null, buyToman: null, sellToman: tomanPerGram, updatedAt: new Date(silverSnapshot.value.fetchedAtMs).toISOString(), isStale: silverSnapshot.value.isStale || (silver925Snapshot.status === "fulfilled" && silver925Snapshot.value.isStale), source: "tindex", quoteUnit: "هر گرم", tomanPerGram, iranGramOnly: true, gradeQuotes });
  }
  let globalCurrencies: MacroMarketAsset[] = [];
  if (usd) {
    try {
      const global = await getGlobalFxRates(usd, now);
      const localSymbols = new Set(currencies.map(asset => asset.symbol));
      globalCurrencies = global.rates.flatMap(rate => {
        if (localSymbols.has(rate.symbol)) return [];
        const latestToman = usd / rate.unitsPerUsd;
        return [{ id: rate.symbol.toLowerCase(), category: "currency", symbol: rate.symbol, name: rate.name, unit: "تومان", latestToman, priceUsd: 1 / rate.unitsPerUsd, buyToman: null, sellToman: latestToman, updatedAt: global.updatedAt, isStale: Boolean(page?.isStale) || global.isStale, source: "global-fx" }];
      });
    } catch (error) { console.warn("[Kronos Guard] global FX fetch failed", error instanceof Error ? error.message : "unknown"); }
  }
  if (usd) {
    const globalMetalSnapshots = await Promise.allSettled(
      GLOBAL_METALS.map(definition => readCache(
        `gold-api:${definition.sourceSymbol.toLowerCase()}`,
        () => fetchText(`${GOLD_API_URL}/${definition.sourceSymbol}`).then(text => JSON.parse(text) as { price?: number }),
        now
      ))
    );
    globalMetalSnapshots.forEach((result, index) => {
      const definition = GLOBAL_METALS[index];
      if (result.status !== "fulfilled") {
        console.warn(`[Kronos Guard] ${definition.id} market fetch failed`, result.reason instanceof Error ? result.reason.message : "unknown");
        return;
      }
      const priceUsd = Number(result.value.value.price);
      if (!Number.isFinite(priceUsd) || priceUsd <= 0) return;
      metals.push({ id: definition.id, category: "metal", symbol: definition.symbol, name: definition.name, unit: "تومان", latestToman: priceUsd * usd, priceUsd, buyToman: null, sellToman: priceUsd * usd, updatedAt: new Date(result.value.fetchedAtMs).toISOString(), isStale: Boolean(page?.isStale) || result.value.isStale, source: "gold-api", quoteUnit: definition.quoteUnit });
    });
    try {
      const copper = await readCache("yahoo-finance:copper", () => fetchText(COPPER_URL).then(text => JSON.parse(text) as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> } }), now);
      const priceUsd = Number(copper.value.chart?.result?.[0]?.meta?.regularMarketPrice);
      if (Number.isFinite(priceUsd) && priceUsd > 0) metals.push({ id: "copper", category: "metal", symbol: "XCU", name: "مس جهانی", unit: "تومان", latestToman: priceUsd * usd, priceUsd, buyToman: null, sellToman: priceUsd * usd, updatedAt: new Date(copper.fetchedAtMs).toISOString(), isStale: Boolean(page?.isStale) || copper.isStale, source: "yahoo-finance", quoteUnit: "پوند" });
    } catch (error) { console.warn("[Kronos Guard] copper market fetch failed", error instanceof Error ? error.message : "unknown"); }
  }
  if (!currencies.length && !metals.length) throw new Error("Iranian macro market data is unavailable");
  return { updatedAt: new Date(Math.max(page?.fetchedAtMs ?? 0, now)).toISOString(), markets: sortMacroMarkets([...currencies, ...metals, ...globalCurrencies]) };
}

export function resetIranMacroMarketCacheForTests() { cache.clear(); }
