import { getPublicMemeChart, getPublicMemeQuote, getPublicMemeQuotes, resolvePublicMemeAssetId, type PublicMemeQuote } from "./publicMemeMarkets";

const NOBITEX_API_BASE = "https://apiv2.nobitex.ir";
const NOBITEX_STATS_URL = `${NOBITEX_API_BASE}/market/stats?srcCurrency=usdt&dstCurrency=rls`;
const WALLEX_MARKETS_URL = "https://api.wallex.ir/v1/markets";
const NOBITEX_RIAL_MARKETS_URL = `${NOBITEX_API_BASE}/market/stats?dstCurrency=rls`;
const IRR_PER_TOMAN = 10;
const REQUEST_TIMEOUT_MS = 6_000;
// Price reads stay briefly coalesced to protect the public API, while remaining near-live for commands.
const LIVE_TTL_MS = 5_000;
const STALE_TTL_MS = 5 * 60_000;
const BOT_USER_AGENT = "TraderBot/KronosGuard-1.0";
const MAX_RIAL_MARKETS = 1_000;
const MAX_CHART_VALIDATED_SEARCH_RESULTS = 10;
export const PERSIAN_SYMBOL_ALIASES: Record<string, string[]> = {
  usdt: ["تتر", "دلار"], btc: ["بیت کوین", "بیت‌کوین"], eth: ["اتریوم"], trx: ["ترون"], ton: ["تون", "تون کوین", "تون‌کوین"], gram: ["گرام", "گرم"], sol: ["سولانا"], doge: ["دوج", "دوج کوین", "دوج‌کوین"],
  xrp: ["ریپل"], ada: ["کاردانو"], shib: ["شیبا", "شیبا اینو", "شیبا‌اینو"], avax: ["آوالانچ", "اولانچ"], dot: ["پولکادات"], link: ["چین لینک", "چین‌لینک"], ltc: ["لایت کوین", "لایت‌کوین"], bnb: ["بایننس", "بایننس کوین"],
  xlm: ["استلار"], uni: ["یونی سواپ", "یونی‌سواپ"], near: ["نیر"], apt: ["آپتوس"], arb: ["آربیتروم"], op: ["آپتیمیسم"], fil: ["فایل کوین", "فایل‌کوین"], aave: ["آوه"], atom: ["کازماس", "کاسموس"],
  sand: ["سندباکس"], mana: ["مانا"], gala: ["گالا"], pepe: ["پپه"], babydoge: ["بیبی دوج", "بیبی‌دوج"], not: ["نات کوین", "نات‌کوین"], xmr: ["مونرو"], algo: ["الگوراند"], icp: ["اینترنت کامپیوتر"], eos: ["ایاس"], qnt: ["کوانت"],
  pol: ["پالیگان"], ftm: ["فانتوم"], inj: ["اینجکتیو"], sui: ["سویی"], sei: ["سی"], etc: ["اتریوم کلاسیک"], bch: ["بیت کوین کش", "بیت‌کوین کش"], dash: ["دش"], zec: ["زی کش", "زی‌کش"], comp: ["کامپوند"], crv: ["کرو"], mkr: ["میکر"], snx: ["سینتتیکس"], grt: ["گراف"], theta: ["تتا"], vet: ["وی چین", "وی‌چین"], one: ["هارمونی"], enj: ["انجین"], chz: ["چیلیز"], bat: ["بت"], ape: ["ایپ کوین", "ایپ‌کوین"], lrc: ["لوپرینگ"], rose: ["اواسس"], flow: ["فلو"],
};

export const NOBITEX_MARKET_RANGES = ["1d", "7d", "30d"] as const;
export type NobitexMarketRange = (typeof NOBITEX_MARKET_RANGES)[number];
export const NOBITEX_PRIMARY_ASSET_IDS = [
  "usdt", "btc", "eth", "trx", "ton", "gram", "sol", "doge", "shib", "pepe", "babydoge",
  "xrp", "ada", "avax", "dot", "link", "ltc", "bnb", "xlm", "uni", "near",
  "apt", "arb", "op", "fil", "aave", "atom", "sand", "mana", "gala", "not",
  "xmr", "algo", "icp", "eos", "qnt", "pol", "ftm", "inj", "sui", "sei",
  "etc", "bch", "dash", "zec", "comp", "crv", "mkr", "snx", "grt", "theta",
  "vet", "one", "enj", "chz", "bat", "ape", "lrc", "rose", "flow",
] as const;
const GUARANTEED_MEME_ASSET_IDS = ["shib", "pepe", "babydoge"] as const;
export type NobitexPrimaryAssetId = (typeof NOBITEX_PRIMARY_ASSET_IDS)[number];
export type NobitexAssetId = string;

