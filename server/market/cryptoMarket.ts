import { getStarsReferenceMarketData, readNobitexUsdtIrrReference, resetStarsReferenceMarketDataForTests } from "../marketplace/starsReferenceRate";

const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3";
const COINPAPRIKA_API_BASE = "https://api.coinpaprika.com/v1";
const KRAKEN_API_BASE = "https://api.kraken.com/0/public";
const NOBITEX_USDT_IRR_URL = "https://apiv2.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls";
const WALLEX_MARKETS_URL = "https://api.wallex.ir/v1/markets";
const IRR_PER_TOMAN = 10;
const MARKET_REQUEST_TIMEOUT_MS = 6_000;
const LIVE_CACHE_TTL_MS = 55_000;
// A short live window keeps normal reads fresh; a clearly labelled stale window
// prevents a temporary provider outage from erasing a previously valid market view.
const STALE_CACHE_TTL_MS = 10 * 60_000;
const STALE_CHART_CACHE_TTL_MS = 15 * 60_000;
const MAX_CACHE_ENTRIES = 120;
const MAX_TOP_ASSETS = 250;
const MAX_SEARCH_RESULTS = 80;
const MAX_FALLBACK_PRICE_LOOKUPS = 48;
const TELEGRAM_STARS_ASSET_ID = "telegram-stars";
const STARS_LIVE_CACHE_TTL_MS = 5 * 60_000;
const STARS_STALE_CACHE_TTL_MS = 60 * 60_000;

type CoinGeckoMarket = { id: string; symbol: string; name: string; image?: string; current_price?: number; price_change_percentage_24h?: number | null; market_cap_rank?: number | null; total_volume?: number | null; last_updated?: string };
type CoinGeckoSearchResponse = { coins?: Array<{ id: string; name: string; symbol: string; market_cap_rank?: number | null; thumb?: string; large?: string }> };
type CoinGeckoChartResponse = { prices?: Array<[number, number]> };
type NobitexStatsResponse = { stats?: Record<string, { mark?: string | number; latest?: string | number }> };
type CoinPaprikaQuote = { price?: number; volume_24h?: number; percent_change_24h?: number | null };
type CoinPaprikaTicker = { id: string; name: string; symbol: string; rank?: number | null; last_updated?: string; quotes?: { USD?: CoinPaprikaQuote } };
type CoinPaprikaSearchResponse = { currencies?: Array<{ id: string; name: string; symbol: string; rank?: number | null }> };
type CoinPaprikaHistoricalTick = { timestamp?: string; price?: number | string; quotes?: { USD?: { price?: number | string } } };
type WallexMarketsResponse = { result?: { symbols?: Record<string, { stats?: { lastPrice?: string | number } }> } };
type KrakenOhlcResponse = { error?: string[]; result?: Record<string, unknown> };
type TomanConversion = { tomanPerUsd: number; source: "nobitex" | "wallex" };
type CacheRecord<T> = { value: T; fetchedAtMs: number };
type CachedResult<T> = CacheRecord<T> & { isStale: boolean };

export const CRYPTO_CHART_RANGES = ["1d", "7d", "30d"] as const;
export type CryptoChartRange = (typeof CRYPTO_CHART_RANGES)[number];
const CHART_RANGE_DAYS: Readonly<Record<CryptoChartRange, number>> = { "1d": 1, "7d": 7, "30d": 30 };
const KRAKEN_MAX_POINTS_BY_RANGE: Readonly<Record<CryptoChartRange, number>> = { "1d": 24, "7d": 168, "30d": 720 };

const cache = new Map<string, CacheRecord<unknown>>();
const inFlight = new Map<string, Promise<CacheRecord<unknown>>>();
const chartSourceHealth = new Map<"coingecko" | "coinpaprika" | "kraken", { attempts: number; successes: number }>();

function recordChartSourceOutcome(source: "coingecko" | "coinpaprika" | "kraken", succeeded: boolean) {
  const current = chartSourceHealth.get(source) ?? { attempts: 0, successes: 0 };
  const next = { attempts: current.attempts + 1, successes: current.successes + (succeeded ? 1 : 0) };
  chartSourceHealth.set(source, next.attempts > 250 ? { attempts: Math.ceil(next.attempts / 2), successes: Math.ceil(next.successes / 2) } : next);
}

function chartSourceSuccessRate(source: "coingecko" | "coinpaprika" | "kraken") {
  const health = chartSourceHealth.get(source);
  return health?.attempts ? Math.round((health.successes / health.attempts) * 100) : 100;
}

export type CryptoMarketAsset = {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  rank: number | null;
  priceUsd: number;
  priceToman: number | null;
  change24h: number | null;
  volumeUsd: number | null;
  updatedAt: string;
};
export type CryptoMarketSearchItem = Omit<CryptoMarketAsset, "priceUsd"> & { priceUsd: number | null };

