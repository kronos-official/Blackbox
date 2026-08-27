import { Markup, type Context } from "telegraf";
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { channelListings, forcedJoinAcquisitions, forcedJoinChannels, forcedJoinDailyStats, forcedJoinGroupLocks, forcedJoinSessions, scheduledJobs, telegramGroups } from "../../drizzle/schema";
import { getDb } from "../db";
import { alertOwner } from "./alerts";
import { isOwnerTelegramId } from "./authorization";
import { getTelegramBot } from "./bot";
import { translate } from "./i18n";
import { findGroupByChatId, getPreferredLocale, writeAuditLog } from "./repository";
import { withTelegramRetry } from "./retry";
import { withTelegramButtonStyle } from "./buttonStyle";
import { isLinkedChannelAutomaticForward } from "./groupSafety";
import { isVipProtected } from "./vipProtection";

type RequiredChannel = typeof forcedJoinChannels.$inferSelect;
type MembershipClient = { getChatMember: (chatId: number, userId: number) => Promise<{ status: string; is_member?: boolean }> };
type MembershipCheckOptions = { attempts?: number; retryDelayMs?: number; sleep?: (milliseconds: number) => Promise<void> };
export const FORCED_JOIN_VERIFICATION_RECHECK = { attempts: 4, retryDelayMs: 1_000 } as const;
export type MiniAppForcedJoinStatus = { locked: boolean; unavailable: boolean; missingCount: number; missingChannels: Array<{ id: number; title: string; inviteUrl: string | null; username: string | null }>; lastMembershipCheckAt: Date | null };

/** No active requirement means a Mini App user must never be gated by membership. */
export function noMiniAppForcedJoinStatus(): MiniAppForcedJoinStatus {
  return { locked: false, unavailable: false, missingCount: 0, missingChannels: [], lastMembershipCheckAt: null };
}

export function unavailableMiniAppForcedJoinStatus(channels: Array<Pick<RequiredChannel, "id" | "title" | "inviteUrl" | "username">>): MiniAppForcedJoinStatus {
  const missingChannels = channels.map(channel => ({ id: channel.id, title: channel.title, inviteUrl: channel.inviteUrl, username: channel.username }));
  return { locked: true, unavailable: true, missingCount: missingChannels.length, missingChannels, lastMembershipCheckAt: new Date() };
}

export function checkedMiniAppForcedJoinStatus(checked: { locked: boolean; unavailable: boolean; missing: Array<Pick<RequiredChannel, "id" | "title" | "inviteUrl" | "username">> }): MiniAppForcedJoinStatus {
  const missingChannels = checked.missing.map(channel => ({ id: channel.id, title: channel.title, inviteUrl: channel.inviteUrl, username: channel.username }));
  return { locked: checked.locked, unavailable: checked.unavailable, missingCount: missingChannels.length, missingChannels, lastMembershipCheckAt: new Date() };
}

export function isForcedJoinChannelRequiredNow(channel: Pick<RequiredChannel, "status" | "expiresAt">, now = new Date()): boolean {
  return channel.status === "active" && (!channel.expiresAt || channel.expiresAt > now);
}

export function isBotPrivateForcedJoinEligible(ctx: Pick<Context, "chat" | "from">): boolean {
  return Boolean(ctx.from && !ctx.from.is_bot && ctx.chat?.type === "private" && !isOwnerTelegramId(ctx.from.id));
}

function isCurrentMember(member: { status: string; is_member?: boolean }): boolean {
  return ["creator", "owner", "administrator", "member"].includes(member.status) || (member.status === "restricted" && member.is_member === true);
}