type WallexMarketsResponse = { result?: { symbols?: Record<string, { stats?: { lastPrice?: string | number } }> } };

type NobitexStatsPayload = {
  status?: string;
  stats?: Record<string, {
    isClosed?: boolean;
    bestSell?: string | number;
    bestBuy?: string | number;
    volumeSrc?: string | number;
    volumeDst?: string | number;
    latest?: string | number;
    mark?: string | number;
    dayLow?: string | number;
    dayHigh?: string | number;
    dayOpen?: string | number;
    dayClose?: string | number;
    dayChange?: string | number;
  }>;
};

type NobitexOhlcPayload = {
  s?: string;
  t?: unknown[];
  o?: unknown[];
  h?: unknown[];
  l?: unknown[];
  c?: unknown[];
  v?: unknown[];
};

type CacheRecord<T> = { value: T; fetchedAtMs: number };
type CachedResult<T> = CacheRecord<T> & { isStale: boolean };

const cache = new Map<string, CacheRecord<unknown>>();
const inFlight = new Map<string, Promise<CacheRecord<unknown>>>();

export type NobitexCandle = {
  time: number;
  openToman: number;
  highToman: number;
  lowToman: number;
  closeToman: number;
  volumeUsdt: number | null;
};

export type NobitexUsdtMarket = {
  source: "nobitex";
  market: "USDT/IRT";
  latestToman: number;
  markToman: number;
  bestBuyToman: number;
  bestSellToman: number;
  dayLowToman: number;
  dayHighToman: number;
  dayOpenToman: number;
  dayChangePercent: number;
  volumeUsdt: number | null;
  volumeToman: number | null;
  updatedAt: string;
  chart: NobitexCandle[];
  isStale: boolean;
  chartIsStale: boolean;
};

export type NobitexMarketQuote = {
  id: string;
  symbol: string;
  market: string;
  latestToman: number;
  priceUsd: number | null;
  bestBuyToman: number;
  bestSellToman: number;
  dayChangePercent: number;
  volumeToman: number | null;
};

export type NobitexAssetMarket = {
  assetId: NobitexAssetId;
  symbol: string;
  market: string;
  latestToman: number;
  priceUsd: number;
  markToman: number;
  bestBuyToman: number;
  bestSellToman: number;
  dayLowToman: number;
  dayHighToman: number;
  dayOpenToman: number;
  dayChangePercent: number;
  volumeAsset: number | null;
  volumeToman: number | null;
  updatedAt: string;
  chart: NobitexCandle[];
  isStale: boolean;
  chartIsStale: boolean;
};

type NobitexAssetMarketOptions = {
  /** The Mini App requires a validated chart; a chat quote does not. */
  allowMissingChart?: boolean;
};

function asFiniteNumber(value: unknown, label: string) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(`Nobitex ${label} is invalid`);
  return number;
}

function asPositiveNumber(value: unknown, label: string) {
  const number = asFiniteNumber(value, label);
  if (number <= 0) throw new Error(`Nobitex ${label} is unavailable`);
  return number;
}

async function fetchJson<T>(url: string, label: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": BOT_USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Nobitex ${label} failed with ${response.status}`);
  return response.json() as Promise<T>;
}

async function readThroughCache<T>(key: string, load: () => Promise<T>, now: number, liveTtlMs = LIVE_TTL_MS): Promise<CachedResult<T>> {
  const cached = cache.get(key) as CacheRecord<T> | undefined;
  if (cached && now - cached.fetchedAtMs < liveTtlMs) return { ...cached, isStale: false };
  try {
    const pending = inFlight.get(key) as Promise<CacheRecord<T>> | undefined;
    const fresh = pending ?? (() => {
      const request = load().then(value => {
        const record = { value, fetchedAtMs: now };
        cache.set(key, record);
        return record;
      }).finally(() => inFlight.delete(key));
      inFlight.set(key, request as Promise<CacheRecord<unknown>>);
      return request;
    })();
    return { ...(await fresh), isStale: false };
  } catch (error) {
    if (cached && now - cached.fetchedAtMs < STALE_TTL_MS) return { ...cached, isStale: true };
    throw error;
  }
}