export type CryptoMarketChartPoint = { time: number; priceUsd: number; priceToman: number | null };
export type CryptoMarketCandle = { time: number; openUsd: number; highUsd: number; lowUsd: number; closeUsd: number };
export type CryptoMarketChart = { assetId: string; range: CryptoChartRange; points: CryptoMarketChartPoint[]; candles: CryptoMarketCandle[]; updatedAt: string; isStale: boolean; sourceSuccessRate: number };
export type CryptoMarketResponse<T> = {
  data: T;
  updatedAt: string;
  isStale: boolean;
  source: "coingecko" | "coinpaprika" | "kraken" | "fragment";
  tomanConversionSource?: "nobitex" | "wallex";
};

export type CryptoMarketTrendSummary = {
  trackedAssets: number;
  assetsWithChange: number;
  gainers: number;
  decliners: number;
  unchanged: number;
  breadthPercent: number | null;
  strongestGainer: Pick<CryptoMarketAsset, "id" | "name" | "symbol" | "change24h"> | null;
  strongestDecliner: Pick<CryptoMarketAsset, "id" | "name" | "symbol" | "change24h"> | null;
};

const KRAKEN_USD_SYMBOLS: Readonly<Record<string, string>> = {
  bitcoin: "BTC", "btc-bitcoin": "BTC", ethereum: "ETH", "eth-ethereum": "ETH", tether: "USDT", "usdt-tether": "USDT",
  ripple: "XRP", "xrp-xrp": "XRP", solana: "SOL", "sol-solana": "SOL", "the-open-network": "TON", "ton-toncoin": "TON",
  tron: "TRX", "trx-tron": "TRX", dogecoin: "DOGE", "doge-dogecoin": "DOGE", "shiba-inu": "SHIB", "shib-shiba-inu": "SHIB",
  binancecoin: "BNB", "bnb-binance-coin": "BNB", cardano: "ADA", "ada-cardano": "ADA", polkadot: "DOT", "dot-polkadot": "DOT",
  "avalanche-2": "AVAX", "avax-avalanche": "AVAX", chainlink: "LINK", "link-chainlink": "LINK", pepe: "PEPE", "pepe-pepe": "PEPE",
};

const PERSIAN_ASSETS: Array<{ terms: string[]; id: string; name: string; symbol: string }> = [
  { terms: ["بیت کوین", "بیتکوین"], id: "bitcoin", name: "Bitcoin", symbol: "btc" },
  { terms: ["اتریوم"], id: "ethereum", name: "Ethereum", symbol: "eth" },
  { terms: ["تتر"], id: "tether", name: "Tether", symbol: "usdt" },
  { terms: ["ریپل"], id: "ripple", name: "XRP", symbol: "xrp" },
  { terms: ["سولانا"], id: "solana", name: "Solana", symbol: "sol" },
  { terms: ["تون", "تلگرام اوپن نتورک"], id: "the-open-network", name: "TON", symbol: "ton" },
  { terms: ["ترون"], id: "tron", name: "TRON", symbol: "trx" },
  { terms: ["دوج", "دوج کوین"], id: "dogecoin", name: "Dogecoin", symbol: "doge" },
  { terms: ["شیبا", "شیبا اینو"], id: "shiba-inu", name: "Shiba Inu", symbol: "shib" },
  { terms: ["بایننس", "بایننس کوین"], id: "binancecoin", name: "BNB", symbol: "bnb" },
  { terms: ["کاردانو"], id: "cardano", name: "Cardano", symbol: "ada" },
  { terms: ["پولکادات"], id: "polkadot", name: "Polkadot", symbol: "dot" },
  { terms: ["آوالانچ"], id: "avalanche-2", name: "Avalanche", symbol: "avax" },
  { terms: ["چین لینک", "چینلینک"], id: "chainlink", name: "Chainlink", symbol: "link" },
  { terms: ["پپه", "پپه کوین"], id: "pepe", name: "Pepe", symbol: "pepe" },
  { terms: ["نات کوین", "ناتکوین"], id: "notcoin", name: "Notcoin", symbol: "not" },
  { terms: ["همستر", "همستر کامبت"], id: "hamster-kombat", name: "Hamster Kombat", symbol: "hmstr" },
];

const STARS_SEARCH_TERMS = ["استارز", "استار", "تلگرام استارز", "telegram stars", "stars", "xtr"];

function normalizePersian(value: string) {
  return value.trim().toLowerCase().replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/\s+/g, " ");
}

function compactCache() {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  Array.from(cache.entries()).sort((left, right) => left[1].fetchedAtMs - right[1].fetchedAtMs).slice(0, cache.size - MAX_CACHE_ENTRIES).forEach(([key]) => cache.delete(key));
}