export async function getRequiredForcedJoinChannels(groupId?: number, now = new Date()): Promise<RequiredChannel[]> {
  const db = await getDb();
  if (!db) return [];
  const scopeFilter = groupId === undefined
    ? inArray(forcedJoinChannels.scope, ["global", "marketplace"])
    : or(eq(forcedJoinChannels.scope, "global"), eq(forcedJoinChannels.scope, "marketplace"), and(eq(forcedJoinChannels.scope, "group"), eq(forcedJoinChannels.groupId, groupId)));
  const channels = await db
    .select()
    .from(forcedJoinChannels)
    .where(and(eq(forcedJoinChannels.status, "active"), scopeFilter, or(isNull(forcedJoinChannels.expiresAt), gt(forcedJoinChannels.expiresAt, now))));
  return channels.filter(channel => isForcedJoinChannelRequiredNow(channel, now));
}

/** Checks every required channel on every interaction; no stale session state can grant access. */
async function evaluateForcedJoinMembershipOnce(channels: RequiredChannel[], telegramUserId: number, client: MembershipClient) {
  const missingChannelIds: number[] = [];
  const unavailableChannelIds: number[] = [];
  const lookupErrors: Array<{ channelId: number; message: string }> = [];
  for (const channel of channels) {
    try {
      const membership = await withTelegramRetry(() => client.getChatMember(channel.channelChatId, telegramUserId));
      if (!isCurrentMember(membership)) missingChannelIds.push(channel.id);
    } catch (error) {
      unavailableChannelIds.push(channel.id);
      lookupErrors.push({ channelId: channel.id, message: error instanceof Error ? error.message.slice(0, 300) : "unknown Telegram membership lookup error" });
    }
  }
  return { allowed: missingChannelIds.length === 0 && unavailableChannelIds.length === 0, missingChannelIds, unavailableChannelIds, lookupErrors };
}

/** Re-checks a just-completed join once more to absorb Telegram's short membership propagation delay. */
export async function evaluateForcedJoinMembership(channels: RequiredChannel[], telegramUserId: number, client: MembershipClient, options: MembershipCheckOptions = {}) {
  const attempts = Math.max(1, options.attempts ?? 1);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 750);
  const sleep = options.sleep ?? (milliseconds => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  let result = await evaluateForcedJoinMembershipOnce(channels, telegramUserId, client);
  for (let attempt = 1; !result.allowed && attempt < attempts; attempt += 1) {
    await sleep(retryDelayMs);
    result = await evaluateForcedJoinMembershipOnce(channels, telegramUserId, client);
  }
  return result;
}

async function persistSession(telegramUserId: number, missingChannelIds: number[], promptMessageId?: number | null) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(forcedJoinSessions)
    .values({
      telegramUserId,
      locked: missingChannelIds.length > 0,
      missingChannelIds,
      lockReason: missingChannelIds.length > 0 ? "required_channel_missing" : null,
      lastMembershipCheckAt: new Date(),
      lastPromptMessageId: promptMessageId ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        locked: missingChannelIds.length > 0,
        missingChannelIds,
        lockReason: missingChannelIds.length > 0 ? "required_channel_missing" : null,
        lastMembershipCheckAt: new Date(),
        ...(promptMessageId === undefined ? {} : { lastPromptMessageId: promptMessageId }),
      },
    });
}

function asChannelIdList(value: unknown): number[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item > 0)))
    : [];
}

/**
 * Counts only a successful return from a previously locked state. This prevents ordinary, repeated
 * membership checks from inflating the count, while the aggregate itself never stores a user ID.
 */
export function verifiedAcquisitionChannelIds(previous: { locked: boolean; missingChannelIds: unknown } | null | undefined, required: RequiredChannel[]) {
  if (!previous?.locked) return [];
  const requiredIds = new Set(required.map(channel => channel.id));
  return asChannelIdList(previous.missingChannelIds).filter(channelId => requiredIds.has(channelId));
}

