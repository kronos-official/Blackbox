import React, { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  Calculator,
  ChevronDown,
  ChevronUp,
  Radio,
  RefreshCw,
  Search,
  Star,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardLocale } from "@/lib/dashboardI18n";
import { classicCryptoMarketCopyFor } from "@/lib/classicCryptoMarketI18n";
import { trpc } from "@/lib/trpc";
import {
  useNobitexRealtime,
  type LiveMarketQuote,
} from "@/lib/useNobitexRealtime";

type Range = "1d" | "7d" | "30d";
type Candle = {
  time: number;
  closeToman: number;
  openToman: number;
  highToman: number;
  lowToman: number;
  volumeUsdt: number | null;
};
type Detail = {
  assetId: string;
  symbol: string;
  market: string;
  latestToman: number;
  priceUsd: number;
  bestBuyToman: number;
  bestSellToman: number;
  dayLowToman: number;
  dayHighToman: number;
  dayChangePercent: number;
  volumeAsset: number | null;
  updatedAt: string;
  chart: Candle[];
};
type Quote = {
  id: string;
  symbol: string;
  market: string;
  latestToman: number;
  priceUsd: number | null;
  bestBuyToman: number;
  bestSellToman: number;
  dayChangePercent: number;
};
type Item = Quote & { assetId: string; detail?: Detail };
type StarsRate = { starUsdReference: number; starTomanReference: number };
type MacroAsset = {
  id: string;
  category: "currency" | "metal";
  symbol: string;
  name: string;
  latestToman: number;
  priceUsd: number | null;
  buyToman: number | null;
  sellToman: number | null;
  isStale: boolean;
  source?: "bonbast" | "gold-api" | "global-fx" | "yahoo-finance" | "nobitex" | "tala-ir" | "tindex" | "tgju";
  quoteUnit?: string;
  priceUsdPerGram?: number | null;
  tomanPerGram?: number | null;
  iranGramOnly?: boolean;
  gradeQuotes?: Array<{ label: string; latestToman: number }>;
  updatedAt: string;
};

const PINNED_SYMBOLS = ["TON", "GRAM", "USDT"] as const;
const ORDER = [
  "TON", "GRAM", "USDT", "BTC", "ETH", "TRX", "SOL", "DOGE", "SHIB", "PEPE", "BABYDOGE", "XRP", "ADA", "BNB", "AVAX", "LTC", "LINK", "DOT", "POL", "UNI", "ATOM", "NEAR", "ICP", "ETC", "BCH", "XLM", "EOS", "ALGO", "SAND", "MANA", "GALA", "NOT", "FTM", "INJ", "SUI", "SEI", "APT", "ARB", "OP", "FIL", "AAVE", "MKR", "COMP", "CRV", "SNX", "GRT", "THETA", "VET", "CHZ", "APE", "FLOW", "QNT", "DASH", "ZEC", "XMR", "ENJ", "BAT", "LRC", "ONE", "ROSE",
] as const;
const MARKET_PAGE_SIZE = 8;
const MARKET_PAGE_TRANSITION_MS = 620;
const faNames: Record<string, string> = {
  USDT: "تتر",
  BTC: "بیت‌کوین",
  ETH: "اتریوم",
  TRX: "ترون",
  TON: "تون‌کوین",
  GRAM: "گرام",
  SOL: "سولانا",
  DOGE: "دوج‌کوین",
  SHIB: "شیبا اینو",
  PEPE: "پپه",
  BABYDOGE: "بیبی دوج",
  XRP: "ریپل",
  ADA: "کاردانو",
  AVAX: "آوالانچ",
  DOT: "پولکادات",
  LINK: "چین‌لینک",
  LTC: "لایت‌کوین",
  BNB: "بایننس‌کوین",
  XLM: "استلار",
  UNI: "یونی‌سواپ",
  NEAR: "نیر",
  APT: "آپتوس",
  ARB: "آربیتروم",
  OP: "آپتیمیسم",
  FIL: "فایل‌کوین",
  AAVE: "آوه",
  ATOM: "کازماس",
  SAND: "سندباکس",
  MANA: "مانا",
  GALA: "گالا",
  NOT: "نات‌کوین",
  XMR: "مونرو",
  ALGO: "الگوراند",
  ICP: "اینترنت کامپیوتر",
  EOS: "ایاس",
  POL: "پالیگان",
  FTM: "فانتوم",
  INJ: "اینژکتیو",
  SUI: "سوئی",
  SEI: "سئی",
  BCH: "بیت‌کوین کش",
  DASH: "دش",
  ZEC: "زیکش",
  COMP: "کامپاند",
  CRV: "کرو",
  MKR: "میکر",
  SNX: "سینتتیکس",
  GRT: "گراف",
  THETA: "تتا",
  VET: "وی‌چین",
  ONE: "هارمونی",
  ENJ: "انجین",
  CHZ: "چیلیز",
  BAT: "بت",
  APE: "ایپ‌کوین",
  LRC: "لوپرینگ",
  QNT: "کوانت",
  ETC: "اتریوم کلاسیک",
  ROSE: "اوسیس نتورک",
  FLOW: "فلو",
};

export const formatMarketNumber = (value: number) =>
  Math.abs(value) >= 1
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)
    : new Intl.NumberFormat("en-US", { maximumSignificantDigits: 8 }).format(value);
