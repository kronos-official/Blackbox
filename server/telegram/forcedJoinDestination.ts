import { withTelegramRetry } from "./retry";
import { normalizeForcedJoinChannelChatId } from "./forcedJoinManager";
import { parseEntityReference } from "./entityResolver";

type DestinationTelegramApi = {
  getMe: () => Promise<{ id: number }>;
  getChat: (chatId: number) => Promise<unknown>;
  getChatMember: (chatId: number, userId: number) => Promise<{ status: string }>;
};

type DestinationReferenceTelegramApi = DestinationTelegramApi & {
  getChat: (chatId: number | string) => Promise<unknown>;
};

type ForcedJoinTelegramChat = {
  id?: unknown;
  title?: unknown;
  username?: unknown;
  type?: unknown;
};

export type ResolvedForcedJoinDestination = {
  channelChatId: number;
  title: string | null;
  username: string | null;
};

/**
 * Resolves the public forms an administrator can paste into a forced-join form.
 * Telegram cannot resolve private invite links through the Bot API, so those still
 * require the canonical -100… ID after the bot has been made an administrator.
 */
export async function resolveForcedJoinDestinationReference(
  telegram: DestinationReferenceTelegramApi,
  rawReference: string,
): Promise<ResolvedForcedJoinDestination> {
  const normalizedRawReference = rawReference.trim().replace(/^(?:www\.)?t\.me\//i, "https://t.me/");
  const reference = parseEntityReference(normalizedRawReference, "channel");
  if (!reference) throw new Error("invalid_forced_join_reference");

  const numericChatId = normalizeForcedJoinChannelChatId(reference.normalized);
  const lookupReference = numericChatId ?? `@${reference.normalized}`;
  const chat = await withTelegramRetry(() => telegram.getChat(lookupReference)) as ForcedJoinTelegramChat;
  const channelChatId = normalizeForcedJoinChannelChatId(chat.id as number | string);
  if (channelChatId === null) throw new Error("invalid_forced_join_destination_type");
  if (chat.type !== "channel" && chat.type !== "supergroup") throw new Error("invalid_forced_join_destination_type");

  const title = typeof chat.title === "string" ? chat.title.trim().slice(0, 512) || null : null;
  const username = typeof chat.username === "string" ? chat.username.trim().replace(/^@/, "") || null : null;
  return { channelChatId, title, username };
}

export async function verifyForcedJoinDestination(telegram: DestinationTelegramApi, channelChatId: number): Promise<{ title: string | null }> {
  const me = await withTelegramRetry(() => telegram.getMe());
  const [channel, botMembership] = await Promise.all([
    withTelegramRetry(() => telegram.getChat(channelChatId)),
    withTelegramRetry(() => telegram.getChatMember(channelChatId, me.id)),
  ]);

  if (botMembership.status !== "administrator" && botMembership.status !== "creator" && botMembership.status !== "owner") {
    throw new Error("bot_is_not_administrator");
  }

  const title = typeof channel === "object" && channel !== null && "title" in channel && typeof channel.title === "string"
    ? channel.title.trim().slice(0, 512)
    : null;
  return { title: title || null };
}

export function forcedJoinDestinationErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw.toLowerCase();

  if (normalized.includes("invalid_forced_join_reference")) {
    return "مقصد را با لینک عمومی t.me، یوزرنیم @ یا شناسهٔ عددی ‎-100…‎ وارد کنید. لینک‌های دعوت خصوصی قابل تبدیل خودکار نیستند.";
  }
  if (normalized.includes("invalid_forced_join_destination_type")) {
    return "مقصد باید یک کانال یا سوپرگروه Telegram باشد؛ گفت‌وگوی خصوصی و سایر انواع مقصد پشتیبانی نمی‌شوند.";
  }
  if (normalized.includes("chat not found") || normalized.includes("peer_id_invalid")) {
    return "این مقصد در تلگرام پیدا نشد؛ لینک عمومی، یوزرنیم یا شناسهٔ عددی ‎-100…‎ را بررسی کنید.";
  }
  if (normalized.includes("bot_is_not_administrator") || normalized.includes("not enough rights") || normalized.includes("not a member") || normalized.includes("participant_id_invalid") || normalized.includes("user not found") || normalized.includes("member list is inaccessible")) {
    return "ربات باید در مقصد عضو و مدیر باشد تا بتواند عضویت کاربران را بررسی کند. ابتدا ربات را به مقصد اضافه و مدیر کنید.";
  }
  if (normalized.includes("forbidden")) {
    return "تلگرام دسترسی ربات به این مقصد را رد کرد؛ دسترسی مدیر و امکان بررسی اعضا را بررسی کنید.";
  }
  if (normalized.includes("socket hang up") || normalized.includes("econnreset") || normalized.includes("etimedout") || normalized.includes("fetch failed") || normalized.includes("network")) {
    return "ارتباط موقت با تلگرام برقرار نشد؛ ربات چند بار خودکار تلاش کرد. لطفاً چند لحظه بعد دوباره ثبت کنید.";
  }
  return "اطلاعات این مقصد از تلگرام دریافت نشد؛ شناسه، دسترسی ربات و نوع مقصد را بررسی کنید.";
}