async function recordVerifiedForcedJoinAcquisitions(telegramUserId: number, required: RequiredChannel[]) {
  const db = await getDb();
  if (!db) return [];

  return db.transaction(async tx => {
    const previous = (
      await tx
        .select({ locked: forcedJoinSessions.locked, missingChannelIds: forcedJoinSessions.missingChannelIds })
        .from(forcedJoinSessions)
        .where(eq(forcedJoinSessions.telegramUserId, telegramUserId))
        .limit(1)
    )[0];
    const channelIds = verifiedAcquisitionChannelIds(previous, required);
    if (!channelIds.length) return [];

    // Only the first successful callback may move this session from locked to unlocked. The guarded
    // update makes concurrent callback deliveries idempotent without adding user identity to analytics.
    const unlocked = await tx
      .update(forcedJoinSessions)
      .set({ locked: false, missingChannelIds: [], lockReason: null, lastMembershipCheckAt: new Date(), lastPromptMessageId: null })
      .where(and(eq(forcedJoinSessions.telegramUserId, telegramUserId), eq(forcedJoinSessions.locked, true)));
    const affectedRows = Array.isArray(unlocked) ? Number((unlocked[0] as { affectedRows?: number } | undefined)?.affectedRows ?? 0) : 0;
    if (affectedRows !== 1) return [];

    const now = new Date();
    for (const forcedJoinChannelId of channelIds) {
      await tx
        .insert(forcedJoinAcquisitions)
        .values({ forcedJoinChannelId, verifiedCount: 1, lastVerifiedAt: now })
        .onDuplicateKeyUpdate({ set: { verifiedCount: sql`${forcedJoinAcquisitions.verifiedCount} + 1`, lastVerifiedAt: now } });
      const dayKey = now.toISOString().slice(0, 10);
      await db.insert(forcedJoinDailyStats)
        .values({ forcedJoinChannelId, dayKey, verifiedCount: 1 })
        .onDuplicateKeyUpdate({ set: { verifiedCount: sql`${forcedJoinDailyStats.verifiedCount} + 1` } });
    }
    return channelIds;
  });
}

export function joinKeyboard(missing: RequiredChannel[], locale: string, targetTelegramUserId?: number) {
  const channelButtons = missing
    .map(channel => {
      const url = channel.inviteUrl ?? (channel.username ? `https://t.me/${channel.username.replace(/^@/, "")}` : undefined);
      const label = channel.buttonLabel?.trim() || translate(locale, "joinChannel");
      return url ? withTelegramButtonStyle(Markup.button.url(label, url), "primary") : undefined;
    })
    .filter(Boolean) as Array<ReturnType<typeof withTelegramButtonStyle>>;
  return Markup.inlineKeyboard(([
    ...channelButtons.map(button => [button]),
    [withTelegramButtonStyle(Markup.button.callback(translate(locale, "verifyMembership"), targetTelegramUserId ? `forced_join:verify:${targetTelegramUserId}` : "forced_join:verify"), "success")],
  ] as any));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ?? character);
}

export function forcedJoinPromptText(locale: string, missing: RequiredChannel[], target?: { id: number; firstName?: string; first_name?: string; lastName?: string; last_name?: string; username?: string }) {
  const destinations = missing.map(channel => channel.title).filter(Boolean).join("، ");
  const detail = destinations ? `\n\n${translate(locale, "forcedJoinStillMissing")}\n${destinations}` : "";
  const displayName = [target?.firstName ?? target?.first_name, target?.lastName ?? target?.last_name].filter(Boolean).join(" ") || target?.username || "کاربر";
  const targetMention = target?.id ? `<a href="tg://user?id=${target.id}">${escapeHtml(displayName)}</a>` : escapeHtml(displayName);
  return `${targetMention}\n⛔ ${translate(locale, "forcedJoinLocked")}${detail}`;
}

