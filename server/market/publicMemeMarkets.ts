const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3";
const COINGECKO_PRICE_URL = `${COINGECKO_API_BASE}/simple/price`;
const REQUEST_TIMEOUT_MS = 6_000;
const PRICE_LIVE_TTL_MS = 20_000;
const PRICE_STALE_TTL_MS = 5 * 60_000;
const CHART_LIVE_TTL_MS = 5 * 60_000;
const CHART_STALE_TTL_MS = 60 * 60_000;

export const PUBLIC_MEME_ASSETS = {
  shib: { coinId: "shiba-inu", symbol: "SHIB", aliases: ["شیبا", "شیبا اینو", "شیبااینو"] },
  pepe: { coinId: "pepe", symbol: "PEPE", aliases: ["پپه"] },
  babydoge: { coinId: "baby-doge-coin", symbol: "BABYDOGE", aliases: ["بیبی دوج", "بیبی‌دوج", "بیبی دوج کوین"] },
} as const;

type CoinGeckoPrice = {
  usd?: number;
  usd_24h_change?: number;
  usd_24h_vol?: number;
  usd_24h_high?: number;
  usd_24h_low?: number;
  last_updated_at?: number;
};

type CoinGeckoPayload = Record<string, CoinGeckoPrice>;
type CoinGeckoChartPayload = { prices?: unknown[][]; total_volumes?: unknown[][] };
type CachedSnapshot<T> = { value: T; fetchedAt: number };
let priceCache: CachedSnapshot<CoinGeckoPayload> | null = null;
let priceInFlight: Promise<{ value: CoinGeckoPayload; isStale: boolean }> | null = null;
const chartCache = new Map<string, CachedSnapshot<CoinGeckoChartPayload>>();
const chartInFlight = new Map<string, Promise<CoinGeckoChartPayload>>();

export type PublicMemeCandle = {
  time: number;
  openToman: number;
  highToman: number;
  lowToman: number;
  closeToman: number;
  volumeUsdt: number | null;
};

export type PublicMemeQuote = {
  assetId: keyof typeof PUBLIC_MEME_ASSETS;
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
  isStale: boolean;
  chart: PublicMemeCandle[];
  chartIsStale: boolean;
  source: "coingecko";
};