const toman = (value: number | null | undefined, unit: string) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${formatMarketNumber(value)} ${unit}`
    : "—";
export const formatMarketUsd = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? `$${value < 1 ? new Intl.NumberFormat("en-US", { maximumSignificantDigits: 8 }).format(value) : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}`
    : "—";
const usd = formatMarketUsd;
const itemFromDetail = (detail: Detail): Item => ({
  ...detail,
  id: `${detail.assetId}-rls`,
  assetId: detail.assetId,
  detail,
});
const itemFromQuote = (quote: Quote): Item => ({
  ...quote,
  assetId: String(quote.id ?? quote.symbol).replace(/-rls$/i, "").toLowerCase(),
});
const uniqueItems = (items: Item[]) => {
  const seen = new Set<string>();
  return items.filter(item => {
    const id = item.assetId.trim().toLowerCase();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};
const displayName = (symbol: string, locale: DashboardLocale) => {
  const normalized = symbol.toUpperCase();
  return locale === "fa" ? `${normalized} (${faNames[normalized] ?? normalized})` : normalized;
};

function Stat({
  label,
  value,
  tone = "text-white",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[.028] p-3">
      <p className="text-[10px] font-bold text-slate-500">{label}</p>
      <p dir="ltr" className={`mt-1 truncate text-sm font-black ${tone}`}>
        {value}
      </p>
    </div>
  );
}

function StarsCalculator({
  locale,
  rate,
}: {
  locale: DashboardLocale;
  rate: StarsRate | undefined;
}) {
  const copy = classicCryptoMarketCopyFor(locale);
  const [count, setCount] = useState("100");
  const [currency, setCurrency] = useState<"toman" | "usd">("toman");
  const total =
    Math.max(0, Number(count) || 0) *
    (currency === "toman"
      ? (rate?.starTomanReference ?? 0)
      : (rate?.starUsdReference ?? 0));
  return (
    <div
      className="border-t border-amber-200/15 bg-amber-300/[.035] p-4 sm:p-5"
      data-testid="stars-calculator"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-amber-200" />
            <h4 className="font-black text-white">{copy.starsCalculator}</h4>
          </div>
          <p className="mt-1 text-xs text-amber-100/70">
            {copy.referenceRate}:{" "}
            <b dir="ltr" className="text-amber-100">
              {usd(rate?.starUsdReference)} ·{" "}
              {toman(rate?.starTomanReference, copy.toman)}
            </b>
          </p>
        </div>
        <span className="rounded-full border border-amber-200/20 bg-amber-300/[.08] px-2 py-1 text-[10px] font-black text-amber-100">
          {copy.referenceRate}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label>
          <span className="mb-1.5 block text-[11px] font-bold text-slate-400">
            {copy.starsCount}
          </span>
          <Input
            type="number"
            min="0"
            inputMode="decimal"
            value={count}
            onChange={event => setCount(event.target.value)}
            className="h-11 border-amber-200/20 bg-slate-950/30 text-white"
          />
        </label>
        <CurrencyToggle
          locale={locale}
          currency={currency}
          setCurrency={setCurrency}
          tone="amber"
        />
      </div>
      <div className="mt-3 rounded-2xl border border-amber-200/15 bg-slate-950/25 p-4">
        <p className="text-[11px] font-bold text-amber-100/65">
          {copy.referenceEstimate}
        </p>
        <p dir="ltr" className="mt-1 text-2xl font-black text-white">
          {currency === "toman" ? toman(total, copy.toman) : usd(total)}
        </p>
      </div>
      <p
        role="note"
        className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[.07] px-3 py-2.5 text-xs leading-6 text-amber-100"
      >
        {copy.starsDisclaimer}
      </p>
    </div>
  );
}

function CurrencyToggle({
  locale,
  currency,
  setCurrency,
  tone,
}: {
  locale: DashboardLocale;
  currency: "toman" | "usd";
  setCurrency: (value: "toman" | "usd") => void;
  tone: "amber" | "cyan";
}) {
  const copy = classicCryptoMarketCopyFor(locale);
  const active =
    tone === "amber"
      ? "bg-amber-300/15 text-amber-100"
      : "bg-cyan-300/15 text-cyan-100";
  return (
    <div
      className="self-end inline-flex h-11 rounded-xl border border-white/10 bg-slate-950/35 p-1"
      role="group"
      aria-label={copy.calculationCurrency}
    >
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-pressed={currency === "toman"}
        onClick={() => setCurrency("toman")}
        className={currency === "toman" ? active : "text-slate-400"}
      >
        {copy.toman}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-pressed={currency === "usd"}
        onClick={() => setCurrency("usd")}
        className={currency === "usd" ? active : "text-slate-400"}
      >
        USD
      </Button>
    </div>
  );
}

function AssetCalculator({
  locale,
  symbol,
  latestToman,
  priceUsd,
}: {
  locale: DashboardLocale;
  symbol: string;
  latestToman: number;
  priceUsd: number | null;
}) {
  const copy = classicCryptoMarketCopyFor(locale);
  const [count, setCount] = useState("1");
  const [currency, setCurrency] = useState<"toman" | "usd">("toman");
  const total =
    Math.max(0, Number(count) || 0) *
    (currency === "toman" ? latestToman : (priceUsd ?? 0));
  return (
    <div
      className="border-t border-cyan-200/15 bg-cyan-300/[.035] p-4 sm:p-5"
      data-testid={`asset-calculator-${symbol.toLowerCase()}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-cyan-200" />
          <h4 dir="ltr" className="font-black text-white">
            {displayName(symbol, locale)}
          </h4>
        </div>
        <p dir="ltr" className="text-xs font-bold text-cyan-100">
          {usd(priceUsd)} · {toman(latestToman, copy.toman)}
        </p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label>
          <span
            dir="ltr"
            className="mb-1.5 block text-[11px] font-bold text-slate-400"
          >
            {symbol}
          </span>
          <Input
            type="number"
            min="0"
            inputMode="decimal"
            value={count}
            onChange={event => setCount(event.target.value)}
            className="h-11 border-cyan-200/20 bg-slate-950/30 text-white"
          />
        </label>
        <CurrencyToggle
          locale={locale}
          currency={currency}
          setCurrency={setCurrency}
          tone="cyan"
        />
      </div>
      <div className="mt-3 rounded-xl border border-cyan-200/15 bg-slate-950/25 p-3">
        <p className="text-[11px] font-bold text-cyan-100/65">
          {copy.referenceEstimate}
        </p>
        <p dir="ltr" className="mt-1 text-xl font-black text-white">
          {currency === "toman" ? toman(total, copy.toman) : usd(total)}
        </p>
      </div>
    </div>
  );
}