async function showForcedJoinLock(ctx: Context, missing: RequiredChannel[]) {
  const locale = await getPreferredLocale(ctx.from?.id ?? 0);
  const target = ctx.from ? { id: ctx.from.id, firstName: ctx.from.first_name, lastName: ctx.from.last_name, username: ctx.from.username } : undefined;
  const message = forcedJoinPromptText(locale, missing, target);
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery(forcedJoinPromptText(locale, missing), { show_alert: true });
    return;
  }
  const sent = await ctx.reply(message, { parse_mode: "HTML", ...joinKeyboard(missing, locale, ctx.from?.id) });
  if (ctx.from) await persistSession(ctx.from.id, missing.map(channel => channel.id), sent.message_id);
}

async function showForcedJoinVerificationUnavailable(ctx: Context, unavailable: RequiredChannel[]) {
  const locale = await getPreferredLocale(ctx.from?.id ?? 0);
  const message = translate(locale, "forcedJoinVerificationUnavailable");
  if (ctx.callbackQuery) {
    await ctx.answerCbQuery(message, { show_alert: true });
    return;
  }
  await ctx.reply(`⚠️ ${message}`, joinKeyboard(unavailable, locale));
}

/** Returns false when the caller must not be allowed to run any further bot action. */
/**
 * Performs the same fail-closed membership check used by private bot interactions,
 * but returns safe channel metadata for the Mini App gate instead of sending a Telegram message.
 */
export async function checkMiniAppForcedJoin(telegramUserId: number, client: MembershipClient) {
  const required = await getRequiredForcedJoinChannels();
  if (required.length === 0) return { locked: false, unavailable: false, missing: [] as RequiredChannel[] };
  const membership = await evaluateForcedJoinMembership(required, telegramUserId, client);
  const missing = required.filter(channel => membership.missingChannelIds.includes(channel.id));
  await persistSession(telegramUserId, membership.missingChannelIds, membership.allowed ? null : undefined);
  return { locked: !membership.allowed, unavailable: membership.unavailableChannelIds.length > 0, missing };
}

export function shouldEnforceGroupForcedJoin(input: { chatType: string | undefined; requiredCount: number; memberStatus: string; membershipAllowed: boolean }): boolean {
  return Boolean(input.chatType && ["group", "supergroup"].includes(input.chatType) && input.requiredCount > 0 && !["creator", "administrator"].includes(input.memberStatus) && !input.membershipAllowed);
}

/**
 * Channel posts mirrored by Telegram into their linked discussion group are not
 * user-authored group messages. They must never start a forced-join lookup or
 * be removed by the resulting enforcement path.
 */
export function shouldBypassGroupForcedJoinForLinkedChannelPost(message: { is_automatic_forward?: boolean; sender_chat?: { type?: string } } | undefined) {
  return Boolean(message && isLinkedChannelAutomaticForward(message));
}

/**
 * A member-join service update is handled by enforceNewGroupMemberForcedJoin.
 * Letting the general message guard handle it as well sends the same user two
 * lock prompts when the joining user is also the update actor.
 */
export function shouldBypassGroupForcedJoinForMemberJoinServiceMessage(message: { new_chat_members?: unknown[] } | undefined) {
  return Boolean(Array.isArray(message?.new_chat_members) && message.new_chat_members.length > 0);
}

/** A member entry needs one prompt whenever at least one required channel is missing. */
export function shouldPromptNewGroupMemberForcedJoin(input: { allowed: boolean; unavailableChannelCount: number; missingChannelCount: number }) {
  return !input.allowed && input.unavailableChannelCount === 0 && input.missingChannelCount > 0;
}

const OPEN_GROUP_PERMISSIONS = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
  can_change_info: false,
  can_invite_users: true,
  can_pin_messages: false,
} as const;