function normalize(text: string) {
  return text.trim().toLowerCase().replace(/[‌\s\-_/]/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک");
}

export function resolvePublicMemeAssetId(query: string): keyof typeof PUBLIC_MEME_ASSETS | null {
  const normalized = normalize(query);
  if (!normalized) return null;
  for (const [assetId, asset] of Object.entries(PUBLIC_MEME_ASSETS) as [keyof typeof PUBLIC_MEME_ASSETS, (typeof PUBLIC_MEME_ASSETS)[keyof typeof PUBLIC_MEME_ASSETS]][]) {
    if (normalized === assetId || normalized === asset.symbol.toLowerCase() || asset.aliases.some(alias => normalize(alias) === normalized)) return assetId;
  }
  return null;
}

async function fetchPrices(): Promise<CoinGeckoPayload> {
  const ids = Object.values(PUBLIC_MEME_ASSETS).map(asset => asset.coinId).join(",");
  const params = new URLSearchParams({ ids, vs_currencies: "usd", include_24hr_change: "true", include_24hr_vol: "true", include_24hr_high: "true", include_24hr_low: "true", include_last_updated_at: "true" });
  const response = await fetch(`${COINGECKO_PRICE_URL}?${params}`, { headers: { accept: "application/json", "user-agent": "TraderBot/KronosGuard-1.0" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Public meme market failed with ${response.status}`);
  return response.json() as Promise<CoinGeckoPayload>;
}

async function getCachedPrices(now: number) {
  if (priceCache && now - priceCache.fetchedAt < PRICE_LIVE_TTL_MS) return { value: priceCache.value, isStale: false };
  if (!priceInFlight) {
    priceInFlight = fetchPrices().then(value => {
      priceCache = { value, fetchedAt: now };
      return { value, isStale: false };
    }).catch(error => {
      if (priceCache && now - priceCache.fetchedAt < PRICE_STALE_TTL_MS) return { value: priceCache.value, isStale: true };
      throw error;
    }).finally(() => { priceInFlight = null; });
  }
  return priceInFlight;
}

function chartDays(range: "1d" | "7d" | "30d") {
  return range === "1d" ? "1" : range === "7d" ? "7" : "30";
}

async function fetchChart(coinId: string, range: "1d" | "7d" | "30d"): Promise<CoinGeckoChartPayload> {
  const params = new URLSearchParams({ vs_currency: "usd", days: chartDays(range), interval: range === "1d" ? "hourly" : "daily" });
  const response = await fetch(`${COINGECKO_API_BASE}/coins/${encodeURIComponent(coinId)}/market_chart?${params}`, {
    headers: { accept: "application/json", "user-agent": "TraderBot/KronosGuard-1.0" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Public meme chart failed with ${response.status}`);
  return response.json() as Promise<CoinGeckoChartPayload>;
}

async function getCachedChart(coinId: string, range: "1d" | "7d" | "30d", now: number) {
  const key = `${coinId}:${range}`;
  const cached = chartCache.get(key);
  if (cached && now - cached.fetchedAt < CHART_LIVE_TTL_MS) return cached.value;
  const active = chartInFlight.get(key);
  if (active) return active;
  const request = fetchChart(coinId, range).then(value => {
    chartCache.set(key, { value, fetchedAt: now });
    return value;
  }).catch(error => {
    if (cached && now - cached.fetchedAt < CHART_STALE_TTL_MS) return cached.value;
    throw error;
  }).finally(() => { chartInFlight.delete(key); });
  chartInFlight.set(key, request);
  return request;
}

export function clearPublicMemeMarketCache() {
  priceCache = null;
  priceInFlight = null;
  chartCache.clear();
  chartInFlight.clear();
}

function toChart(payload: CoinGeckoChartPayload, tomanPerUsd: number): PublicMemeCandle[] {
  if (!Number.isFinite(tomanPerUsd) || tomanPerUsd <= 0) throw new Error("Public meme chart reference is unavailable");
  const prices = Array.isArray(payload.prices) ? payload.prices : [];
  const volumes = Array.isArray(payload.total_volumes) ? payload.total_volumes : [];
  const volumeByTime = new Map(volumes.flatMap(entry => {
    const time = Number(entry?.[0]);
    const value = Number(entry?.[1]);
    return Number.isFinite(time) && Number.isFinite(value) && value >= 0 ? [[time, value] as const] : [];
  }));
  let previousClose: number | null = null;
  return prices.flatMap(entry => {
    const time = Number(entry?.[0]);
    const usdPrice = Number(entry?.[1]);
    if (!Number.isFinite(time) || !Number.isFinite(usdPrice) || usdPrice <= 0) return [];
    const closeToman = usdPrice * tomanPerUsd;
    const openToman = previousClose ?? closeToman;
    previousClose = closeToman;
    const volumeUsd = volumeByTime.get(time);
    return [{ time, openToman, highToman: Math.max(openToman, closeToman), lowToman: Math.min(openToman, closeToman), closeToman, volumeUsdt: volumeUsd !== undefined ? volumeUsd / usdPrice : null }];
  });
}

function toQuote(assetId: keyof typeof PUBLIC_MEME_ASSETS, price: CoinGeckoPrice, tomanPerUsd: number, now: number, isStale: boolean): PublicMemeQuote {
  const usd = Number(price.usd);
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(tomanPerUsd) || tomanPerUsd <= 0) throw new Error(`${assetId} public price is unavailable`);
  const change = Number(price.usd_24h_change);
  const dayChangePercent = Number.isFinite(change) ? change : 0;
  const latestToman = usd * tomanPerUsd;
  const highUsd = Number(price.usd_24h_high);
  const lowUsd = Number(price.usd_24h_low);
  const dayHighToman = Number.isFinite(highUsd) && highUsd > 0 ? highUsd * tomanPerUsd : latestToman;
  const dayLowToman = Number.isFinite(lowUsd) && lowUsd > 0 ? lowUsd * tomanPerUsd : latestToman;
  const dayOpenToman = dayChangePercent > -100 ? latestToman / (1 + dayChangePercent / 100) : latestToman;
  const asset = PUBLIC_MEME_ASSETS[assetId];
  const updatedAt = Number.isFinite(Number(price.last_updated_at)) ? new Date(Number(price.last_updated_at) * 1_000).toISOString() : new Date(now).toISOString();
  const volumeUsd = Number(price.usd_24h_vol);
  return { assetId, symbol: asset.symbol, market: `${asset.symbol}/USD`, latestToman, priceUsd: usd, markToman: latestToman, bestBuyToman: latestToman, bestSellToman: latestToman, dayLowToman, dayHighToman, dayOpenToman, dayChangePercent, volumeAsset: Number.isFinite(volumeUsd) && volumeUsd >= 0 ? volumeUsd / usd : null, volumeToman: Number.isFinite(volumeUsd) && volumeUsd >= 0 ? volumeUsd * tomanPerUsd : null, updatedAt, isStale, chart: [], chartIsStale: false, source: "coingecko" };
}

export async function getPublicMemeQuotes(tomanPerUsd: number, now = Date.now()): Promise<PublicMemeQuote[]> {
  const { value: prices, isStale } = await getCachedPrices(now);
  return (Object.entries(PUBLIC_MEME_ASSETS) as [keyof typeof PUBLIC_MEME_ASSETS, (typeof PUBLIC_MEME_ASSETS)[keyof typeof PUBLIC_MEME_ASSETS]][]).flatMap(([assetId, asset]) => {
    try { return [toQuote(assetId, prices[asset.coinId] ?? {}, tomanPerUsd, now, isStale)]; } catch { return []; }
  });
}

export async function getPublicMemeQuote(assetId: keyof typeof PUBLIC_MEME_ASSETS, tomanPerUsd: number, now = Date.now()): Promise<PublicMemeQuote> {
  const quote = (await getPublicMemeQuotes(tomanPerUsd, now)).find(item => item.assetId === assetId);
  if (!quote) throw new Error(`${PUBLIC_MEME_ASSETS[assetId].symbol} public market is unavailable`);
  return quote;
}

export async function getPublicMemeChart(assetId: keyof typeof PUBLIC_MEME_ASSETS, tomanPerUsd: number, range: "1d" | "7d" | "30d", now = Date.now()): Promise<PublicMemeCandle[]> {
  const payload = await getCachedChart(PUBLIC_MEME_ASSETS[assetId].coinId, range, now);
  const candles = toChart(payload, tomanPerUsd);
  if (candles.length < 2) throw new Error(`${PUBLIC_MEME_ASSETS[assetId].symbol} public chart is unavailable`);
  return candles;
}
