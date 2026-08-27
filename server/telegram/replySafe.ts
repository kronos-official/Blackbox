import type { Context } from "telegraf";

type ReplyOptions = Parameters<Context["reply"]>[1];

function isMissingReplyTarget(error: unknown) {
  const candidate = error as { response?: { error_code?: number; description?: string }; message?: string };
  const description = candidate.response?.description ?? candidate.message ?? "";
  return candidate.response?.error_code === 400 && /message to be replied not found|target not specified|reply target/i.test(description);
}

/**
 * Prefer a threaded Telegram reply, but never lose the acknowledgement when
 * Telegram no longer exposes the source message (anonymous-admin and race
 * conditions can make reply_parameters invalid by the time the bot responds).
 */
export async function replySafely(ctx: Context, text: string, options?: ReplyOptions) {
  try {
    return await ctx.reply(text, options);
  } catch (error) {
    if (!isMissingReplyTarget(error) || !options || !("reply_parameters" in options)) throw error;
    const { reply_parameters: _replyParameters, ...fallbackOptions } = options;
    console.warn("[Kronos Guard] Reply target unavailable; sending a standalone acknowledgement");
    return ctx.reply(text, fallbackOptions);
  }
}

export function hasMissingReplyTarget(error: unknown) {
  return isMissingReplyTarget(error);
}

/** Telegram returns this deterministic 400 when an edit produces no state change. */
export function isMessageNotModified(error: unknown) {
  const candidate = error as { response?: { error_code?: number; description?: string }; message?: string };
  const description = candidate.response?.description ?? candidate.message ?? "";
  return candidate.response?.error_code === 400 && /message is not modified/i.test(description);
}

type TelegramEditableMessage = { text?: string; caption?: string; reply_markup?: unknown };

/** Return false when Telegram would reject the edit because no observable state changes. */
export function shouldEditTelegramMessage(message: TelegramEditableMessage | undefined, nextText: string, nextReplyMarkup?: unknown) {
  if (!message) return true;
  const currentText = message.text ?? message.caption ?? "";
  const currentMarkup = message.reply_markup ?? null;
  return currentText !== nextText || JSON.stringify(currentMarkup) !== JSON.stringify(nextReplyMarkup ?? null);
}
