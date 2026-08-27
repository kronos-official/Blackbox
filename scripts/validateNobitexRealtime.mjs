import { Centrifuge } from "centrifuge";

const endpoint = "wss://ws.nobitex.ir/connection/websocket";
const channel = "public:market-stats-all";
const client = new Centrifuge(endpoint, {});
const subscription = client.newSubscription(channel, { delta: "fossil" });

const timeout = setTimeout(() => finish(1, { status: "timeout", connected: false }), 20_000);

function finish(code, payload) {
  clearTimeout(timeout);
  subscription.unsubscribe();
  subscription.removeAllListeners();
  client.disconnect();
  console.log(JSON.stringify(payload));
  process.exit(code);
}

client.on("connected", () => {
  subscription.subscribe();
});
client.on("error", context => finish(1, { status: "error", type: context.type ?? "unknown" }));
subscription.on("publication", context => {
  const data = context.data;
  const markets = data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data).filter(key => key.endsWith("-rls")) : [];
  finish(markets.length ? 0 : 1, { status: markets.length ? "ok" : "invalid-payload", connected: true, rialMarketCount: markets.length, hasUsdt: markets.includes("usdt-rls"), hasBtc: markets.includes("btc-rls") });
});

client.connect();
