import type { Context } from "telegraf";
import { findTelegramUserByUsername, recordTelegramUser } from "./repository";

/** A stable parse token that is substituted only for Telegram `text_mention` entities. */
export const INLINE_MENTION_TOKEN = "@__kronos_target__";

export type TargetReference =
  | { kind: "reply" }
  | { kind: "mention" }
  | { kind: "id"; telegramUserId: number }
  | { kind: "username"; username: string };

export type ResolvedTelegramTarget = {
  telegramUserId: number;
  displayName: string;
  username?: string;
};

type TelegramUserLike = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  is_bot?: boolean;
};

type TelegramMentionEntity = {
  type?: string;
  offset?: number;
  length?: number;
  user?: TelegramUserLike;
  url?: string;
};

function displayNameFor(user: TelegramUserLike) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || (user.username ? `@${user.username}` : String(user.id));
}

function asResolvedTarget(user: TelegramUserLike): ResolvedTelegramTarget | undefined {
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || user.is_bot) return undefined;
  return {
    telegramUserId: user.id,
    displayName: displayNameFor(user),
    username: user.username,
  };
}

/**
 * Replaces only user-picker mentions with a deterministic token, so existing
 * slashless command parsers can safely recognize a selected Telegram user.
 * Plain `@username` mentions remain untouched and continue through their
 * normal username resolution path.
 */
export function prepareTargetAwareCommandText(message: { text?: string; entities?: readonly unknown[] } | undefined) {
  if (!message?.text || !message.entities?.length) return message?.text ?? "";
  const entityRanges = message.entities
    .filter((entity): entity is Required<Pick<TelegramMentionEntity, "offset" | "length">> & TelegramMentionEntity => {
      if (!entity || typeof entity !== "object") return false;
      const candidate = entity as TelegramMentionEntity;
      const hasTextMentionUser = candidate.type === "text_mention" && Boolean(candidate.user);
      const hasTelegramUserLink = candidate.type === "text_link" && /^tg:\/\/user\?id=\d+$/i.test(candidate.url ?? "");
      return (hasTextMentionUser || hasTelegramUserLink) && Number.isInteger(candidate.offset) && Number.isInteger(candidate.length);
    })
    .sort((left, right) => right.offset - left.offset);
  return entityRanges.reduce((text, entity) => `${text.slice(0, entity.offset)}${INLINE_MENTION_TOKEN}${text.slice(entity.offset + entity.length)}`, message.text);
}

export function targetReferenceFromToken(token: string | undefined): TargetReference | undefined {
  if (!token) return undefined;
  if (token === INLINE_MENTION_TOKEN) return { kind: "mention" };
  if (/^-?\d{5,16}$/.test(token)) {
    const telegramUserId = Number(token);
    return Number.isSafeInteger(telegramUserId) ? { kind: "id", telegramUserId } : undefined;
  }
  if (/^@[A-Za-z0-9_]{5,32}$/.test(token)) return { kind: "username", username: token.slice(1) };
  return undefined;
}

function selectedTextMention(ctx: Context): TelegramUserLike | undefined {
  const message = ctx.message as { entities?: TelegramMentionEntity[] } | undefined;
  const entity = message?.entities?.find(candidate => candidate.type === "text_mention" && candidate.user)
    ?? message?.entities?.find(candidate => candidate.type === "text_link" && /^tg:\/\/user\?id=\d+$/i.test(candidate.url ?? ""));
  if (!entity) return undefined;
  if (entity.user) return entity.user;
  const numericId = Number(new URL(entity.url!).searchParams.get("id"));
  return Number.isSafeInteger(numericId) && numericId > 0 ? { id: numericId } : undefined;
}

/**
 * Telegram does not expose an arbitrary member roster to bots. Its live
 * administrator list remains available, so it is the safe fallback for an
 * administrator who has not yet generated an update the bot could store.
 */
async function resolveLiveAdministratorByUsername(ctx: Context, username: string): Promise<ResolvedTelegramTarget | undefined> {
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) return undefined;
  try {
    const administrators = await ctx.telegram.getChatAdministrators(ctx.chat.id);
    const user = administrators
      .map(administrator => administrator.user as TelegramUserLike)
      .find(candidate => candidate.username?.replace(/^@/, "").toLocaleLowerCase("en-US") === username);
    const target = user ? asResolvedTarget(user) : undefined;
    if (target && user) await recordTelegramUser(user as any);
    return target;
  } catch {
    return undefined;
  }
}

/** Resolves an explicit command target without weakening the caller's authorization checks. */
export async function resolveTelegramTarget(ctx: Context, reference: TargetReference | undefined): Promise<ResolvedTelegramTarget | undefined> {
  if (!reference) return undefined;
  if (reference.kind === "reply") {
    const message = ctx.message as { reply_to_message?: { from?: TelegramUserLike } } | undefined;
    const user = message?.reply_to_message?.from;
    if (!user) return undefined;
    const target = asResolvedTarget(user);
    if (target) await recordTelegramUser(user as any);
    return target;
  }
  if (reference.kind === "mention") {
    const user = selectedTextMention(ctx);
    const target = user ? asResolvedTarget(user) : undefined;
    if (target && user) await recordTelegramUser(user as any);
    return target;
  }
  if (reference.kind === "id") return reference.telegramUserId > 0 ? { telegramUserId: reference.telegramUserId, displayName: String(reference.telegramUserId) } : undefined;

  const originalUsername = reference.username;
  const username = originalUsername.trim().replace(/^@/, "").toLocaleLowerCase("en-US");
  const known = await findTelegramUserByUsername(username);
  if (known && !known.isBot) {
    return {
      telegramUserId: known.telegramUserId,
      displayName: [known.firstName, known.lastName].filter(Boolean).join(" ") || `@${known.username ?? username}`,
      username: known.username ?? undefined,
    };
  }
  const liveAdministrator = await resolveLiveAdministratorByUsername(ctx, username);
  if (liveAdministrator) return liveAdministrator;
  try {
    const chat = await ctx.telegram.getChat(`@${username}`);
    if (chat.id <= 0 || chat.type !== "private") return undefined;
    return { telegramUserId: chat.id, displayName: `@${username}`, username };
  } catch {
    return undefined;
  }
}