async function ensureGroupForcedJoinAccess(ctx: Context): Promise<boolean> {
  const message = ctx.message as { is_automatic_forward?: boolean; sender_chat?: { type?: string }; new_chat_members?: unknown[] } | undefined;
  if (shouldBypassGroupForcedJoinForLinkedChannelPost(message) || shouldBypassGroupForcedJoinForMemberJoinServiceMessage(message)) return true;
  if (!ctx.from || ctx.from.is_bot || !ctx.chat || !["group", "supergroup"].includes(ctx.chat.type)) return true;
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) return true;
  if (await isVipProtected(group.id, ctx.from.id, "ignoreForcedJoin")) return true;
  const required = (await getRequiredForcedJoinChannels(group.id)).filter(channel => channel.scope === "group" && channel.groupId === group.id);
  if (!required.length) return true;

  const actor = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
  if (["creator", "administrator"].includes(actor.status)) return true;
  const membership = await evaluateForcedJoinMembership(required, ctx.from.id, ctx.telegram);
  const previous = (await (await getDb())?.select({ locked: forcedJoinGroupLocks.locked }).from(forcedJoinGroupLocks).where(and(eq(forcedJoinGroupLocks.groupId, group.id), eq(forcedJoinGroupLocks.telegramUserId, ctx.from.id))).limit(1))?.[0];
  const messageId = "message" in ctx && ctx.message && "message_id" in ctx.message ? ctx.message.message_id : undefined;

  if (membership.unavailableChannelIds.length) {
    if (messageId) await ctx.telegram.deleteMessage(ctx.chat.id, messageId).catch(() => undefined);
    await showForcedJoinVerificationUnavailable(ctx, required.filter(channel => membership.unavailableChannelIds.includes(channel.id)));
    return false;
  }

  const db = await getDb();
  if (!db) return true;
  const shouldEnforce = shouldEnforceGroupForcedJoin({ chatType: ctx.chat.type, requiredCount: required.length, memberStatus: actor.status, membershipAllowed: membership.allowed });
  if (!shouldEnforce && membership.allowed) {
    if (previous?.locked) {
      await ctx.telegram.restrictChatMember(ctx.chat.id, ctx.from.id, { permissions: OPEN_GROUP_PERMISSIONS }).catch(error => console.warn("[Kronos Guard] could not unlock verified group member", error));
      await db.update(forcedJoinGroupLocks).set({ locked: false, missingChannelIds: [], lastMembershipCheckAt: new Date(), lastPromptMessageId: null }).where(and(eq(forcedJoinGroupLocks.groupId, group.id), eq(forcedJoinGroupLocks.telegramUserId, ctx.from.id)));
      await writeAuditLog({ category: "forced_join", event: "group_member_unlocked", groupId: group.id, subjectTelegramId: ctx.from.id });
    }
    return true;
  }

  if (!shouldEnforce) return true;
  if (messageId) await ctx.telegram.deleteMessage(ctx.chat.id, messageId).catch(() => undefined);
  if (!previous?.locked) {
    await ctx.telegram.restrictChatMember(ctx.chat.id, ctx.from.id, { permissions: { can_send_messages: false } }).catch(error => console.warn("[Kronos Guard] could not lock missing-membership group member", error));
    const locale = await getPreferredLocale(ctx.from.id);
    const missing = required.filter(channel => membership.missingChannelIds.includes(channel.id));
    const target = { id: ctx.from.id, firstName: ctx.from.first_name, lastName: ctx.from.last_name, username: ctx.from.username };
    const sent = await ctx.reply(forcedJoinPromptText(locale, missing, target), { parse_mode: "HTML", ...joinKeyboard(missing, locale, ctx.from.id) });
    await db.insert(forcedJoinGroupLocks).values({ groupId: group.id, telegramUserId: ctx.from.id, locked: true, missingChannelIds: membership.missingChannelIds, lastMembershipCheckAt: new Date(), lastPromptMessageId: sent.message_id }).onDuplicateKeyUpdate({ set: { locked: true, missingChannelIds: membership.missingChannelIds, lastMembershipCheckAt: new Date(), lastPromptMessageId: sent.message_id } });
    await writeAuditLog({ category: "forced_join", event: "group_member_locked", groupId: group.id, subjectTelegramId: ctx.from.id, details: { missingChannelIds: membership.missingChannelIds } });
  } else {
    await db.update(forcedJoinGroupLocks).set({ missingChannelIds: membership.missingChannelIds, lastMembershipCheckAt: new Date() }).where(and(eq(forcedJoinGroupLocks.groupId, group.id), eq(forcedJoinGroupLocks.telegramUserId, ctx.from.id)));
  }
  return false;
}