async function fetchJson<T>(url: string, source: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(MARKET_REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${source} request failed with ${response.status}`);
  return response.json() as Promise<T>;
}

async function readThroughCache<T>(key: string, load: () => Promise<T>, now = Date.now(), staleTtlMs = STALE_CACHE_TTL_MS, liveTtlMs = LIVE_CACHE_TTL_MS): Promise<CachedResult<T>> {
  const cached = cache.get(key) as CacheRecord<T> | undefined;
  if (cached && now - cached.fetchedAtMs < liveTtlMs) return { ...cached, isStale: false };
  try {
    const pending = inFlight.get(key) as Promise<CacheRecord<T>> | undefined;
    const fresh = pending ?? (() => {
      const request = load().then(value => {
        const record = { value, fetchedAtMs: now };
        cache.set(key, record);
        compactCache();
        return record;
      }).finally(() => inFlight.delete(key));
      inFlight.set(key, request as Promise<CacheRecord<unknown>>);
      return request;
    })();
    return { ...(await fresh), isStale: false };
  } catch (error) {
    if (cached && now - cached.fetchedAtMs < staleTtlMs) return { ...cached, isStale: true };
    throw error;
  }
}

function asPositiveNumber(value: unknown, label: string) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} is unavailable`);
  return number;
}

function asFiniteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

type StarsAssetResult = {
  asset: CryptoMarketAsset;
  updatedAt: string;
  isStale: boolean;
  tomanConversionSource: "nobitex" | "wallex";
};

async function getStarsAsset(now: number): Promise<StarsAssetResult> {
  const reference = await readThroughCache(
    "fragment:telegram-stars",
    () => getStarsReferenceMarketData(now),
    now,
    STARS_STALE_CACHE_TTL_MS,
    STARS_LIVE_CACHE_TTL_MS,
  );
  const data = reference.value;
  return {
    asset: {
      id: TELEGRAM_STARS_ASSET_ID,
      symbol: "XTR",
      name: "Telegram Stars",
      image: null,
      rank: null,
      priceUsd: data.starUsdReference,
      priceToman: data.starTomanReference,
      change24h: null,
      volumeUsd: null,
      updatedAt: data.updatedAt,
    },
    updatedAt: data.updatedAt,
    isStale: reference.isStale || data.isStale,
    tomanConversionSource: data.conversionSource,
  };
}

function matchesStarsSearch(query: string) {
  return STARS_SEARCH_TERMS.some(term => {
    const normalizedTerm = normalizePersian(term);
    return normalizedTerm.includes(query) || query.includes(normalizedTerm);
  });
}

function prependStarsSearch(stars: StarsAssetResult | null, items: CryptoMarketSearchItem[]) {
  return stars ? [stars.asset, ...items.filter(item => item.id !== TELEGRAM_STARS_ASSET_ID)] : items;
}

function earliestUpdatedAt(values: Array<string | undefined>, fallbackNow: number) {
  let earliest = fallbackNow;
  values.forEach(value => {
    const timestamp = value ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(timestamp)) earliest = Math.min(earliest, timestamp);
  });
  return new Date(earliest).toISOString();
}

function toAsset(market: CoinGeckoMarket, tomanPerUsd: number | undefined): CryptoMarketAsset {
  const priceUsd = asPositiveNumber(market.current_price, `${market.name} USD price`);
  return { id: market.id, symbol: market.symbol.toUpperCase(), name: market.name, image: market.image ?? null, rank: market.market_cap_rank ?? null, priceUsd, priceToman: tomanPerUsd ? priceUsd * tomanPerUsd : null, change24h: asFiniteNumber(market.price_change_percentage_24h), volumeUsd: asFiniteNumber(market.total_volume), updatedAt: market.last_updated ?? new Date().toISOString() };
}

function toPaprikaAsset(market: CoinPaprikaTicker, tomanPerUsd: number | undefined): CryptoMarketAsset {
  const priceUsd = asPositiveNumber(market.quotes?.USD?.price, `${market.name} USD price`);
  return { id: market.id, symbol: market.symbol.toUpperCase(), name: market.name, image: null, rank: market.rank ?? null, priceUsd, priceToman: tomanPerUsd ? priceUsd * tomanPerUsd : null, change24h: asFiniteNumber(market.quotes?.USD?.percent_change_24h), volumeUsd: asFiniteNumber(market.quotes?.USD?.volume_24h), updatedAt: market.last_updated ?? new Date().toISOString() };
}