function rangeQuery(symbol: string, range: NobitexMarketRange, now: number) {
  const configuration: Record<NobitexMarketRange, { resolution: string; countback: number }> = {
    "1d": { resolution: "60", countback: 24 },
    "7d": { resolution: "240", countback: 42 },
    "30d": { resolution: "D", countback: 30 },
  };
  const selected = configuration[range];
  const params = new URLSearchParams({ symbol, resolution: selected.resolution, to: String(Math.floor(now / 1_000)), countback: String(selected.countback) });
  return `${NOBITEX_API_BASE}/market/udf/history?${params}`;
}

function normalizeAssetId(assetId: string): NobitexAssetId {
  const normalized = assetId.trim().toLowerCase();
  if (!/^[a-z0-9]{1,32}$/.test(normalized)) throw new Error("Nobitex asset ID is invalid");
  return normalized;
}

function statsQuery(assetId: NobitexAssetId) {
  return `${NOBITEX_API_BASE}/market/stats?srcCurrency=${assetId}&dstCurrency=rls`;
}

function readStats(payload: NobitexStatsPayload, assetId: NobitexAssetId) {
  const stats = payload.stats?.[`${assetId}-rls`];
  if (!stats || stats.isClosed) throw new Error(`Nobitex ${assetId.toUpperCase()}/RLS stats are unavailable`);
  const toToman = (value: unknown, label: string) => asPositiveNumber(value, label) / IRR_PER_TOMAN;
  const latestToman = toToman(stats.latest, `${assetId} latest`);
  const optionalToman = (value: unknown, fallback: number, label: string) => {
    try { return toToman(value, label); } catch { return fallback; }
  };
  const markToman = optionalToman(stats.mark, latestToman, `${assetId} mark`);
  return {
    latestToman,
    markToman,
    bestBuyToman: optionalToman(stats.bestBuy, markToman, `${assetId} best buy`),
    bestSellToman: optionalToman(stats.bestSell, markToman, `${assetId} best sell`),
    dayLowToman: optionalToman(stats.dayLow, latestToman, `${assetId} day low`),
    dayHighToman: optionalToman(stats.dayHigh, latestToman, `${assetId} day high`),
    dayOpenToman: optionalToman(stats.dayOpen, latestToman, `${assetId} day open`),
    dayChangePercent: Number.isFinite(Number(stats.dayChange)) ? asFiniteNumber(stats.dayChange, `${assetId} day change`) : 0,
    volumeAsset: Number.isFinite(Number(stats.volumeSrc)) ? asFiniteNumber(stats.volumeSrc, `${assetId} base volume`) : null,
    volumeToman: Number.isFinite(Number(stats.volumeDst)) ? asFiniteNumber(stats.volumeDst, "quote volume") / IRR_PER_TOMAN : null,
  };
}

function readOhlc(payload: NobitexOhlcPayload): NobitexCandle[] {
  if (payload.s !== "ok") throw new Error("Nobitex OHLC is unavailable");
  const times = payload.t ?? [];
  const opens = payload.o ?? [];
  const highs = payload.h ?? [];
  const lows = payload.l ?? [];
  const closes = payload.c ?? [];
  const volumes = payload.v ?? [];
  const length = Math.min(times.length, opens.length, highs.length, lows.length, closes.length);
  const candles: NobitexCandle[] = [];
  for (let index = 0; index < length; index += 1) {
    const time = asFiniteNumber(times[index], "candle time") * 1_000;
    const openToman = asPositiveNumber(opens[index], "candle open");
    const highToman = asPositiveNumber(highs[index], "candle high");
    const lowToman = asPositiveNumber(lows[index], "candle low");
    const closeToman = asPositiveNumber(closes[index], "candle close");
    const rawVolume = Number(volumes[index]);
    candles.push({ time, openToman, highToman, lowToman, closeToman, volumeUsdt: Number.isFinite(rawVolume) && rawVolume >= 0 ? rawVolume : null });
  }
  return candles.sort((left, right) => left.time - right.time);
}

