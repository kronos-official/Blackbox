# Telegram button style findings

## Verified behavior

Telegram’s official Bot buttons documentation describes a `KeyboardButtonStyle` with three predefined background styles: `bg_primary` for dark blue, `bg_danger` for red, and `bg_success` for green. If no background flag is set, the client uses the default neutral appearance. The documentation also states that clients may adapt the colors to the current theme and that only one background style should be selected at a time.

The current Telegraf 4.16.3 documentation for `Markup.inlineKeyboard` documents keyboard construction but does not expose a typed `style` field in the public builder reference. Therefore, the project must verify the installed `telegraf/types` declarations before relying on a direct `style: "primary" | "success" | "danger"` property. If the installed types lag the Telegram API, the implementation should use a narrow compatibility type or upgrade only if safe; it must not silently send unsupported fields through an untyped path without regression coverage.

## Sources

1. Telegram, “Bot buttons”: https://core.telegram.org/api/bots/buttons
2. python-telegram-bot issue #5136, “Support for new Telegram Bot API button styles”: https://github.com/python-telegram-bot/python-telegram-bot/issues/5136
3. Telegraf 4.16.3, `Markup.inlineKeyboard`: https://telegraf.js.org/functions/Markup.inlineKeyboard.html