export async function ensureForcedJoinAccess(ctx: Context): Promise<boolean> {
  if (!(await ensureGroupForcedJoinAccess(ctx))) return false;
  if (!ctx.from || ctx.from.is_bot) return true;
  // Bot-private forced join must never post an enforcement notice in a group.
  if (!isBotPrivateForcedJoinEligible(ctx)) return true;
  const required = await getRequiredForcedJoinChannels();
  if (required.length === 0) return true;

  const isVerificationCallback = Boolean(ctx.callbackQuery && "data" in ctx.callbackQuery && /^forced_join:verify(?::\d+)?$/.test(ctx.callbackQuery.data));
  const membership = await evaluateForcedJoinMembership(required, ctx.from.id, ctx.telegram, isVerificationCallback ? FORCED_JOIN_VERIFICATION_RECHECK : undefined);
  if (membership.unavailableChannelIds.length) {
    const unavailable = required.filter(channel => membership.unavailableChannelIds.includes(channel.id));
    await writeAuditLog({ severity: "warning", category: "forced_join", event: "membership_lookup_unavailable", subjectTelegramId: ctx.from.id, details: { channels: membership.lookupErrors } });
    try {
      await alertOwner(ctx.telegram, { alertType: "bot_permission_lost", severity: "critical", title: "بررسی عضویت اجباری ناممکن است", body: `ربات نتوانست عضویت کاربر در ${unavailable.map(channel => channel.title).join("، ")} را بررسی کند. دسترسی مدیر ربات در کانال را بررسی کنید.`, dedupeKey: `forced-join-membership-lookup-${unavailable.map(channel => channel.id).sort().join("-")}` });
    } catch (error) {
      console.error("[Kronos Guard] forced-join lookup alert failed", error);
    }
    await showForcedJoinVerificationUnavailable(ctx, unavailable);
    return false;
  }
  if (membership.allowed) {
    try {
      await recordVerifiedForcedJoinAcquisitions(ctx.from.id, required);
    } catch (error) {
      // Analytics must never turn a confirmed membership into a bot-access failure.
      console.error("[Kronos Guard] forced-join acquisition aggregate could not be updated", error);
    }
  }
  await persistSession(ctx.from.id, membership.missingChannelIds, membership.allowed ? null : undefined);
  if (membership.allowed) return true;

  await showForcedJoinLock(ctx, required.filter(channel => membership.missingChannelIds.includes(channel.id)));
  return false;
}

export async function sendPrivateForcedJoinLock(telegram: Pick<Context["telegram"], "sendMessage">, telegramUserId: number, missing: RequiredChannel[]) {
  const locale = await getPreferredLocale(telegramUserId);
  const sent = await telegram.sendMessage(telegramUserId, forcedJoinPromptText(locale, missing, { id: telegramUserId }), { parse_mode: "HTML", ...joinKeyboard(missing, locale, telegramUserId) });
  await persistSession(telegramUserId, missing.map(channel => channel.id), sent.message_id);
}

type ManagedGroup = { id: number; chatId: number; title: string };
type GroupPromptTarget = { id: number; first_name?: string; last_name?: string; username?: string };