function DetailPanel({
  detail,
  live,
  range,
  setRange,
  locale,
  loading,
  failed,
  refresh,
}: {
  detail: Detail | undefined;
  live: LiveMarketQuote | undefined;
  range: Range;
  setRange: (value: Range) => void;
  locale: DashboardLocale;
  loading: boolean;
  failed: boolean;
  refresh: () => void;
}) {
  const copy = classicCryptoMarketCopyFor(locale);
  const shown = detail && {
    ...detail,
    latestToman: live?.latestToman ?? detail.latestToman,
    bestBuyToman: live?.bestBuyToman ?? detail.bestBuyToman,
    bestSellToman: live?.bestSellToman ?? detail.bestSellToman,
    dayChangePercent: live?.dayChangePercent ?? detail.dayChangePercent,
  };
  if (!shown)
    return (
      <div
        data-testid="asset-detail-panel"
        className="border-t border-cyan-200/15 bg-slate-950/25 p-6 text-center text-sm text-slate-400"
      >
        {loading ? copy.loadingMarket : failed ? copy.recoveringMarket : ""}
      </div>
    );
  const rising = shown.dayChangePercent >= 0;
  const chart = shown.chart.map(point => ({
    ...point,
    label: new Intl.DateTimeFormat(
      locale === "fa" ? "fa-IR-u-nu-latn" : locale,
      range === "1d"
        ? { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit" }
        : { timeZone: "Asia/Tehran", month: "short", day: "2-digit" }
    ).format(new Date(point.time)),
  }));
  return (
    <div
      data-testid="asset-detail-panel"
      className="border-t border-cyan-200/15 bg-slate-950/25 p-4 sm:p-5"
    >
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-cyan-200" />
            <h4 className="font-black text-white">
              {displayName(shown.symbol, locale)}
            </h4>
            <span
              dir="ltr"
              className="text-[10px] font-black tracking-[.13em] text-slate-500"
            >
              {shown.market}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{copy.livePriceChart}</p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={copy.refreshAsset.replace(
            "{asset}",
            displayName(shown.symbol, locale)
          )}
          onClick={refresh}
          disabled={loading}
          className="border-cyan-200/20 bg-white/[.04] text-cyan-100"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[.07] p-4">
          <p className="text-[11px] font-bold text-cyan-100/70">
            {copy.currentPrice}
          </p>
          <p dir="ltr" className="mt-2 text-2xl font-black text-white">
            {usd(shown.priceUsd)}
          </p>
          <p dir="ltr" className="mt-1 text-xs font-bold text-cyan-100/65">
            {toman(shown.latestToman, copy.toman)}
          </p>
          <p
            dir="ltr"
            className={`mt-2 inline-flex items-center gap-1 text-xs font-black ${rising ? "text-emerald-300" : "text-rose-300"}`}
          >
            {rising ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {rising ? "+" : ""}
            {shown.dayChangePercent.toFixed(2)}%
          </p>
        </div>
        <Stat
          label={copy.bestBuy}
          value={toman(shown.bestBuyToman, copy.toman)}
          tone="text-emerald-200"
        />
        <Stat
          label={copy.bestSell}
          value={toman(shown.bestSellToman, copy.toman)}
          tone="text-rose-200"
        />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Stat
          label={copy.dayRange}
          value={`${toman(shown.dayLowToman, copy.toman)} — ${toman(shown.dayHighToman, copy.toman)}`}
        />
        <Stat
          label={copy.volume}
          value={
            shown.volumeAsset
              ? `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(shown.volumeAsset)} ${shown.symbol}`
              : "—"
          }
        />
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h5 className="font-black text-white">{copy.chartSource}</h5>
          <p className="mt-1 text-xs text-slate-500">{copy.realMarketData}</p>
        </div>
        <div
          className="inline-flex rounded-xl border border-white/10 bg-slate-950/35 p-1"
          role="group"
          aria-label={copy.selectChartRange}
        >
          {(["1d", "7d", "30d"] as Range[]).map(id => (
            <Button
              key={id}
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={range === id}
              onClick={() => setRange(id)}
              className={
                range === id ? "bg-cyan-300/15 text-cyan-100" : "text-slate-400"
              }
            >
              {copy.ranges[id].label}
            </Button>
          ))}
        </div>
      </div>
      <div
        dir="ltr"
        className="mt-3 h-60 rounded-2xl border border-white/8 bg-slate-950/25 p-3"
      >
        {chart.length >= 2 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart}>
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,.12)" />
              <XAxis
                dataKey="label"
                minTickGap={36}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#94a3b8", fontSize: 10 }}
              />
              <YAxis
                dataKey="closeToman"
                width={72}
                tickFormatter={value =>
                  new Intl.NumberFormat("en-US", {
                    notation: "compact",
                  }).format(Number(value))
                }
                tickLine={false}
                axisLine={false}
                tick={{ fill: "#94a3b8", fontSize: 10 }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  const point = payload?.[0]?.payload as Candle | undefined;
                  return active && point ? (
                    <div className="rounded-xl border border-cyan-200/20 bg-slate-950/95 px-3 py-2 text-xs text-slate-100">
                      {copy.price}: <b>{toman(point.closeToman, copy.toman)}</b>
                    </div>
                  ) : null;
                }}
              />
              <Area
                type="monotone"
                dataKey="closeToman"
                stroke="#67e8f9"
                strokeWidth={2}
                fill="rgba(103,232,249,.25)"
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center px-4 text-center text-sm text-slate-400">
            {loading ? copy.chartSync : failed ? copy.recoveringMarket : copy.chartSync}
          </div>
        )}
      </div>
    </div>
  );
}