export async function getNobitexUsdtMarket(range: NobitexMarketRange = "1d", now = Date.now()): Promise<NobitexUsdtMarket> {
  const [stats, chart] = await Promise.all([
    readThroughCache("nobitex:usdt:stats", () => fetchJson<NobitexStatsPayload>(NOBITEX_STATS_URL, "market stats"), now),
    readThroughCache(`nobitex:usdt:ohlc:${range}`, () => fetchJson<NobitexOhlcPayload>(rangeQuery("USDTIRT", range, now), "OHLC"), now),
  ]);
  const parsed = readStats(stats.value, "usdt");
  return {
    source: "nobitex",
    market: "USDT/IRT",
    ...parsed,
    volumeUsdt: parsed.volumeAsset,
    updatedAt: new Date(Math.min(stats.fetchedAtMs, chart.fetchedAtMs)).toISOString(),
    chart: readOhlc(chart.value),
    isStale: stats.isStale,
    chartIsStale: chart.isStale,
  };
}

function publicMemeToAssetMarket(quote: PublicMemeQuote): NobitexAssetMarket {
  return { assetId: quote.assetId, symbol: quote.symbol, market: quote.market, latestToman: quote.latestToman, priceUsd: quote.priceUsd, markToman: quote.markToman, bestBuyToman: quote.bestBuyToman, bestSellToman: quote.bestSellToman, dayLowToman: quote.dayLowToman, dayHighToman: quote.dayHighToman, dayOpenToman: quote.dayOpenToman, dayChangePercent: quote.dayChangePercent, volumeAsset: quote.volumeAsset, volumeToman: quote.volumeToman, updatedAt: quote.updatedAt, chart: [], isStale: quote.isStale, chartIsStale: true };
}

export async function getNobitexAssetMarket(assetId: NobitexAssetId, range: NobitexMarketRange = "1d", now = Date.now(), options: NobitexAssetMarketOptions = {}): Promise<NobitexAssetMarket> {
  const normalizedAssetId = normalizeAssetId(assetId);
  const publicAssetId = resolvePublicMemeAssetId(normalizedAssetId);
  if (publicAssetId) {
    const reference = await getNobitexTomanPerUsd(now);
    const quote = await getPublicMemeQuote(publicAssetId, reference.tomanPerUsd, now);
    const chart = options.allowMissingChart ? [] : await getPublicMemeChart(publicAssetId, reference.tomanPerUsd, range).catch(() => []);
    return { ...publicMemeToAssetMarket(quote), chart, chartIsStale: chart.length < 2 };
  }
  const [stats, chart, usdReference] = await Promise.all([
    readThroughCache(`nobitex:${normalizedAssetId}:stats`, () => fetchJson<NobitexStatsPayload>(statsQuery(normalizedAssetId), `${normalizedAssetId} market stats`), now),
    options.allowMissingChart
      ? getNobitexAssetChart(normalizedAssetId, range, now).catch(() => null)
      : getNobitexAssetChart(normalizedAssetId, range, now),
    normalizedAssetId === "usdt" ? Promise.resolve(null) : getNobitexTomanPerUsd(now),
  ]);
  const parsed = readStats(stats.value, normalizedAssetId);
  const tomanPerUsd = usdReference?.tomanPerUsd ?? parsed.latestToman;
  return {
    assetId: normalizedAssetId,
    symbol: normalizedAssetId.toUpperCase(),
    market: `${normalizedAssetId.toUpperCase()}/IRT`,
    ...parsed,
    priceUsd: parsed.latestToman / tomanPerUsd,
    updatedAt: new Date(Math.min(stats.fetchedAtMs, chart?.fetchedAtMs ?? stats.fetchedAtMs, usdReference?.fetchedAtMs ?? stats.fetchedAtMs)).toISOString(),
    chart: chart?.candles ?? [],
    isStale: stats.isStale || Boolean(usdReference?.isStale),
    chartIsStale: chart?.isStale ?? false,
  };
}

async function getNobitexAssetChart(assetId: NobitexAssetId, range: NobitexMarketRange, now: number) {
  const normalizedAssetId = normalizeAssetId(assetId);
  const symbol = `${normalizedAssetId.toUpperCase()}IRT`;
  const chart = await readThroughCache(`nobitex:${normalizedAssetId}:ohlc:${range}`, () => fetchJson<NobitexOhlcPayload>(rangeQuery(symbol, range, now), `${normalizedAssetId} OHLC`), now);
  const candles = readOhlc(chart.value);
  if (candles.length < 2) throw new Error(`Nobitex ${normalizedAssetId.toUpperCase()}/IRT OHLC is unavailable`);
  return { candles, isStale: chart.isStale, fetchedAtMs: chart.fetchedAtMs };
}

