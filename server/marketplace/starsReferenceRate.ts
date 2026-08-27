const FRAGMENT_PRICES_URL = "https://api.fragment-api.space/api/v1/prices";
const NOBITEX_STATS_URL = "https://apiv2.nobitex.ir/market/stats?srcCurrency=usdt&dstCurrency=rls";
const WALLEX_MARKETS_URL = "https://api.wallex.ir/v1/markets";
const IRR_PER_TOMAN = 10;
const CACHE_TTL_MS = 5 * 60 * 1000;
const STALE_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Fragment publishes an indicative Telegram Stars purchase price in USDT on TON.
 * This is a market reference, not Telegram's platform-specific checkout price.
 */
export type StarsReferenceMarketData = {
  starUsdReference: number;
  usdtIrrReference: number;
  usdTomanReference: number;
  starTomanReference: number;
  updatedAt: string;
  source: "fragment";
  conversionSource: "nobitex" | "wallex";
  isStale: boolean;
};

type FragmentPricesResponse = {
  success?: boolean;
  stars?: { price_per_star_usdt_ton?: string | number };
  cached_at?: string;
};

type NobitexStatsResponse = {
  stats?: Record<string, { mark?: string | number; latest?: string | number }>;
};

type WallexMarketsResponse = {
  result?: { symbols?: Record<string, { stats?: { lastPrice?: string | number } }> };
};

let cachedMarketData: StarsReferenceMarketData | null = null;
let cachedAt = 0;
let inFlightMarketData: Promise<StarsReferenceMarketData> | null = null;

function asPositiveNumber(value: unknown, label: string): number {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) throw new Error(`${label} is invalid`);
  return numericValue;
}

export function readFragmentStarUsdReference(payload: FragmentPricesResponse): number {
  if (payload.success !== true) throw new Error("Fragment Stars price is unavailable");
  return asPositiveNumber(payload.stars?.price_per_star_usdt_ton, "Fragment Stars/USD reference");
}

export function readNobitexUsdtIrrReference(payload: NobitexStatsResponse): number {
  const stats = payload.stats?.["usdt-rls"];
  if (!stats) throw new Error("Nobitex USDT/IRR conversion is unavailable");
  return asPositiveNumber(stats.mark ?? stats.latest, "Nobitex USDT/IRR conversion");
}

export function readWallexUsdtTomanReference(payload: WallexMarketsResponse): number {
  return asPositiveNumber(payload.result?.symbols?.USDTTMN?.stats?.lastPrice, "Wallex USDT/TMN conversion");
}

export function calculateStarsReference(starsAmount: number, starUsdReference: number, usdtIrrReference: number) {
  const amount = asPositiveNumber(starsAmount, "Stars amount");
  const usd = amount * asPositiveNumber(starUsdReference, "Stars/USD reference");
  const toman = (usd * asPositiveNumber(usdtIrrReference, "USDT/IRR conversion")) / IRR_PER_TOMAN;
  return { starsAmount: amount, usd, toman };
}

async function fetchJson<T>(url: string, source: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`${source} request failed with ${response.status}`);
  return response.json() as Promise<T>;
}

async function getUsdTomanReference() {
  try {
    const nobitexStats = await fetchJson<NobitexStatsResponse>(NOBITEX_STATS_URL, "Nobitex");
    const usdtIrrReference = readNobitexUsdtIrrReference(nobitexStats);
    return { usdtIrrReference, usdTomanReference: usdtIrrReference / IRR_PER_TOMAN, conversionSource: "nobitex" as const };
  } catch {
    const wallexMarkets = await fetchJson<WallexMarketsResponse>(WALLEX_MARKETS_URL, "Wallex");
    const usdTomanReference = readWallexUsdtTomanReference(wallexMarkets);
    return { usdtIrrReference: usdTomanReference * IRR_PER_TOMAN, usdTomanReference, conversionSource: "wallex" as const };
  }
}

async function loadStarsReferenceMarketData(now: number): Promise<StarsReferenceMarketData> {
  try {
    const [fragmentPrices, conversion] = await Promise.all([
      fetchJson<FragmentPricesResponse>(FRAGMENT_PRICES_URL, "Fragment"),
      getUsdTomanReference(),
    ]);
    const starUsdReference = readFragmentStarUsdReference(fragmentPrices);
    const marketData: StarsReferenceMarketData = {
      starUsdReference,
      usdtIrrReference: conversion.usdtIrrReference,
      usdTomanReference: conversion.usdTomanReference,
      starTomanReference: starUsdReference * conversion.usdTomanReference,
      updatedAt: fragmentPrices.cached_at ?? new Date(now).toISOString(),
      source: "fragment",
      conversionSource: conversion.conversionSource,
      isStale: false,
    };
    cachedMarketData = marketData;
    cachedAt = now;
    return marketData;
  } catch (error) {
    if (cachedMarketData && now - cachedAt < STALE_CACHE_TTL_MS) return { ...cachedMarketData, isStale: true };
    throw error;
  }
}

export async function getStarsReferenceMarketData(now = Date.now()): Promise<StarsReferenceMarketData> {
  if (cachedMarketData && now - cachedAt < CACHE_TTL_MS) return cachedMarketData;
  const pending = inFlightMarketData ?? loadStarsReferenceMarketData(now);
  inFlightMarketData = pending;
  try {
    return await pending;
  } finally {
    if (inFlightMarketData === pending) inFlightMarketData = null;
  }
}

export function resetStarsReferenceMarketDataForTests() {
  cachedMarketData = null;
  cachedAt = 0;
  inFlightMarketData = null;
}