async function lockGroupMemberForMissing(telegram: Context["telegram"], group: ManagedGroup, telegramUserId: number, missing: RequiredChannel[], target?: GroupPromptTarget) {
  const db = await getDb();
  if (!db || missing.length === 0) return;
  const locale = await getPreferredLocale(telegramUserId);
  await telegram.restrictChatMember(group.chatId, telegramUserId, { permissions: { can_send_messages: false } }).catch(error => console.warn("[Kronos Guard] could not lock forced-join group member", error));
  const sent = await telegram.sendMessage(group.chatId, forcedJoinPromptText(locale, missing, target ?? { id: telegramUserId }), { parse_mode: "HTML", ...joinKeyboard(missing, locale, telegramUserId) });
  await db.insert(forcedJoinGroupLocks).values({ groupId: group.id, telegramUserId, locked: true, missingChannelIds: missing.map(channel => channel.id), lastMembershipCheckAt: new Date(), lastPromptMessageId: sent.message_id }).onDuplicateKeyUpdate({ set: { locked: true, missingChannelIds: missing.map(channel => channel.id), lastMembershipCheckAt: new Date(), lastPromptMessageId: sent.message_id } });
  await writeAuditLog({ category: "forced_join", event: "group_member_locked", groupId: group.id, subjectTelegramId: telegramUserId, details: { missingChannelIds: missing.map(channel => channel.id) } });
}

/** Sends the membership prompt immediately after a new member's welcome message. */
export async function enforceNewGroupMemberForcedJoin(ctx: Context, member: GroupPromptTarget & { is_bot?: boolean }) {
  if (member.is_bot || !ctx.chat || !["group", "supergroup"].includes(ctx.chat.type)) return;
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) return;
  const required = (await getRequiredForcedJoinChannels(group.id)).filter(channel => channel.scope === "group" && channel.groupId === group.id);
  if (!required.length) return;
  const groupMember = await ctx.telegram.getChatMember(group.chatId, member.id).catch(() => undefined);
  if (!groupMember || ["creator", "administrator"].includes(groupMember.status)) return;
  const membership = await evaluateForcedJoinMembership(required, member.id, ctx.telegram);
  const missing = required.filter(channel => membership.missingChannelIds.includes(channel.id));
  if (shouldPromptNewGroupMemberForcedJoin({ allowed: membership.allowed, unavailableChannelCount: membership.unavailableChannelIds.length, missingChannelCount: missing.length })) {
    await lockGroupMemberForMissing(ctx.telegram, group, member.id, missing, member);
  }
}

/** Uses Telegram's chat-member update when available to lock a user immediately after leaving a required channel. */
export async function applyChatMemberForcedJoinLock(ctx: Context): Promise<void> {
  const chatMember = ctx.chatMember;
  if (!chatMember) return;
  const db = await getDb();
  if (!db) return;
  const channels = await db
    .select()
    .from(forcedJoinChannels)
    .where(and(eq(forcedJoinChannels.channelChatId, chatMember.chat.id), eq(forcedJoinChannels.status, "active"), or(isNull(forcedJoinChannels.expiresAt), gt(forcedJoinChannels.expiresAt, new Date()))));
  if (!channels.length) return;
  const member = chatMember.new_chat_member as { user: GroupPromptTarget & { is_bot: boolean }; status: string; is_member?: boolean };
  if (member.user.is_bot || isCurrentMember(member)) return;

  for (const channel of channels) {
    if (channel.scope !== "group" || !channel.groupId) continue;
    const group = (await db.select({ id: telegramGroups.id, chatId: telegramGroups.chatId, title: telegramGroups.title }).from(telegramGroups).where(and(eq(telegramGroups.id, channel.groupId), eq(telegramGroups.status, "active"))).limit(1))[0];
    if (!group) continue;
    const groupMember = await ctx.telegram.getChatMember(group.chatId, member.user.id).catch(() => undefined);
    if (!groupMember || !isCurrentMember(groupMember) || ["creator", "administrator"].includes(groupMember.status)) continue;
    const required = (await getRequiredForcedJoinChannels(group.id)).filter(item => item.scope === "group" && item.groupId === group.id);
    const membership = await evaluateForcedJoinMembership(required, member.user.id, ctx.telegram);
    const missing = required.filter(item => membership.missingChannelIds.includes(item.id));
    if (shouldPromptNewGroupMemberForcedJoin({ allowed: membership.allowed, unavailableChannelCount: membership.unavailableChannelIds.length, missingChannelCount: missing.length })) {
      await lockGroupMemberForMissing(ctx.telegram, group, member.user.id, missing, member.user);
      await writeAuditLog({ category: "forced_join", event: "instant_lock_after_leave", groupId: group.id, subjectTelegramId: member.user.id, details: { channelId: channel.id, channelChatId: channel.channelChatId } });
    }
  }

  await persistSession(member.user.id, channels.map(channel => channel.id));
  try {
    await sendPrivateForcedJoinLock(ctx.telegram, member.user.id, channels);
  } catch {
    // Telegram only permits proactive private messages after the user has started the bot.
    await writeAuditLog({ severity: "warning", category: "forced_join", event: "private_leave_lock_prompt_unavailable", subjectTelegramId: member.user.id, details: { channelId: channels[0].id } });
  }
}