async function getTomanPerUsd(now = Date.now()) {
  return readThroughCache("iranian-usdt:toman", async () => {
    try {
      const payload = await fetchJson<NobitexStatsResponse>(NOBITEX_USDT_IRR_URL, "Nobitex");
      return { tomanPerUsd: readNobitexUsdtIrrReference(payload) / IRR_PER_TOMAN, source: "nobitex" as const };
    } catch {
      const payload = await fetchJson<WallexMarketsResponse>(WALLEX_MARKETS_URL, "Wallex");
      return { tomanPerUsd: asPositiveNumber(payload.result?.symbols?.USDTTMN?.stats?.lastPrice, "Wallex USDT/TMN price"), source: "wallex" as const };
    }
  }, now);
}

async function getOptionalTomanPerUsd(now = Date.now()) {
  try { return await getTomanPerUsd(now); } catch { return null; }
}

function marketUrl(ids?: string, page = 1, limit = 24) {
  const params = new URLSearchParams({ vs_currency: "usd", order: "market_cap_desc", per_page: String(limit), page: String(page), sparkline: "false", price_change_percentage: "24h" });
  if (ids) params.set("ids", ids);
  return `${COINGECKO_API_BASE}/coins/markets?${params}`;
}

async function getTopMarketData(limit: number, now: number) {
  try {
    const markets = await readThroughCache(`coingecko:top:${limit}`, () => fetchJson<CoinGeckoMarket[]>(marketUrl(undefined, 1, limit), "CoinGecko"), now);
    return { markets, source: "coingecko" as const };
  } catch {
    const markets = await readThroughCache("coinpaprika:top:active", () => fetchJson<CoinPaprikaTicker[]>(`${COINPAPRIKA_API_BASE}/tickers?quotes=USD`, "CoinPaprika"), now);
    return { markets: { ...markets, value: markets.value.filter(item => asFiniteNumber(item.quotes?.USD?.price) !== null).sort((left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER)).slice(0, limit) }, source: "coinpaprika" as const };
  }
}

function toSearchItem(item: Pick<CryptoMarketAsset, "id" | "symbol" | "name" | "image" | "rank">, priced: CryptoMarketAsset | undefined): CryptoMarketSearchItem {
  return {
    ...item,
    priceUsd: priced?.priceUsd ?? null,
    priceToman: priced?.priceToman ?? null,
    change24h: priced?.change24h ?? null,
    volumeUsd: priced?.volumeUsd ?? null,
    updatedAt: priced?.updatedAt ?? new Date().toISOString(),
  };
}

async function getCoinGeckoSearchPrices(ids: string[], now: number, tomanPerUsd: number | undefined): Promise<Map<string, CryptoMarketAsset>> {
  if (!ids.length) return new Map<string, CryptoMarketAsset>();
  try {
    const markets = await readThroughCache(`coingecko:search-prices:${ids.join(",")}`, () => fetchJson<CoinGeckoMarket[]>(marketUrl(ids.join(","), 1, ids.length), "CoinGecko"), now);
    return new Map(markets.value.flatMap(item => {
      try { return [[item.id, toAsset(item, tomanPerUsd)] as const]; } catch { return []; }
    }));
  } catch {
    return new Map<string, CryptoMarketAsset>();
  }
}

async function getPaprikaSearchPrices(items: Array<{ id: string }>, now: number, tomanPerUsd: number | undefined): Promise<Map<string, CryptoMarketAsset>> {
  const entries: Array<readonly [string, CryptoMarketAsset] | null> = [];
  const candidates = items.slice(0, MAX_FALLBACK_PRICE_LOOKUPS);
  for (let offset = 0; offset < candidates.length; offset += 6) {
    const batch = await Promise.all(candidates.slice(offset, offset + 6).map(async item => {
      try {
        const ticker = await getPaprikaAsset(item.id, now);
        return [item.id, toPaprikaAsset(ticker.value, tomanPerUsd)] as const;
      } catch {
        return null;
      }
    }));
    entries.push(...batch);
  }
  const prices = new Map<string, CryptoMarketAsset>();
  entries.forEach(entry => {
    if (entry) prices.set(entry[0], entry[1]);
  });
  return prices;
}

async function getPaprikaAsset(assetId: string, now: number) {
  const id = assetId.trim().toLowerCase();
  if (id.includes("-")) {
    try { return await readThroughCache(`coinpaprika:asset:${id}`, () => fetchJson<CoinPaprikaTicker>(`${COINPAPRIKA_API_BASE}/tickers/${encodeURIComponent(id)}?quotes=USD`, "CoinPaprika"), now); } catch { /* resolve CoinGecko-style IDs below */ }
  }
  const search = await readThroughCache(`coinpaprika:search:${id}`, () => fetchJson<CoinPaprikaSearchResponse>(`${COINPAPRIKA_API_BASE}/search/?q=${encodeURIComponent(id)}&c=currencies&limit=10`, "CoinPaprika"), now);
  const candidate = (search.value.currencies ?? []).find(item => item.id === id) ?? search.value.currencies?.[0];
  if (!candidate) throw new Error("Crypto asset is unavailable");
  return readThroughCache(`coinpaprika:asset:${candidate.id}`, () => fetchJson<CoinPaprikaTicker>(`${COINPAPRIKA_API_BASE}/tickers/${encodeURIComponent(candidate.id)}?quotes=USD`, "CoinPaprika"), now);
}