async function getNobitexTomanPerUsd(now: number) {
  try {
    const stats = await readThroughCache("nobitex:usdt:stats", () => fetchJson<NobitexStatsPayload>(NOBITEX_STATS_URL, "USDT market stats"), now);
    return { tomanPerUsd: readStats(stats.value, "usdt").latestToman, fetchedAtMs: stats.fetchedAtMs, isStale: stats.isStale };
  } catch (nobitexError) {
    try {
      const wallex = await readThroughCache("wallex:usdt:toman", () => fetchJson<WallexMarketsResponse>(WALLEX_MARKETS_URL, "Wallex USDT market"), now);
      const lastPrice = Number(wallex.value.result?.symbols?.USDTTMN?.stats?.lastPrice);
      if (!Number.isFinite(lastPrice) || lastPrice <= 0) throw new Error("Wallex USDT/TMN price is unavailable");
      return { tomanPerUsd: lastPrice, fetchedAtMs: wallex.fetchedAtMs, isStale: wallex.isStale };
    } catch {
      throw nobitexError;
    }
  }
}

/** Lightweight USD/Toman reference for consumers that must not fetch an OHLC chart. */
export async function getNobitexTomanPerUsdReference(now = Date.now()) {
  return getNobitexTomanPerUsd(now);
}

export async function getNobitexPrimaryMarkets(_range: NobitexMarketRange = "1d", now = Date.now()) {
  // The initial Mini App render must remain bounded: collecting an OHLC chart for every
  // supported asset creates dozens of provider requests and can leave mobile WebViews pending.
  // Load one public ticker snapshot here; the real chart is fetched and validated only after
  // the user opens a specific card through getNobitexAssetMarket.
  const snapshot = await getNobitexTopMarkets(MAX_RIAL_MARKETS, now);
  const quoteByAssetId = new Map(snapshot.markets.map(market => [market.id.replace(/-rls$/i, "").toLowerCase(), market]));
  const missingGuaranteedAssets = GUARANTEED_MEME_ASSET_IDS.filter(assetId => !quoteByAssetId.has(assetId));
  const publicReference = missingGuaranteedAssets.length ? await getNobitexTomanPerUsd(now).catch(() => null) : null;
  if (publicReference) {
    const publicMemeQuotes = await getPublicMemeQuotes(publicReference.tomanPerUsd, now).catch(() => []);
    publicMemeQuotes.forEach(quote => quoteByAssetId.set(quote.assetId, { ...quote, id: `${quote.assetId}-rls`, market: `${quote.symbol}/IRT` }));
  }
  const missingGuaranteedAssetsAfterPublic = GUARANTEED_MEME_ASSET_IDS.filter(assetId => !quoteByAssetId.has(assetId));
  const directGuaranteedQuotes = await Promise.allSettled(
    missingGuaranteedAssetsAfterPublic.map(assetId => getNobitexDirectMarketQuote(assetId, now))
  );
  directGuaranteedQuotes.forEach(result => {
    if (result.status === "fulfilled") quoteByAssetId.set(result.value.id.replace(/-rls$/i, "").toLowerCase(), result.value);
  });
  const primaryMarkets = NOBITEX_PRIMARY_ASSET_IDS.flatMap(assetId => {
    const market = quoteByAssetId.get(assetId);
    return market ? [market] : [];
  });
  const selectedAssetIds = new Set(primaryMarkets.map(market => market.id.replace(/-rls$/i, "").toLowerCase()));
  // A configured primary asset can be temporarily unavailable. Fill its place from the same
  // active public snapshot, so Mini App consistently shows up to 60 distinct live markets.
  const markets = [...primaryMarkets, ...snapshot.markets.filter(market => !selectedAssetIds.has(market.id.replace(/-rls$/i, "").toLowerCase()))].slice(0, 60);
  if (!markets.length) throw new Error("No primary Nobitex markets are available");
  return { updatedAt: snapshot.updatedAt, isStale: snapshot.isStale, markets };
}

export async function getNobitexAssetMarkets(assetIds: readonly string[], range: NobitexMarketRange = "1d", now = Date.now()) {
  const uniqueAssetIds = Array.from(new Set(assetIds.map(normalizeAssetId))).slice(0, 30);
  const settled = await Promise.allSettled(uniqueAssetIds.map(assetId => getNobitexAssetMarket(assetId, range, now)));
  const markets = settled.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  return { updatedAt: new Date(now).toISOString(), markets };
}

