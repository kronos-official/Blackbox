# Mini App Runtime Validation

The `/dashboard` route was checked on 2026-08-14 from a non-Telegram browser context. It correctly stopped at the secure entry gate with the message that the Telegram connection was not available. This is expected: the dashboard requires signed Telegram Web App `initData` and does not grant a fallback browser session.

Final interaction validation must be performed by opening the Mini App from the Kronos Guard bot in Telegram. The required checks are: a non-owner user’s forced-join verification, a group administrator’s content-lock toggle, an ordinary user’s Stars checkout, and the owner’s payment overview.

The connected browser did not expose an interactive Telegram Web session at `https://web.telegram.org/k/`. No account action, message, or payment was attempted. The remaining checks must be run from Telegram’s Mini App launch surface.