export async function getCryptoMarketTopAssets(limit = 24, now = Date.now()): Promise<CryptoMarketResponse<CryptoMarketAsset[]>> {
  const normalizedLimit = Math.max(1, Math.min(MAX_TOP_ASSETS, Math.floor(limit)));
  const [[starsResult, marketResult], toman] = await Promise.all([
    Promise.allSettled([getStarsAsset(now), getTopMarketData(normalizedLimit, now)]),
    getOptionalTomanPerUsd(now),
  ]);
  const stars = starsResult.status === "fulfilled" ? starsResult.value : null;
  const marketData = marketResult.status === "fulfilled" ? marketResult.value : null;
  const cryptoAssets = marketData
    ? (marketData.source === "coingecko"
      ? (marketData.markets.value as CoinGeckoMarket[]).flatMap(item => { try { return [toAsset(item, toman?.value.tomanPerUsd)]; } catch { return []; } })
      : (marketData.markets.value as CoinPaprikaTicker[]).flatMap(item => { try { return [toPaprikaAsset(item, toman?.value.tomanPerUsd)]; } catch { return []; } }))
    : [];
  const data = [...(stars ? [stars.asset] : []), ...cryptoAssets].slice(0, normalizedLimit);
  if (!data.length && marketResult.status === "rejected") throw marketResult.reason;
  const marketUpdatedAt = marketData ? new Date(Math.min(marketData.markets.fetchedAtMs, toman?.fetchedAtMs ?? marketData.markets.fetchedAtMs)).toISOString() : undefined;
  const isStale = (stars?.isStale ?? false) || (marketData ? marketData.markets.isStale || !toman || toman.isStale : false);
  return {
    data,
    updatedAt: earliestUpdatedAt([stars?.updatedAt, marketUpdatedAt], now),
    isStale,
    source: marketData?.source ?? "fragment",
    ...(toman ? { tomanConversionSource: toman.value.source } : stars ? { tomanConversionSource: stars.tomanConversionSource } : {}),
  };
}

/** Informational market breadth derived from the current public top-market response; never a recommendation. */
export async function getCryptoMarketTrendSummary(now = Date.now()): Promise<CryptoMarketResponse<CryptoMarketTrendSummary>> {
  const market = await getCryptoMarketTopAssets(100, now);
  const changed = market.data.filter((asset): asset is CryptoMarketAsset & { change24h: number } => typeof asset.change24h === "number" && Number.isFinite(asset.change24h));
  const gainers = changed.filter(asset => asset.change24h > 0);
  const decliners = changed.filter(asset => asset.change24h < 0);
  const unchanged = changed.length - gainers.length - decliners.length;
  const summary: CryptoMarketTrendSummary = {
    trackedAssets: market.data.length,
    assetsWithChange: changed.length,
    gainers: gainers.length,
    decliners: decliners.length,
    unchanged,
    breadthPercent: changed.length ? Math.round(((gainers.length - decliners.length) / changed.length) * 1000) / 10 : null,
    strongestGainer: gainers.length ? [...gainers].sort((left, right) => right.change24h - left.change24h)[0] : null,
    strongestDecliner: decliners.length ? [...decliners].sort((left, right) => left.change24h - right.change24h)[0] : null,
  };
  return { ...market, data: summary };
}