function toMarketQuote(id: string, stats: NonNullable<NobitexStatsPayload["stats"]>[string], tomanPerUsd: number | null): NobitexMarketQuote {
  const base = id.split("-")[0]?.toUpperCase();
  if (!base) throw new Error("Nobitex market symbol is invalid");
  const toToman = (value: unknown, label: string) => asPositiveNumber(value, label) / IRR_PER_TOMAN;
  const latestToman = toToman(stats.latest, `${base} latest`);
  const optionalToman = (value: unknown, fallback: number, label: string) => {
    try { return toToman(value, label); } catch { return fallback; }
  };
  const rawVolume = Number(stats.volumeDst);
  return {
    id,
    symbol: base,
    market: `${base}/IRT`,
    latestToman,
    priceUsd: tomanPerUsd ? latestToman / tomanPerUsd : null,
    bestBuyToman: optionalToman(stats.bestBuy, latestToman, `${base} best buy`),
    bestSellToman: optionalToman(stats.bestSell, latestToman, `${base} best sell`),
    dayChangePercent: Number.isFinite(Number(stats.dayChange)) ? asFiniteNumber(stats.dayChange, `${base} day change`) : 0,
    volumeToman: Number.isFinite(rawVolume) && rawVolume >= 0 ? rawVolume / IRR_PER_TOMAN : null,
  };
}

/** Reads a bounded, direct live ticker when a priority card is absent from the bulk snapshot. */
async function getNobitexDirectMarketQuote(assetId: NobitexAssetId, now: number): Promise<NobitexMarketQuote> {
  const normalizedAssetId = normalizeAssetId(assetId);
  const [stats, usdReference] = await Promise.all([
    readThroughCache(`nobitex:${normalizedAssetId}:stats`, () => fetchJson<NobitexStatsPayload>(statsQuery(normalizedAssetId), `${normalizedAssetId} market stats`), now),
    normalizedAssetId === "usdt" ? Promise.resolve(null) : getNobitexTomanPerUsd(now),
  ]);
  const marketStats = stats.value.stats?.[`${normalizedAssetId}-rls`];
  if (!marketStats || marketStats.isClosed) throw new Error(`Nobitex ${normalizedAssetId.toUpperCase()}/RLS stats are unavailable`);
  return toMarketQuote(`${normalizedAssetId}-rls`, marketStats, usdReference?.tomanPerUsd ?? null);
}

export async function getNobitexTopMarkets(limit = 30, now = Date.now()) {
  const boundedLimit = Math.max(1, Math.min(MAX_RIAL_MARKETS, Math.floor(limit)));
  const result = await readThroughCache("nobitex:markets:rls", () => fetchJson<NobitexStatsPayload>(NOBITEX_RIAL_MARKETS_URL, "rial market stats"), now);
  const usdtStats = result.value.stats?.["usdt-rls"];
  let tomanPerUsd: number | null = null;
  try { tomanPerUsd = usdtStats ? toMarketQuote("usdt-rls", usdtStats, null).latestToman : null; } catch { tomanPerUsd = null; }
  const markets = Object.entries(result.value.stats ?? []).flatMap(([id, stats]) => {
    if (!id.endsWith("-rls") || !stats || stats.isClosed) return [];
    try { return [toMarketQuote(id, stats, tomanPerUsd)]; } catch { return []; }
  }).sort((left, right) => (right.volumeToman ?? -1) - (left.volumeToman ?? -1)).slice(0, boundedLimit);
  if (!markets.length) throw new Error("Nobitex rial markets are unavailable");
  return { source: "nobitex" as const, updatedAt: new Date(result.fetchedAtMs).toISOString(), isStale: result.isStale, markets };
}

