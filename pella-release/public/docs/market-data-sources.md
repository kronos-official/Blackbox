# Market Data Source Notes

## Historical-chart coverage assessment — 2026-08-21

The market panel keeps a no-synthetic-data policy. Chart points may only be rendered when returned by a public market-data source.

| Source | Free access confirmed | Suitable chart coverage | Operational notes |
| --- | --- | --- | --- |
| CoinGecko market chart | Keyless/demo endpoint documented | Coin IDs supported by CoinGecko; 1-day data is 5-minute, 2–90-day data is hourly when available | Existing primary source; can fail temporarily because of free-tier throttling. |
| CoinPaprika historical tickers | Public free base URL without API key documented | Any CoinPaprika ID with recorded price history; free plan supports hourly data for the past day and daily data for up to one year | Add as the general historical fallback after CoinGecko and before showing an unavailable state. API updates every five minutes. |
| Kraken OHLC | Existing public fallback | Only assets and markets listed by Kraken | Keep as a low-latency exchange fallback for mapped symbols. |

The universal source sequence should be CoinGecko → CoinPaprika historical tickers → Kraken where mapped. If an asset has no history at any source (e.g., newly listed/untracked token), the UI must explicitly state that the source has no real historical data instead of fabricating a chart.

## Sources

- CoinPaprika, historical tickers documentation: https://docs.coinpaprika.com/api-reference/tickers/get-historical-ticks-for-a-specific-coin
- CoinPaprika, list coins documentation: https://docs.coinpaprika.com/api-reference/coins/list-coins
- CoinGecko, historical chart by ID documentation: https://docs.coingecko.com/reference/coins-id-market-chart
- CoinGecko, demo/keyless endpoint overview: https://docs.coingecko.com/demo/reference/endpoint-overview