export async function searchCryptoMarketAssets(query: string, now = Date.now()): Promise<CryptoMarketResponse<CryptoMarketSearchItem[]>> {
  const normalizedQuery = normalizePersian(query);
  if (!normalizedQuery) return { data: [], updatedAt: new Date(now).toISOString(), isStale: false, source: "coingecko" };
  const starsPromise = matchesStarsSearch(normalizedQuery) ? getStarsAsset(now).catch(() => null) : Promise.resolve(null);
  const persianMatches = PERSIAN_ASSETS.filter(asset => asset.terms.some(term => normalizePersian(term).includes(normalizedQuery) || normalizedQuery.includes(normalizePersian(term))));
  const local = persianMatches.map(asset => ({ id: asset.id, name: asset.name, symbol: asset.symbol.toUpperCase(), image: null, rank: null }));
  const [toman, stars] = await Promise.all([getOptionalTomanPerUsd(now), starsPromise]);
  if (/^[\u0600-\u06ff]/.test(normalizedQuery)) {
    const priced = await getCoinGeckoSearchPrices(local.map(item => item.id), now, toman?.value.tomanPerUsd);
    const fallbackPrices = priced.size === local.length ? new Map<string, CryptoMarketAsset>() : await getPaprikaSearchPrices(local.filter(item => !priced.has(item.id)), now, toman?.value.tomanPerUsd);
    const prices = new Map<string, CryptoMarketAsset>();
    fallbackPrices.forEach((price, id) => prices.set(id, price));
    priced.forEach((price, id) => prices.set(id, price));
    const data = prependStarsSearch(stars, local.map(item => toSearchItem(item, prices.get(item.id))));
    return { data, updatedAt: earliestUpdatedAt([stars?.updatedAt], now), isStale: (stars?.isStale ?? false) || (local.length > 0 && (!toman || toman.isStale)), source: local.length > 0 ? "coingecko" : "fragment", ...(toman ? { tomanConversionSource: toman.value.source } : stars ? { tomanConversionSource: stars.tomanConversionSource } : {}) };
  }
  try {
    const remote = await readThroughCache(`coingecko:search:${normalizedQuery}`, () => fetchJson<CoinGeckoSearchResponse>(`${COINGECKO_API_BASE}/search?query=${encodeURIComponent(query.trim())}`, "CoinGecko"), now);
    const remoteCoins = (remote.value.coins ?? []).slice(0, MAX_SEARCH_RESULTS).map(coin => ({ id: coin.id, name: coin.name, symbol: coin.symbol.toUpperCase(), image: coin.large ?? coin.thumb ?? null, rank: coin.market_cap_rank ?? null }));
    const items = [...local, ...remoteCoins].filter((item, index, array) => array.findIndex(candidate => candidate.id === item.id) === index).slice(0, MAX_SEARCH_RESULTS);
    const priced = await getCoinGeckoSearchPrices(items.map(item => item.id), now, toman?.value.tomanPerUsd);
    const fallbackPrices = priced.size === items.length ? new Map<string, CryptoMarketAsset>() : await getPaprikaSearchPrices(items.filter(item => !priced.has(item.id)), now, toman?.value.tomanPerUsd);
    const prices = new Map<string, CryptoMarketAsset>();
    fallbackPrices.forEach((price, id) => prices.set(id, price));
    priced.forEach((price, id) => prices.set(id, price));
    return { data: prependStarsSearch(stars, items.map(item => toSearchItem(item, prices.get(item.id)))), updatedAt: earliestUpdatedAt([stars?.updatedAt, new Date(remote.fetchedAtMs).toISOString()], now), isStale: remote.isStale || !toman || toman.isStale || (stars?.isStale ?? false), source: "coingecko", ...(toman ? { tomanConversionSource: toman.value.source } : stars ? { tomanConversionSource: stars.tomanConversionSource } : {}) };
  } catch {
    try {
      const remote = await readThroughCache(`coinpaprika:search:${normalizedQuery}`, () => fetchJson<CoinPaprikaSearchResponse>(`${COINPAPRIKA_API_BASE}/search/?q=${encodeURIComponent(query.trim())}&c=currencies&limit=50`, "CoinPaprika"), now);
      const remoteCoins = (remote.value.currencies ?? []).slice(0, MAX_SEARCH_RESULTS).map(coin => ({ id: coin.id, name: coin.name, symbol: coin.symbol.toUpperCase(), image: null, rank: coin.rank ?? null }));
      const items = [...local, ...remoteCoins].filter((item, index, array) => array.findIndex(candidate => candidate.id === item.id) === index).slice(0, MAX_SEARCH_RESULTS);
      const priced = await getPaprikaSearchPrices(items, now, toman?.value.tomanPerUsd);
      return { data: prependStarsSearch(stars, items.map(item => toSearchItem(item, priced.get(item.id)))), updatedAt: earliestUpdatedAt([stars?.updatedAt, new Date(remote.fetchedAtMs).toISOString()], now), isStale: remote.isStale || !toman || toman.isStale || (stars?.isStale ?? false), source: "coinpaprika", ...(toman ? { tomanConversionSource: toman.value.source } : stars ? { tomanConversionSource: stars.tomanConversionSource } : {}) };
    } catch (error) {
      if (stars) return { data: [stars.asset], updatedAt: stars.updatedAt, isStale: stars.isStale, source: "fragment", tomanConversionSource: stars.tomanConversionSource };
      throw error;
    }
  }
}

