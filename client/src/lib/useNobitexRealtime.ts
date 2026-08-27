import { useEffect, useRef, useState } from "react";
import { Centrifuge } from "centrifuge";

const REALTIME_URL = "wss://ws.nobitex.ir/connection/websocket";
const STATS_CHANNEL = "public:market-stats-all";
const IRR_PER_TOMAN = 10;

export type LiveMarketQuote = { symbol: string; latestToman: number; bestBuyToman: number; bestSellToman: number; dayChangePercent: number; updatedAt: string };
export type RealtimeStatus = "connecting" | "live" | "recovering" | "offline";

function finite(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseStatsPublication(data: unknown) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [] as LiveMarketQuote[];
  return Object.entries(data as Record<string, unknown>).flatMap(([marketId, raw]) => {
    if (!marketId.endsWith("-rls") || !raw || typeof raw !== "object") return [];
    const stats = raw as Record<string, unknown>;
    if (stats.isClosed === true) return [];
    const latest = finite(stats.latest);
    const bestBuy = finite(stats.bestBuy);
    const bestSell = finite(stats.bestSell);
    const dayChange = finite(stats.dayChange);
    if (latest === null || bestBuy === null || bestSell === null || dayChange === null || latest <= 0 || bestBuy <= 0 || bestSell <= 0) return [];
    return [{ symbol: marketId.slice(0, -4).toUpperCase(), latestToman: latest / IRR_PER_TOMAN, bestBuyToman: bestBuy / IRR_PER_TOMAN, bestSellToman: bestSell / IRR_PER_TOMAN, dayChangePercent: dayChange, updatedAt: new Date().toISOString() }];
  });
}

export function useNobitexRealtime(enabled = true) {
  const [status, setStatus] = useState<RealtimeStatus>(enabled ? "connecting" : "offline");
  const [quotes, setQuotes] = useState<Record<string, LiveMarketQuote>>({});
  const latestStatus = useRef<RealtimeStatus>(status);

  useEffect(() => { latestStatus.current = status; }, [status]);
  useEffect(() => {
    if (!enabled) { setStatus("offline"); return; }
    const client = new Centrifuge(REALTIME_URL, {});
    const subscription = client.newSubscription(STATS_CHANNEL, { delta: "fossil" });
    client.on("connecting", () => setStatus(latestStatus.current === "live" ? "recovering" : "connecting"));
    client.on("connected", () => setStatus("live"));
    client.on("disconnected", () => setStatus("offline"));
    subscription.on("publication", context => {
      const updates = parseStatsPublication(context.data);
      if (!updates.length) return;
      setQuotes(previous => {
        const next = { ...previous };
        updates.forEach(quote => { next[quote.symbol] = quote; });
        return next;
      });
    });
    subscription.subscribe();
    client.connect();
    return () => {
      subscription.unsubscribe();
      subscription.removeAllListeners();
      client.disconnect();
    };
  }, [enabled]);

  return { quotes, status };
}
