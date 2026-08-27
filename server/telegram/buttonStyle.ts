/** Telegram's predefined button background styles. */
export type TelegramButtonStyle = "primary" | "success" | "danger";

type StyleableButton = { text: string };

/**
 * Adds Telegram's optional button style without changing the underlying
 * callback, URL, or request-peer payload. Telegraf 4.16 types predate this
 * Bot API field, so the compatibility cast is intentionally isolated here.
 */
export function withTelegramButtonStyle<T extends StyleableButton>(button: T, style: TelegramButtonStyle): T & { style: TelegramButtonStyle } {
  return { ...(button as object), style } as T & { style: TelegramButtonStyle };
}
