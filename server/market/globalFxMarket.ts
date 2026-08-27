const GLOBAL_FX_URL = "https://open.er-api.com/v6/latest/USD";
const GLOBAL_FX_FALLBACK_URL = "https://api.frankfurter.dev/v1/latest?base=USD";
const REQUEST_TIMEOUT_MS = 8_000;
const LIVE_TTL_MS = 60_000;
const STALE_TTL_MS = 10 * 60_000;

type CacheRecord<T> = { value: T; fetchedAtMs: number };
let cache: CacheRecord<GlobalFxResponse> | undefined;

export type GlobalFxRate = {
  symbol: string;
  name: string;
  unitsPerUsd: number;
};

type GlobalFxResponse = {
  rates: Record<string, number>;
  timeLastUpdateUnix?: number;
};

const PERSIAN_NAMES: Record<string, string> = {
  AED: "درهم امارات", AFN: "افغانی افغانستان", ALL: "لک آلبانی", AMD: "درام ارمنستان", ANG: "گیلدر آنتیل هلند", AOA: "کوانزای آنگولا", ARS: "پزوی آرژانتین", AUD: "دلار استرالیا", AZN: "منات آذربایجان", BAM: "مارک بوسنی", BDT: "تاکای بنگلادش", BGN: "لِو بلغارستان", BHD: "دینار بحرین", BOB: "بولیویانو", BRL: "رئال برزیل", BYN: "روبل بلاروس", CAD: "دلار کانادا", CHF: "فرانک سوئیس", CLP: "پزوی شیلی", CNY: "یوان چین", COP: "پزوی کلمبیا", CZK: "کرون جمهوری چک", DKK: "کرون دانمارک", DZD: "دینار الجزایر", EGP: "پوند مصر", EUR: "یورو", GBP: "پوند انگلیس", GEL: "لاری گرجستان", GHS: "سدی غنا", HKD: "دلار هنگ‌کنگ", HUF: "فورینت مجارستان", IDR: "روپیه اندونزی", ILS: "شِکِل اسرائیل", INR: "روپیه هند", IQD: "دینار عراق", IRR: "ریال ایران", ISK: "کرون ایسلند", JOD: "دینار اردن", JPY: "ین ژاپن", KES: "شیلینگ کنیا", KHR: "ریل کامبوج", KRW: "وون کره جنوبی", KWD: "دینار کویت", KZT: "تنگه قزاقستان", LBP: "لیره لبنان", LKR: "روپیه سریلانکا", MAD: "درهم مراکش", MMK: "کیات میانمار", MNT: "توگروگ مغولستان", MXN: "پزوی مکزیک", MYR: "رینگیت مالزی", NGN: "نایرای نیجریه", NOK: "کرون نروژ", NPR: "روپیه نپال", NZD: "دلار نیوزیلند", OMR: "ریال عمان", PEN: "سول پرو", PHP: "پزوی فیلیپین", PKR: "روپیه پاکستان", PLN: "زلوتی لهستان", QAR: "ریال قطر", RON: "لئوی رومانی", RUB: "روبل روسیه", SAR: "ریال عربستان", SEK: "کرون سوئد", SGD: "دلار سنگاپور", THB: "بات تایلند", TJS: "سامانی تاجیکستان", TMT: "منات ترکمنستان", TRY: "لیر ترکیه", TWD: "دلار تایوان", UAH: "گریونای اوکراین", UGX: "شیلینگ اوگاندا", USD: "دلار آمریکا", UZS: "سوم ازبکستان", VND: "دانگ ویتنام", XAF: "فرانک آفریقای مرکزی", XCD: "دلار کارائیب شرقی", YER: "ریال یمن", ZAR: "رَند آفریقای جنوبی", ZMW: "کواچای زامبیا"
};

async function fetchGlobalFx(): Promise<GlobalFxResponse> {
  try {
    const response = await fetch(GLOBAL_FX_URL, { headers: { accept: "application/json", "user-agent": "KronosGuard/1.0 market-data" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Global FX source failed with ${response.status}`);
    const payload = await response.json() as { result?: string; rates?: Record<string, number>; time_last_update_unix?: number };
    if (payload.result !== "success" || !payload.rates || typeof payload.rates.USD !== "number") throw new Error("Global FX source returned an invalid schema");
    return { rates: payload.rates, timeLastUpdateUnix: payload.time_last_update_unix };
  } catch (primaryError) {
    const response = await fetch(GLOBAL_FX_FALLBACK_URL, { headers: { accept: "application/json", "user-agent": "KronosGuard/1.0 market-data" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Global FX fallback failed with ${response.status}; primary: ${primaryError instanceof Error ? primaryError.message : "unknown"}`);
    const payload = await response.json() as { base?: string; date?: string; rates?: Record<string, number> };
    if (payload.base !== "USD" || !payload.rates || !Object.keys(payload.rates).length) throw new Error("Global FX fallback returned an invalid schema");
    return { rates: { USD: 1, ...payload.rates }, timeLastUpdateUnix: payload.date ? Math.floor(new Date(`${payload.date}T00:00:00Z`).getTime() / 1000) : undefined };
  }
}

async function readGlobalFx(now: number) {
  if (cache && now - cache.fetchedAtMs < LIVE_TTL_MS) return { ...cache, isStale: false };
  try {
    const value = await fetchGlobalFx();
    cache = { value, fetchedAtMs: now };
    return { ...cache, isStale: false };
  } catch (error) {
    if (cache && now - cache.fetchedAtMs < STALE_TTL_MS) return { ...cache, isStale: true };
    throw error;
  }
}

export async function getGlobalFxRates(tomanPerUsd: number, now = Date.now()) {
  if (!Number.isFinite(tomanPerUsd) || tomanPerUsd <= 0) throw new Error("A valid toman conversion rate is required");
  const snapshot = await readGlobalFx(now);
  const updatedAt = new Date(snapshot.value.timeLastUpdateUnix ? snapshot.value.timeLastUpdateUnix * 1000 : snapshot.fetchedAtMs).toISOString();
  const rates: GlobalFxRate[] = Object.entries(snapshot.value.rates).flatMap(([symbol, unitsPerUsd]) => {
    if (symbol === "USD" || !Number.isFinite(unitsPerUsd) || unitsPerUsd <= 0) return [];
    return [{ symbol, name: PERSIAN_NAMES[symbol] ?? `ارز ${symbol}`, unitsPerUsd }];
  });
  return { rates, updatedAt, fetchedAtMs: snapshot.fetchedAtMs, isStale: snapshot.isStale, source: "global-fx" as const };
}

export function resetGlobalFxCacheForTests() { cache = undefined; }
