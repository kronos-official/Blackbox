# Premium Emoji Source Notes

## User-provided Telegram emoji packs

| Pack | URL | Observable metadata | Intended review role |
|---|---|---|---|
| gothdominko_by_fStikBot | https://t.me/addemoji/gothdominko_by_fStikBot | Telegram identifies this as the `𓆩 ♱ goth : @qwdomino 𓆪` emoji set. The public web page only exposes the set title and an Add Emoji action, not individual custom emoji IDs. | Dark/gothic decorative accents only; not a default semantic UI set. |

## Selected semantic sources

The verified semantic registry used by Kronos Guard is curated from the owner-provided `NewsEmoji`, `Proxy_PJ10`, `Ndklskjwvw_by_TgEmojis_bot`, and `SoLo_HaMiD` packs. The machine-readable inspection output and source URLs are preserved in `premium-emoji-pack-inventory.json` and `premium-emoji-pack-audit.tsv`.

## Integration contract

Telegram custom emoji are sent through message entities or valid custom emoji identifiers. The bot applies the verified registry only to safe HTML-capable message and caption APIs. Every entity retains its Unicode glyph as a visible fallback, so the intent remains understandable when a client does not render the Premium asset.

Inline and reply keyboard labels intentionally retain standard Unicode emoji. Telegram's Bot API treats button labels as plain text and does not provide message entities for individual buttons; attempting to insert custom-emoji markup in them would display raw markup or fail to render. This is a Telegram platform limitation rather than a Kronos Guard visual exception.

## Verified delivery eligibility — 18 August 2026

Telegram's official Bot API documentation states that custom emoji entities can only be used by bots that have purchased additional usernames on Fragment **or** in messages sent directly by a bot whose owner has an active Telegram Premium subscription. Source: [Telegram Bot API — Formatting options](https://core.telegram.org/bots/api#formatting-options).

An API-level probe was sent to the approved test group using an identifier returned by `getCustomEmojiStickers`. Telegram accepted the message but returned no `custom_emoji` entity in the resulting message payload; it retained only the standard fallback glyph. This confirms that the current bot is not yet eligible to emit Premium custom emoji entities, even though the selected sticker identifiers are valid.

Until eligibility is active, the bot must use the paired Unicode fallbacks rather than injecting `<tg-emoji>` markup. Once the owning Telegram account has Premium or the bot acquires the eligible Fragment feature, re-run the probe and enable the registry.
