# Telegram Stars Payment Design Sources

Kronos Guard treats a paid forced-join placement as a digital service. The implementation must issue an `XTR` invoice, answer a valid `pre_checkout_query` within ten seconds, and activate a paid channel only after receiving `successful_payment`. Each successful payment must retain the Telegram charge ID so fulfilment remains idempotent and future refund handling is possible.

The order screen must not claim that a bot can read a user’s Telegram Stars balance. Telegram presents the Stars checkout UI and payment confirmation; the application will instead show the calculated amount due before launching the invoice.

## References

1. [Telegram, Bot Payments API for Digital Goods and Services](https://core.telegram.org/bots/payments-stars)
2. [Telegram, Bot Payments API](https://core.telegram.org/bots/payments)
3. [Telegram, Bot API](https://core.telegram.org/bots/api)