export async function getCryptoMarketAsset(assetId: string, now = Date.now()): Promise<CryptoMarketResponse<CryptoMarketAsset>> {
  const id = assetId.trim().toLowerCase();
  if (id === TELEGRAM_STARS_ASSET_ID) {
    const stars = await getStarsAsset(now);
    return { data: stars.asset, updatedAt: stars.updatedAt, isStale: stars.isStale, source: "fragment", tomanConversionSource: stars.tomanConversionSource };
  }
  const toman = await getOptionalTomanPerUsd(now);
  try {
    const markets = await readThroughCache(`coingecko:asset:${id}`, () => fetchJson<CoinGeckoMarket[]>(marketUrl(id, 1, 1), "CoinGecko"), now);
    const market = markets.value[0];
    if (!market) throw new Error("CoinGecko asset is unavailable");
    return { data: toAsset(market, toman?.value.tomanPerUsd), updatedAt: new Date(Math.min(markets.fetchedAtMs, toman?.fetchedAtMs ?? markets.fetchedAtMs)).toISOString(), isStale: markets.isStale || !toman || toman.isStale, source: "coingecko", ...(toman ? { tomanConversionSource: toman.value.source } : {}) };
  } catch {
    const market = await getPaprikaAsset(id, now);
    return { data: toPaprikaAsset(market.value, toman?.value.tomanPerUsd), updatedAt: new Date(Math.min(market.fetchedAtMs, toman?.fetchedAtMs ?? market.fetchedAtMs)).toISOString(), isStale: market.isStale || !toman || toman.isStale, source: "coinpaprika", ...(toman ? { tomanConversionSource: toman.value.source } : {}) };
  }
}

function toChartPoints(prices: Array<[number, number]>, tomanPerUsd: number | undefined) {
  return prices.filter(([time, priceUsd]) => Number.isFinite(time) && Number.isFinite(priceUsd) && priceUsd > 0).map(([time, priceUsd]) => ({ time, priceUsd, priceToman: tomanPerUsd ? priceUsd * tomanPerUsd : null }));
}

function deriveCandlesFromPrices(prices: Array<[number, number]>, range: CryptoChartRange): CryptoMarketCandle[] {
  const bucketMs = range === "1d" ? 15 * 60_000 : range === "7d" ? 4 * 60 * 60_000 : 12 * 60 * 60_000;
  const buckets = new Map<number, CryptoMarketCandle>();
  for (const [time, price] of prices) {
    if (!Number.isFinite(time) || !Number.isFinite(price) || price <= 0) continue;
    const bucketTime = Math.floor(time / bucketMs) * bucketMs;
    const candle = buckets.get(bucketTime);
    if (candle) {
      candle.highUsd = Math.max(candle.highUsd, price);
      candle.lowUsd = Math.min(candle.lowUsd, price);
      candle.closeUsd = price;
    } else {
      buckets.set(bucketTime, { time: bucketTime, openUsd: price, highUsd: price, lowUsd: price, closeUsd: price });
    }
  }
  return Array.from(buckets.values()).sort((left, right) => left.time - right.time);
}

async function getKrakenChart(assetId: string, range: CryptoChartRange, now: number) {
  const symbol = KRAKEN_USD_SYMBOLS[assetId];
  if (!symbol) throw new Error("Kraken pair is unavailable for this asset");
  const pair = `${symbol}USD`;
  return readThroughCache(`kraken:chart:${pair}:${range}`, async () => {
    const payload = await fetchJson<KrakenOhlcResponse>(`${KRAKEN_API_BASE}/OHLC?pair=${encodeURIComponent(pair)}&interval=60&assetVersion=1`, "Kraken");
    if (payload.error?.length) throw new Error(`Kraken returned ${payload.error.join(", ")}`);
    const rows = Object.entries(payload.result ?? {}).find(([key]) => key !== "last")?.[1];
    if (!Array.isArray(rows)) throw new Error("Kraken chart is unavailable");
    const candles = rows.flatMap((row): CryptoMarketCandle[] => {
      if (!Array.isArray(row)) return [];
      const time = asFiniteNumber(row[0]);
      const open = asFiniteNumber(row[1]);
      const high = asFiniteNumber(row[2]);
      const low = asFiniteNumber(row[3]);
      const close = asFiniteNumber(row[4]);
      return time !== null && open !== null && high !== null && low !== null && close !== null && open > 0 && high > 0 && low > 0 && close > 0
        ? [{ time: time * 1_000, openUsd: open, highUsd: high, lowUsd: low, closeUsd: close }]
        : [];
    });
    const limitedCandles = candles.slice(-KRAKEN_MAX_POINTS_BY_RANGE[range]);
    const points = limitedCandles.map(candle => [candle.time, candle.closeUsd] as [number, number]);
    if (points.length < 2) throw new Error("Kraken chart has insufficient points");
    return { points, candles: limitedCandles };
  }, now, STALE_CHART_CACHE_TTL_MS);
}

