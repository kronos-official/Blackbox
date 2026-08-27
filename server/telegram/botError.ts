import { hasMissingReplyTarget, isMessageNotModified } from "./replySafe";

export type BotHandlerErrorKind = "expected_telegram_edge_case" | "transient_telegram_error" | "unexpected_handler_error";

export function describeTelegramError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as { response?: { description?: unknown; error_code?: unknown }; description?: unknown; message?: unknown };
    if (typeof candidate.response?.description === "string") return candidate.response.description;
    if (typeof candidate.description === "string") return candidate.description;
    if (typeof candidate.message === "string") return candidate.message;
    try {
      return JSON.stringify(error);
    } catch {
      return "unknown Telegram handler error";
    }
  }
  return "unknown Telegram handler error";
}

export function classifyBotHandlerError(error: unknown): BotHandlerErrorKind {
  if (hasMissingReplyTarget(error) || isMessageNotModified(error)) return "expected_telegram_edge_case";
  const description = describeTelegramError(error).toLowerCase();
  const responseCode = typeof error === "object" && error !== null && "response" in error
    ? Number((error as { response?: { error_code?: unknown } }).response?.error_code ?? 0)
    : 0;
  if (
    responseCode === 429 ||
    responseCode >= 500 ||
    /request timed out|timeout|socket hang up|econnreset|etimedout|network error|fetch failed|temporarily unavailable|gateway timeout/.test(description)
  ) {
    return "transient_telegram_error";
  }
  return "unexpected_handler_error";
}

export function buildBotHandlerErrorDetails(error: unknown, context: { updateId?: number; updateType?: string; chatId?: number; actorTelegramId?: number }) {
  return {
    ...context,
    kind: classifyBotHandlerError(error),
    message: describeTelegramError(error),
  };
}