function resolveConfiguredAssetId(normalizedQuery: string, normalizedText: string) {
  return NOBITEX_PRIMARY_ASSET_IDS.find(assetId => {
    if (assetId === normalizedQuery.toLowerCase()) return true;
    const aliases = PERSIAN_SYMBOL_ALIASES[assetId] ?? [];
    return aliases.some(alias => alias.toLowerCase().replace(/[‌\s\-_\/]/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک") === normalizedText);
  }) ?? null;
}

/** Resolves a command query against the same complete active-rial snapshot that powers Mini App search. */
export async function resolveNobitexActiveMarket(query: string, now = Date.now()): Promise<NobitexMarketQuote | null> {
  const normalizedQuery = query.trim().toUpperCase();
  if (!normalizedQuery) return null;
  const normalizedText = query.trim().toLowerCase().replace(/[‌\s\-_/]/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک");
  const snapshot = await getNobitexTopMarkets(MAX_RIAL_MARKETS, now);
  const exact = snapshot.markets.find(market => {
    const assetId = market.id.replace(/-rls$/i, "").toLowerCase();
    return market.symbol === normalizedQuery || market.market === normalizedQuery || assetId === normalizedQuery.toLowerCase();
  });
  if (exact) return exact;
  const publicAssetId = resolvePublicMemeAssetId(query);
  const publicAlreadyInSnapshot = publicAssetId && snapshot.markets.some(market => market.id.replace(/-rls$/i, "").toLowerCase() === publicAssetId);
  if (publicAssetId && !publicAlreadyInSnapshot) {
    const reference = await getNobitexTomanPerUsd(now).catch(() => null);
    if (reference) {
      const quote = await getPublicMemeQuote(publicAssetId, reference.tomanPerUsd, now).catch(() => null);
      if (quote) return { ...quote, id: `${quote.assetId}-rls`, market: `${quote.symbol}/IRT` };
    }
  }
  const snapshotMatch = snapshot.markets.find(market => {
    const aliases = PERSIAN_SYMBOL_ALIASES[market.symbol.toLowerCase()] ?? [];
    return market.symbol.includes(normalizedQuery)
      || market.market.includes(normalizedQuery)
      || aliases.some(alias => alias.toLowerCase().replace(/[‌\s\-_\/]/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک").includes(normalizedText));
  });
  if (snapshotMatch) return snapshotMatch;
  const configuredAssetId = resolveConfiguredAssetId(normalizedQuery, normalizedText);
  if (configuredAssetId) {
    const directQuote = await getNobitexDirectMarketQuote(configuredAssetId, now).catch(() => null);
    if (directQuote) return directQuote;
  }
  return null;
}

export async function searchNobitexMarkets(query: string, range: NobitexMarketRange = "1d", now = Date.now()) {
  const normalizedQuery = query.trim().toUpperCase();
  if (!normalizedQuery) return { source: "nobitex" as const, updatedAt: new Date(now).toISOString(), isStale: false, markets: [] as NobitexMarketQuote[] };
  const normalizedText = query.trim().toLowerCase().replace(/[‌\s\-_/]/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک");
  const allMarkets = await getNobitexTopMarkets(MAX_RIAL_MARKETS, now);
  let matches = allMarkets.markets.filter(market => {
      const aliases = PERSIAN_SYMBOL_ALIASES[market.symbol.toLowerCase()] ?? [];
      return market.symbol.includes(normalizedQuery)
        || market.market.includes(normalizedQuery)
        || aliases.some(alias => alias.toLowerCase().replace(/[‌\s\-_/]/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک").includes(normalizedText));
    }).slice(0, MAX_CHART_VALIDATED_SEARCH_RESULTS);
  if (!matches.length) {
    const configuredAssetId = resolveConfiguredAssetId(normalizedQuery, normalizedText);
    if (configuredAssetId && !resolvePublicMemeAssetId(query)) {
      const directQuote = await getNobitexDirectMarketQuote(configuredAssetId, now).catch(() => null);
      if (directQuote) return { ...allMarkets, markets: [{ ...directQuote, chartVerified: false }] };
    }
    const publicAssetId = resolvePublicMemeAssetId(query);
    const reference = publicAssetId ? await getNobitexTomanPerUsd(now).catch(() => null) : null;
    const quote = publicAssetId && reference ? await getPublicMemeQuote(publicAssetId, reference.tomanPerUsd, now).catch(() => null) : null;
    if (quote) return { ...allMarkets, markets: [{ ...quote, id: `${quote.assetId}-rls`, market: `${quote.symbol}/IRT`, chartVerified: false }] };
  }
  const settled = await Promise.allSettled(matches.map(market => getNobitexAssetChart(market.symbol.toLowerCase(), range, now)));
  const markets = matches.flatMap((market, index) => settled[index]?.status === "fulfilled" ? [{ ...market, chartVerified: true }] : []);
  return { ...allMarkets, markets };
}

export function resetNobitexMarketCacheForTests() {
  cache.clear();
  inFlight.clear();
}