export async function expireForcedJoinChannels(now = new Date()) {
  const db = await getDb();
  if (!db) return { expired: 0 };
  const expired = await db
    .select()
    .from(forcedJoinChannels)
    .where(and(eq(forcedJoinChannels.status, "active"), lte(forcedJoinChannels.expiresAt, now)));
  if (expired.length === 0) return { expired: 0 };

  const telegram = getTelegramBot()?.telegram;
  for (const channel of expired) {
    await db.update(forcedJoinChannels).set({ status: "expired" }).where(and(eq(forcedJoinChannels.id, channel.id), eq(forcedJoinChannels.status, "active")));
    if (channel.listingId) await db.update(channelListings).set({ status: "expired" }).where(and(eq(channelListings.id, channel.listingId), eq(channelListings.status, "active")));
    await writeAuditLog({ severity: "warning", category: "forced_join", event: "listing_expired", details: { channelId: channel.id, channelChatId: channel.channelChatId } });
    if (telegram) {
      await alertOwner(telegram, {
        alertType: "forced_join_expired",
        severity: "warning",
        title: "اشتراک فاجوین منقضی شد",
        body: `کانال «${channel.title}» از فاجوین خارج شد؛ دوره فعال آن پایان یافته است.`,
        dedupeKey: `forced-join-expired-${channel.id}`,
        relatedEntityType: "forced_join_channel",
        relatedEntityId: channel.id,
      });
    }
  }
  return { expired: expired.length };
}

/** Database-led idempotency protects the periodic job from duplicate delivery and platform retries. */
export async function reconcileForcedJoinExpiry(now = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable for forced-join reconciliation");
  const idempotencyKey = `forced_join_expiry:${now.toISOString().slice(0, 13)}`;
  await db
    .insert(scheduledJobs)
    .values({ jobType: "listing_expiry", idempotencyKey, payload: { source: "heartbeat" }, status: "pending", runAfter: now })
    .onDuplicateKeyUpdate({ set: { idempotencyKey: sql`${scheduledJobs.idempotencyKey}` } });
  const job = (await db.select().from(scheduledJobs).where(eq(scheduledJobs.idempotencyKey, idempotencyKey)).limit(1))[0];
  if (!job || job.status === "completed") return { skipped: true, expired: 0 };

  try {
    await db.update(scheduledJobs).set({ status: "running", lockedAt: now, attempts: sql`${scheduledJobs.attempts} + 1`, lastError: null }).where(eq(scheduledJobs.id, job.id));
    const result = await expireForcedJoinChannels(now);
    await db.update(scheduledJobs).set({ status: "completed", completedAt: new Date() }).where(eq(scheduledJobs.id, job.id));
    return { skipped: false, ...result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(scheduledJobs).set({ status: "failed", lastError: message.slice(0, 1500) }).where(eq(scheduledJobs.id, job.id));
    throw error;
  }
}