function MarketCard({
  item,
  selected,
  setSelected,
  locale,
  live,
  detail,
  range,
  setRange,
  loading,
  failed,
  refresh,
  pinned,
}: {
  item: Item;
  selected: string | null;
  setSelected: (value: string | null) => void;
  locale: DashboardLocale;
  live: LiveMarketQuote | undefined;
  detail: Detail | undefined;
  range: Range;
  setRange: (value: Range) => void;
  loading: boolean;
  failed: boolean;
  refresh: () => void;
  pinned: boolean;
}) {
  const copy = classicCryptoMarketCopyFor(locale);
  const active = selected === item.assetId;
  const quote = live ?? item;
  return (
    <Card
      className={`kronos-card overflow-hidden ${pinned ? "border-cyan-200/20 bg-cyan-300/[.045]" : "border-white/8 bg-slate-950/20"}`}
      data-testid={pinned ? `pinned-${item.symbol.toLowerCase()}` : undefined}
    >
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setSelected(active ? null : item.assetId)}
          className="flex w-full items-center justify-between gap-3 p-4 text-right"
        >
          <div>
            <div className="flex items-center gap-2">
              <p className="font-black text-white">
                {displayName(item.symbol, locale)}
              </p>
              <span
                dir="ltr"
                className="text-[10px] font-bold tracking-[.13em] text-slate-500"
              >
                {item.market}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
              <div>
                <p dir="ltr" className="text-lg font-black text-cyan-100">
                  {usd(item.priceUsd)}
                </p>
                <p dir="ltr" className="mt-0.5 text-[11px] font-bold text-cyan-100/60">
                  {toman(quote.latestToman, copy.toman)}
                </p>
              </div>
              <span
                dir="ltr"
                className={
                  quote.dayChangePercent >= 0
                    ? "text-[11px] font-black text-emerald-300"
                    : "text-[11px] font-black text-rose-300"
                }
              >
                {quote.dayChangePercent >= 0 ? "+" : ""}
                {quote.dayChangePercent.toFixed(2)}%
              </span>
            </div>
          </div>
          {active ? (
            <ChevronUp className="h-5 w-5 text-cyan-200" />
          ) : (
            <ChevronDown className="h-5 w-5 text-slate-500" />
          )}
        </button>
        {active && (
          <>
            <DetailPanel
              detail={detail}
              live={live}
              range={range}
              setRange={setRange}
              locale={locale}
              loading={loading}
              failed={failed}
              refresh={refresh}
            />
            <AssetCalculator
              locale={locale}
              symbol={item.symbol}
              latestToman={quote.latestToman}
              priceUsd={item.priceUsd}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ClassicCryptoMarket({ locale }: { locale: DashboardLocale }) {
  const copy = classicCryptoMarketCopyFor(locale);
  const [selected, setSelected] = useState<string | null>("ton");
  const [range, setRange] = useState<Range>("1d");
  const [term, setTerm] = useState("");
  const [visibleCount, setVisibleCount] = useState(MARKET_PAGE_SIZE);
  const [macroTerm, setMacroTerm] = useState("");
  const [macroVisibleCount, setMacroVisibleCount] = useState(MARKET_PAGE_SIZE);
  const [selectedMacroId, setSelectedMacroId] = useState<string | null>(null);
  const query = term.trim();
  const realtime = useNobitexRealtime(true);
  const utils = trpc.useUtils();
  const primary = trpc.dashboard.cryptoMarket.nobitexPrimaryMarkets.useQuery(
    { range },
    { refetchInterval: 60_000, refetchIntervalInBackground: false }
  );
  const stars = trpc.dashboard.cryptoMarket.starsReference.useQuery(undefined, {
    refetchInterval: 300_000,
    refetchIntervalInBackground: false,
  });
  const macro = trpc.dashboard.cryptoMarket.iranMacroMarkets.useQuery(
    undefined,
    { refetchInterval: 120_000, refetchIntervalInBackground: false }
  );
  const favorites = trpc.dashboard.cryptoMarket.favorites.useQuery();
  const favoriteIds = favorites.data?.assetIds ?? [];
  const favoriteMarkets =
    trpc.dashboard.cryptoMarket.nobitexFavoriteMarkets.useQuery(
      { assetIds: favoriteIds.length ? favoriteIds : ["usdt"], range },
      {
        enabled: favoriteIds.length > 0,
        refetchInterval: 60_000,
        refetchIntervalInBackground: false,
      }
    );
  const search = trpc.dashboard.cryptoMarket.nobitexSearch.useQuery(
    { query: query || "usdt", range },
    {
      enabled: Boolean(query),
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    }
  );
  const asset = trpc.dashboard.cryptoMarket.nobitexAsset.useQuery(
    {
      assetId: selected && selected !== "telegram-stars" ? selected : "usdt",
      range,
    },
    {
      enabled: Boolean(selected && selected !== "telegram-stars"),
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    }
  );
  const setFavorite = trpc.dashboard.cryptoMarket.setFavorite.useMutation({
    onSuccess: () => utils.dashboard.cryptoMarket.favorites.invalidate(),
  });
  const liveTomanPerUsd = realtime.quotes.USDT?.latestToman;
  const primaryItems = useMemo(
    () =>
      uniqueItems(
        ((primary.data?.markets ?? []) as Quote[]).map(quote => {
          const liveQuote = realtime.quotes[quote.symbol];
          const latestToman = liveQuote?.latestToman ?? quote.latestToman;
          return itemFromQuote({
            ...quote,
            latestToman,
            priceUsd: liveTomanPerUsd
              ? latestToman / liveTomanPerUsd
              : quote.priceUsd,
          });
        })
      )
        .sort((a, b) => {
          const left = ORDER.indexOf(a.symbol as (typeof ORDER)[number]);
          const right = ORDER.indexOf(b.symbol as (typeof ORDER)[number]);
          return (
            (left < 0 ? 999 : left) - (right < 0 ? 999 : right) ||
            a.symbol.localeCompare(b.symbol)
          );
        }),
    [primary.data, realtime.quotes, liveTomanPerUsd]
  );
  const pinnedItems = useMemo(
    () =>
      uniqueItems(
        PINNED_SYMBOLS.flatMap(symbol =>
          primaryItems.filter(item => item.symbol === symbol)
        )
      ),
    [primaryItems]
  );
  const favoriteMarketsItems = useMemo(() => {
    const map = new Map<string, Item>();
    for (const market of (favoriteMarkets.data?.markets ?? []) as Detail[]) {
      const liveQuote = realtime.quotes[market.symbol];
      const latestToman = liveQuote?.latestToman ?? market.latestToman;
      map.set(
        market.assetId,
        itemFromDetail({
          ...market,
          latestToman,
          priceUsd: liveTomanPerUsd
            ? latestToman / liveTomanPerUsd
            : market.priceUsd,
        })
      );
    }
    for (const item of primaryItems)
      if (favoriteIds.includes(item.assetId)) map.set(item.assetId, item);
    return uniqueItems(
      favoriteIds
        .flatMap(id => (map.get(id) ? [map.get(id)!] : []))
        .filter(
          item =>
            !PINNED_SYMBOLS.includes(
              item.symbol as (typeof PINNED_SYMBOLS)[number]
            )
        )
    );
  }, [
    favoriteIds,
    favoriteMarkets.data,
    primaryItems,
    realtime.quotes,
    liveTomanPerUsd,
  ]);
  const items = useMemo(
    () =>
      uniqueItems(
        query
          ? ((search.data?.markets ?? []) as Quote[])
            .map(quote => {
              const liveQuote = realtime.quotes[quote.symbol];
              const latestToman = liveQuote?.latestToman ?? quote.latestToman;
              return itemFromQuote({
                ...quote,
                latestToman,
                priceUsd: liveTomanPerUsd
                  ? latestToman / liveTomanPerUsd
                  : quote.priceUsd,
              });
            })
            .sort(
              (a, b) =>
                Number(favoriteIds.includes(b.assetId)) -
                  Number(favoriteIds.includes(a.assetId)) ||
                a.symbol.localeCompare(b.symbol)
            )
            .filter(
              item =>
                !PINNED_SYMBOLS.includes(
                  item.symbol as (typeof PINNED_SYMBOLS)[number]
                )
            )
          : [
            ...favoriteMarketsItems,
            ...primaryItems.filter(
              item =>
                !favoriteIds.includes(item.assetId) &&
                !PINNED_SYMBOLS.includes(
                  item.symbol as (typeof PINNED_SYMBOLS)[number]
                )
            ),
          ]
      ),
    [
      query,
      search.data,
      favoriteIds,
      favoriteMarketsItems,
      primaryItems,
      realtime.quotes,
      liveTomanPerUsd,
    ]
  );
  const allSelectableItems = useMemo(
    () => uniqueItems([...pinnedItems, ...items]),
    [pinnedItems, items]
  );
  useEffect(() => setVisibleCount(MARKET_PAGE_SIZE), [query]);
  const visibleItems = useMemo(
    () => items.slice(0, visibleCount),
    [items, visibleCount]
  );
  const [leavingAssetIds, setLeavingAssetIds] = useState<ReadonlySet<string>>(() => new Set());
  const [enteringAssetIds, setEnteringAssetIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    setLeavingAssetIds(new Set());
    setEnteringAssetIds(new Set());
  }, [query]);
  const showMoreMarkets = () => {
    if (leavingAssetIds.size > 0) return;
    const nextVisibleCount = Math.min(items.length, visibleCount + MARKET_PAGE_SIZE);
    const enteringIds = new Set(items.slice(visibleCount, nextVisibleCount).map(item => item.assetId));
    if (!enteringIds.size) return;
    setEnteringAssetIds(enteringIds);
    setVisibleCount(nextVisibleCount);
    window.setTimeout(() => setEnteringAssetIds(new Set()), MARKET_PAGE_TRANSITION_MS + 80);
  };
  const showLessMarkets = () => {
    if (leavingAssetIds.size > 0) return;
    const nextVisibleCount = Math.max(MARKET_PAGE_SIZE, visibleCount - MARKET_PAGE_SIZE);
    const leavingIds = new Set(visibleItems.slice(nextVisibleCount).map(item => item.assetId));
    if (!leavingIds.size) {
      setVisibleCount(nextVisibleCount);
      return;
    }
    setEnteringAssetIds(new Set());
    setLeavingAssetIds(leavingIds);
    window.setTimeout(() => {
      setVisibleCount(nextVisibleCount);
      setLeavingAssetIds(new Set());
    }, MARKET_PAGE_TRANSITION_MS);
  };
  const canShowMore = visibleItems.length < items.length;
  const canShowLess = visibleItems.length > MARKET_PAGE_SIZE;
  useEffect(() => {
    if (
      selected &&
      selected !== "telegram-stars" &&
      allSelectableItems.length &&
      !allSelectableItems.some(item => item.assetId === selected)
    )
      setSelected(null);
  }, [allSelectableItems, selected]);
  const live = selected ? realtime.quotes[selected.toUpperCase()] : undefined;
  const activeItem = allSelectableItems.find(item => item.assetId === selected);
  const queriedDetail = asset.data as Detail | undefined;
  const detailBase =
    queriedDetail?.assetId === selected ? queriedDetail : activeItem?.detail;
  const detail = detailBase && {
    ...detailBase,
    latestToman: live?.latestToman ?? detailBase.latestToman,
    priceUsd:
      live?.latestToman && liveTomanPerUsd
        ? live.latestToman / liveTomanPerUsd
        : detailBase.priceUsd,
  };
  const liveLabel =
    realtime.status === "live"
      ? copy.live
      : realtime.status === "connecting" || realtime.status === "recovering"
        ? copy.connecting
        : copy.waiting;
  const macroMarkets = useMemo(() => {
    const normalized = macroTerm.trim().toLocaleLowerCase();
    const markets = ((macro.data?.markets ?? []) as MacroAsset[]).filter(market => {
      if (!normalized) return true;
      return `${market.symbol} ${market.name}`.toLocaleLowerCase().includes(normalized);
    });
    const ordered = [...markets].sort((left, right) => {
      const priority = ["usd", "eur", "gbp", "sar", "omr", "qar", "aed", "kwd", "bhd", "jod", "yer", "gold", "gold18", "silver", "copper", "platinum", "palladium"];
      const leftIndex = priority.indexOf(left.id);
      const rightIndex = priority.indexOf(right.id);
      return (leftIndex < 0 ? priority.length : leftIndex) - (rightIndex < 0 ? priority.length : rightIndex) || left.name.localeCompare(right.name, "fa");
    });
    return ordered.slice(0, macroVisibleCount);
  }, [macro.data, macroTerm, macroVisibleCount]);
  useEffect(() => setMacroVisibleCount(MARKET_PAGE_SIZE), [macroTerm]);

  const refresh = () => {
    void primary.refetch();
    void stars.refetch();
    void macro.refetch();
    void favorites.refetch();
    if (query) void search.refetch();
    if (selected && selected !== "telegram-stars") void asset.refetch();
  };

  return (
    <section
      className="space-y-5"
      dir={locale === "fa" || locale === "ar" ? "rtl" : "ltr"}
      aria-label={copy.title}
    >
      <Card className="kronos-card border-cyan-300/15 bg-[linear-gradient(135deg,rgba(8,47,73,.48),rgba(15,23,42,.86)_46%,rgba(49,46,129,.25))]">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-cyan-200" />
                <span className="text-[10px] font-black tracking-[.18em] text-cyan-200/75">
                  {copy.eyebrow}
                </span>
              </div>
              <h2 className="text-xl font-black text-white">{copy.title}</h2>
              <p className="mt-2 text-sm text-slate-300">{copy.subtitle}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[10px] font-black text-emerald-200">
              <Radio className="h-3 w-3" />
              {liveLabel}
            </span>
          </div>
        </CardContent>
      </Card>
      <Card className="kronos-card overflow-hidden border-amber-200/20 bg-amber-300/[.055]">
        <CardContent className="p-0">
          <button
            type="button"
            onClick={() =>
              setSelected(
                selected === "telegram-stars" ? null : "telegram-stars"
              )
            }
            className="flex w-full items-center justify-between gap-3 p-4 text-right"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-full border border-amber-200/25 bg-amber-300/[.1]">
                <Star className="h-5 w-5 fill-amber-200 text-amber-200" />
              </span>
              <div>
                <p className="font-black text-white">{copy.starsTitle}</p>
                <p className="mt-1 text-[10px] text-amber-100/65">
                  <b dir="ltr">
                    {usd(
                      (stars.data as StarsRate | undefined)?.starUsdReference
                    )}{" "}
                    ·{" "}
                    {toman(
                      (stars.data as StarsRate | undefined)?.starTomanReference,
                      copy.toman
                    )}
                  </b>
                </p>
              </div>
            </div>
            {selected === "telegram-stars" ? (
              <ChevronUp className="h-5 w-5 text-amber-200" />
            ) : (
              <ChevronDown className="h-5 w-5 text-amber-200" />
            )}
          </button>
          {selected === "telegram-stars" && (
            <StarsCalculator
              locale={locale}
              rate={stars.data as StarsRate | undefined}
            />
          )}
        </CardContent>
      </Card>
      <div className="space-y-3">
        {pinnedItems.map(item => (
          <MarketCard
            key={item.assetId}
            item={item}
            selected={selected}
            setSelected={setSelected}
            locale={locale}
            live={
              selected === item.assetId
                ? realtime.quotes[item.symbol]
                : undefined
            }
            detail={selected === item.assetId ? detail : item.detail}
            range={range}
            setRange={setRange}
            loading={asset.isFetching}
            failed={Boolean(asset.error)}
            refresh={() => void asset.refetch()}
            pinned
          />
        ))}
      </div>
      <Card
        className="kronos-card border-violet-200/15 bg-violet-300/[.035]"
        data-testid="macro-market-board"
      >
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-black text-white">
                {locale === "fa"
                  ? "ارزهای جهانی و فلزات"
                  : locale === "ar"
                    ? "العملات العالمية والمعادن"
                    : "Global currencies & metals"}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {locale === "fa"
                  ? "نرخ زندهٔ بازار ایران و مرجع جهانی به تومان و دلار"
                  : locale === "ar"
                    ? "أسعار السوق الإيرانية والمرجع العالمي بالتومان والدولار"
                    : "Iran market and global reference rates in toman and USD"}
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => void macro.refetch()}
              aria-label={copy.refreshList}
              className="border-white/10 bg-white/[.035] text-violet-100"
            >
              <RefreshCw
                className={`h-4 w-4 ${macro.isFetching ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-violet-200/50" />
            <Input
              value={macroTerm}
              onChange={event => setMacroTerm(event.target.value)}
              placeholder={locale === "fa" ? "جست‌وجوی دلار، طلا، نقره، مس یا نماد…" : "Search USD, gold, silver, copper or a symbol…"}
              aria-label={locale === "fa" ? "جست‌وجوی ارزهای جهانی و فلزات" : "Search global currencies and metals"}
              className="border-white/10 bg-slate-950/35 pr-10 text-white placeholder:text-slate-500"
              dir={locale === "fa" ? "rtl" : "ltr"}
            />
          </div>
          {macro.isLoading ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Skeleton className="h-16 rounded-xl bg-white/5" />
              <Skeleton className="h-16 rounded-xl bg-white/5" />
            </div>
          ) : !macro.data?.markets?.length ? (
            <p className="mt-4 rounded-xl border border-amber-200/10 bg-amber-300/[.04] p-3 text-sm text-slate-400">
              {locale === "fa"
                ? "نرخ‌ها موقتاً در دسترس نیستند."
                : locale === "ar"
                  ? "الأسعار غير متاحة مؤقتاً."
                  : "Rates are temporarily unavailable."}
            </p>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {macroMarkets.map(market => (
                <div
                  key={market.id}
                  className="overflow-hidden rounded-xl border border-white/8 bg-slate-950/30"
                >
                  <button type="button" onClick={() => setSelectedMacroId(current => current === market.id ? null : market.id)} className="w-full p-3 text-right" aria-expanded={selectedMacroId === market.id}>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-black text-white">{locale === "fa" ? `${market.symbol} (${market.name})` : market.symbol}</p>
                        <p className="mt-1 text-[10px] text-slate-500">{market.category === "metal" ? (locale === "fa" ? `فلز · ${market.quoteUnit ?? "نرخ مرجع"}` : `Metal · ${market.quoteUnit ?? "reference"}`) : market.symbol}</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[9px] font-bold ${market.isStale ? "bg-amber-300/10 text-amber-200" : "bg-emerald-300/10 text-emerald-200"}`}>
                        {market.isStale ? (locale === "fa" ? "قدیمی" : locale === "ar" ? "قديم" : "Stale") : market.source === "global-fx" ? (locale === "fa" ? "مرجع روزانه" : locale === "ar" ? "مرجع يومي" : "Daily reference") : market.category === "metal" ? (locale === "fa" ? "مرجع جهانی" : "Global reference") : copy.live}
                      </span>
                    </div>
                    <p dir="ltr" className="mt-3 text-lg font-black text-violet-100">{toman(market.latestToman, copy.toman)}</p>
                    {market.iranGramOnly ? <p className="mt-1 text-xs font-bold text-amber-100/90">{locale === "fa" ? "نرخ هر گرم بازار ایران" : "Iran market rate per gram"}</p> : <p dir="ltr" className="mt-1 text-xs font-bold text-violet-100/80">{usd(market.priceUsd)}</p>}
                    {market.priceUsdPerGram !== null && market.priceUsdPerGram !== undefined && market.tomanPerGram !== null && market.tomanPerGram !== undefined && !market.iranGramOnly ? <p dir="ltr" className="mt-2 rounded-lg border border-amber-200/15 bg-amber-300/[.055] px-2 py-1 text-[11px] font-black text-amber-100">{locale === "fa" ? "هر گرم: " : "Per gram: "}{usd(market.priceUsdPerGram)} · {toman(market.tomanPerGram, copy.toman)}</p> : null}
                    <div className="mt-1 flex gap-3 text-[10px] text-slate-500" dir="ltr"><span>Buy: {toman(market.buyToman, copy.toman)}</span><span>Sell: {toman(market.sellToman, copy.toman)}</span></div>
                  </button>
                  {selectedMacroId === market.id && <div data-testid="macro-detail-panel" className="border-t border-violet-200/10 bg-violet-300/[.035] p-3">{market.iranGramOnly ? <><Stat label={locale === "fa" ? "قیمت هر گرم بازار ایران" : "Iran market price per gram"} value={toman(market.latestToman, copy.toman)} tone="text-amber-100" />{market.gradeQuotes?.length ? <div className="mt-3 rounded-xl border border-amber-200/10 bg-amber-200/[.035] p-3"><p className="text-xs font-black text-amber-100">{locale === "fa" ? "انواع و عیارها" : "Types and purities"}</p><div className="mt-2 space-y-1.5">{market.gradeQuotes.map(quote => <div key={quote.label} className="flex items-center justify-between gap-3 text-[11px]"><span className="font-bold text-slate-300">{quote.label}</span><span dir="ltr" className="font-black text-amber-100">{toman(quote.latestToman, copy.toman)}</span></div>)}</div></div> : null}<p className="mt-3 text-[10px] leading-5 text-slate-400">{locale === "fa" ? "نرخ هر گرم بازار ایران." : "Iran market price per gram."}</p></> : <><div className="grid grid-cols-2 gap-2"><Stat label={locale === "fa" ? `قیمت دلار${market.quoteUnit ? ` (${market.quoteUnit})` : ""}` : "USD price"} value={usd(market.priceUsd)} tone="text-violet-100" /><Stat label={locale === "fa" ? `معادل تومان${market.quoteUnit ? ` (${market.quoteUnit})` : ""}` : "Toman equivalent"} value={toman(market.latestToman, copy.toman)} tone="text-violet-100" /></div>{market.priceUsdPerGram !== null && market.priceUsdPerGram !== undefined && market.tomanPerGram !== null && market.tomanPerGram !== undefined ? <div className="mt-2 grid grid-cols-2 gap-2"><Stat label={locale === "fa" ? "هر گرم (دلار)" : "Per gram (USD)"} value={usd(market.priceUsdPerGram)} tone="text-amber-100" /><Stat label={locale === "fa" ? "هر گرم (تومان)" : "Per gram (Toman)"} value={toman(market.tomanPerGram, copy.toman)} tone="text-amber-100" /></div> : null}<p className="mt-3 text-[10px] leading-5 text-slate-400">{market.category === "metal" ? (locale === "fa" ? `نرخ مرجع جهانی ${market.quoteUnit ?? ""} با تبدیل دلار ایران؛ نمودار و حجم یکپارچه برای این مرجع عمومی در دسترس نیست.` : "Global metal reference converted with Iran USD; an integrated chart and volume are not available for this public reference.") : (market.source === "global-fx" ? (locale === "fa" ? "نرخ از مرجع جهانی و دلار ایران محاسبه شده است؛ نرخ صرافی یا بازار نقدی داخلی می‌تواند متفاوت باشد." : "Calculated from global reference and Iran USD; local cash or exchange rates can differ.") : (locale === "fa" ? "نرخ بازار ایران؛ جزئیات خرید و فروش در کارت نمایش داده شده است." : "Iran market rate; buy and sell details appear on this card."))}</p></>}</div>}
                </div>
              ))}
            </div>
          )}
          {!macro.isLoading && macro.data?.markets?.length ? (
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-500">
                {macroTerm ? `${macroMarkets.length} / ${macro.data.markets.length}` : `${Math.min(macroVisibleCount, macro.data.markets.length)} / ${macro.data.markets.length}`}
              </span>
              <div className="flex gap-2">
                {macroVisibleCount > MARKET_PAGE_SIZE && !macroTerm && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setMacroVisibleCount(Math.max(MARKET_PAGE_SIZE, macroVisibleCount - MARKET_PAGE_SIZE))} className="border-white/10 bg-white/[.035] text-violet-100">
                    {locale === "fa" ? "۸ ارز کمتر" : "Show 8 less"}
                  </Button>
                )}
                {macroVisibleCount < (macro.data.markets.length ?? 0) && !macroTerm && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setMacroVisibleCount(count => count + MARKET_PAGE_SIZE)} className="border-violet-200/20 bg-violet-300/[.07] text-violet-100">
                    {locale === "fa" ? "۸ ارز بیشتر" : "Show 8 more"}
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card className="kronos-card overflow-hidden border-white/10 bg-slate-950/35">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-black text-white">
                {query ? copy.searchResults : copy.coreAssets}
              </h3>
              <p className="mt-1 text-xs text-slate-500">{copy.expandHint}</p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={refresh}
              aria-label={copy.refreshList}
              className="border-white/10 bg-white/[.035] text-cyan-100"
            >
              <RefreshCw
                className={`h-4 w-4 ${primary.isFetching || search.isFetching || asset.isFetching ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={term}
              onChange={event => setTerm(event.target.value)}
              placeholder={copy.searchPlaceholder}
              className="h-11 border-white/10 bg-slate-950/35 pr-10 text-white placeholder:text-slate-500"
            />
          </div>
          {query && (
            <div className="mt-3 flex justify-between rounded-xl border border-cyan-300/10 bg-cyan-300/[.04] px-3 py-2 text-xs text-cyan-100">
              <span>{copy.activeSearch}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setTerm("")}
                className="h-7 px-2 text-cyan-100"
              >
                {copy.clearSearch}
              </Button>
            </div>
          )}
          {!query && favoriteMarketsItems.length > 0 && (
            <div className="mt-5 flex items-center gap-2 text-sm font-black text-amber-100">
              <Star className="h-4 w-4 fill-amber-200" />
              {copy.favorites}
            </div>
          )}
          <div className="mt-3 space-y-2">
            {(primary.isLoading && !query) || (query && search.isLoading) ? (
              Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-20 rounded-xl bg-white/5" />
              ))
            ) : (primary.error && !query) || (query && search.error) ? (
              <div role="alert" className="rounded-xl border border-amber-200/15 bg-amber-300/[.045] p-4 text-center text-sm text-amber-100">
                <p>{copy.recoveringMarket}</p>
                <Button type="button" size="sm" variant="outline" onClick={refresh} className="mt-3 border-amber-200/25 text-amber-100">
                  <RefreshCw className="me-1.5 h-3.5 w-3.5" />
                  {copy.refreshList}
                </Button>
              </div>
            ) : !items.length ? (
              <p className="rounded-xl border border-white/8 p-5 text-center text-sm text-slate-400">
                {copy.notFound}
              </p>
            ) : (
              visibleItems.map((item, index) => {
                const favorite = favoriteIds.includes(item.assetId);
                const active = selected === item.assetId;
                const listLive = active
                  ? realtime.quotes[item.symbol]
                  : undefined;
                const header =
                  !query &&
                  favoriteMarketsItems.length > 0 &&
                  index === favoriteMarketsItems.length;
                return (
                  <React.Fragment key={item.assetId}>
                    {header && (
                      <div className="px-1 pt-3 text-[10px] font-bold text-amber-100/75">
                        {copy.coreAssets}
                      </div>
                    )}
                    <div
                      className={`overflow-hidden rounded-2xl border border-white/8 bg-slate-950/20 ${enteringAssetIds.has(item.assetId) ? "market-card-enter" : ""} ${leavingAssetIds.has(item.assetId) ? "market-card-leave" : ""}`}
                      style={enteringAssetIds.has(item.assetId) ? { animationDelay: `${Math.min(Math.max(index - (visibleCount - MARKET_PAGE_SIZE), 0), MARKET_PAGE_SIZE - 1) * 68}ms` } : undefined}
                    >
                      <div
                        className={`flex ${active ? "bg-cyan-300/[.055]" : ""}`}
                      >
                        <button
                          type="button"
                          data-testid={`market-card-${item.assetId}`}
                          aria-expanded={active}
                          onClick={() =>
                            setSelected(active ? null : item.assetId)
                          }
                          className="flex min-w-0 flex-1 items-center justify-between gap-3 p-3 text-right sm:p-4"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-black text-white">
                                {displayName(item.symbol, locale)}
                              </p>
                              <span
                                dir="ltr"
                                className="text-[10px] font-bold tracking-[.13em] text-slate-500"
                              >
                                {item.market}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
                              <div>
                                <p
                                  dir="ltr"
                                  className="text-lg font-black text-cyan-100"
                                >
                                  {usd(item.priceUsd)}
                                </p>
                                <p
                                  dir="ltr"
                                  className="mt-0.5 text-[11px] font-bold text-cyan-100/60"
                                >
                                  {toman(
                                    (listLive ?? item).latestToman,
                                    copy.toman
                                  )}
                                </p>
                              </div>
                              <span
                                dir="ltr"
                                className={
                                  (listLive ?? item).dayChangePercent >= 0
                                    ? "text-[11px] font-black text-emerald-300"
                                    : "text-[11px] font-black text-rose-300"
                                }
                              >
                                {(listLive ?? item).dayChangePercent >= 0
                                  ? "+"
                                  : ""}
                                {(listLive ?? item).dayChangePercent.toFixed(2)}
                                %
                              </span>
                            </div>
                          </div>
                          {active ? (
                            <ChevronUp className="h-5 w-5 text-cyan-200" />
                          ) : (
                            <ChevronDown className="h-5 w-5 text-slate-500" />
                          )}
                        </button>
                        <button
                          type="button"
                          aria-label={
                            favorite ? copy.removeFavorite : copy.addFavorite
                          }
                          aria-pressed={favorite}
                          onClick={event => {
                            event.stopPropagation();
                            if (!setFavorite.isPending)
                              setFavorite.mutate({
                                assetId: item.assetId,
                                enabled: !favorite,
                              });
                          }}
                          className="grid w-12 place-items-center border-r border-white/8 text-slate-500 hover:bg-amber-300/[.08] hover:text-amber-100"
                        >
                          <Star
                            className={`h-5 w-5 ${favorite ? "fill-amber-200 text-amber-200" : ""}`}
                          />
                        </button>
                      </div>
                      {active && (
                        <DetailPanel
                          detail={detail}
                          live={listLive}
                          range={range}
                          setRange={setRange}
                          locale={locale}
                          loading={asset.isFetching}
                          failed={Boolean(asset.error)}
                          refresh={() => void asset.refetch()}
                        />
                      )}
                    </div>
                  </React.Fragment>
                );
              })
            )}
            {(canShowMore || canShowLess) && (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-3">
                {canShowLess && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={showLessMarkets}
                    disabled={leavingAssetIds.size > 0}
                    className="border-slate-300/15 bg-white/[.035] px-5 text-slate-200 hover:bg-white/[.08]"
                  >
                    {copy.loadLessMarkets}
                  </Button>
                )}
                {canShowMore && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={showMoreMarkets}
                    className="border-cyan-200/20 bg-cyan-300/[.06] px-5 text-cyan-100 hover:bg-cyan-300/[.12]"
                  >
                    {copy.loadMoreMarkets}
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