async function getPaprikaChart(assetId: string, range: CryptoChartRange, now: number) {
  const ticker = await getPaprikaAsset(assetId, now);
  const end = new Date(now).toISOString();
  const start = new Date(now - CHART_RANGE_DAYS[range] * 24 * 60 * 60_000).toISOString();
  return readThroughCache(`coinpaprika:chart:${ticker.value.id}:${range}`, async () => {
    const payload = await fetchJson<CoinPaprikaHistoricalTick[]>(`${COINPAPRIKA_API_BASE}/tickers/${encodeURIComponent(ticker.value.id)}/historical?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&interval=1h`, "CoinPaprika");
    const points = payload.flatMap((tick): Array<[number, number]> => {
      const time = tick.timestamp ? Date.parse(tick.timestamp) : Number.NaN;
      const price = asFiniteNumber(tick.price ?? tick.quotes?.USD?.price);
      return Number.isFinite(time) && price !== null && price > 0 ? [[time, price]] : [];
    });
    if (points.length < 2) throw new Error("CoinPaprika chart has insufficient points");
    return points;
  }, now, STALE_CHART_CACHE_TTL_MS);
}

function chartResponse(assetId: string, range: CryptoChartRange, source: "coingecko" | "coinpaprika" | "kraken", rawPrices: Array<[number, number]>, chart: Pick<CachedResult<unknown>, "fetchedAtMs" | "isStale">, toman: Awaited<ReturnType<typeof getOptionalTomanPerUsd>>, candles: CryptoMarketCandle[], includeCandles: boolean): CryptoMarketResponse<CryptoMarketChart> {
  const points = toChartPoints(rawPrices, toman?.value.tomanPerUsd);
  const unavailable = points.length < 2;
  const updatedAt = new Date(Math.min(chart.fetchedAtMs, toman?.fetchedAtMs ?? chart.fetchedAtMs)).toISOString();
  const isStale = unavailable || chart.isStale || !toman || toman.isStale;
  recordChartSourceOutcome(source, !unavailable && !chart.isStale);
  return { data: { assetId, range, points: unavailable ? [] : points, candles: unavailable || !includeCandles ? [] : candles, updatedAt, isStale, sourceSuccessRate: chartSourceSuccessRate(source) }, updatedAt, isStale, source, ...(toman ? { tomanConversionSource: toman.value.source } : {}) };
}

export async function getCryptoMarketChart(assetId: string, range: CryptoChartRange = "1d", now = Date.now(), includeCandles = false): Promise<CryptoMarketResponse<CryptoMarketChart>> {
  const id = assetId.trim().toLowerCase();
  if (id === TELEGRAM_STARS_ASSET_ID) {
    try {
      const stars = await getStarsAsset(now);
      return { data: { assetId: id, range, points: [], candles: [], updatedAt: stars.updatedAt, isStale: false, sourceSuccessRate: 100 }, updatedAt: stars.updatedAt, isStale: false, source: "fragment", tomanConversionSource: stars.tomanConversionSource };
    } catch {
      const updatedAt = new Date(now).toISOString();
      return { data: { assetId: id, range, points: [], candles: [], updatedAt, isStale: false, sourceSuccessRate: 0 }, updatedAt, isStale: false, source: "fragment" };
    }
  }
  const tomanPromise = getOptionalTomanPerUsd(now);
  try {
    const chart = await readThroughCache(`coingecko:chart:${id}:${range}`, () => fetchJson<CoinGeckoChartResponse>(`${COINGECKO_API_BASE}/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${CHART_RANGE_DAYS[range]}`, "CoinGecko"), now, STALE_CHART_CACHE_TTL_MS);
    const prices = chart.value.prices ?? [];
    return chartResponse(id, range, "coingecko", prices, chart, await tomanPromise, deriveCandlesFromPrices(prices, range), includeCandles);
  } catch {
    recordChartSourceOutcome("coingecko", false);
    try {
      const chart = await getPaprikaChart(id, range, now);
      return chartResponse(id, range, "coinpaprika", chart.value, chart, await tomanPromise, deriveCandlesFromPrices(chart.value, range), includeCandles);
    } catch {
      recordChartSourceOutcome("coinpaprika", false);
      try {
        const chart = await getKrakenChart(id, range, now);
        return chartResponse(id, range, "kraken", chart.value.points, chart, await tomanPromise, chart.value.candles, includeCandles);
      } catch {
        recordChartSourceOutcome("kraken", false);
        const updatedAt = new Date(now).toISOString();
        const toman = await tomanPromise;
        return { data: { assetId: id, range, points: [], candles: [], updatedAt, isStale: true, sourceSuccessRate: chartSourceSuccessRate("kraken") }, updatedAt, isStale: true, source: "kraken", ...(toman ? { tomanConversionSource: toman.value.source } : {}) };
      }
    }
  }
}

export function resetCryptoMarketCacheForTests() {
  cache.clear();
  inFlight.clear();
  chartSourceHealth.clear();
  resetStarsReferenceMarketDataForTests();
}
