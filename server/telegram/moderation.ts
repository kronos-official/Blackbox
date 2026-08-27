import type { Context } from "telegraf";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { groupMembers, groupRoles, groupSettings, moderationActions, telegramUsers, userWarnings } from "../../drizzle/schema";
import { getDb } from "../db";
import { hasAtLeastAccess, mayModerateTarget, resolveAccessLevel } from "./authorization";
import { parseModerationCommand, type ParsedModerationCommand } from "./commandParser";
import type { AccessLevel } from "./constants";
import { findGroupByChatId, getGroupUserActivityStats, getKronosMemberTitle, recordTelegramUser, writeAuditLog } from "./repository";
import { hasMissingReplyTarget, replySafely } from "./replySafe";
import { deleteTemporaryCommandSuccess, telegramMessageId } from "./temporarySuccess";
import { isVipProtected, type VipProtectionKey } from "./vipProtection";
import { notifyGroupEvent } from "./groupEventNotifier";
import { prepareTargetAwareCommandText, resolveTelegramTarget } from "./targetResolver";

type ResolvedTarget = { telegramUserId: number; displayName: string };

export const USER_PANEL_REFRESH_TIMEOUT_MS = 10_000;
const userPanelRefreshCooldowns = new Map<string, number>();

export const USER_PANEL_REFRESH_CALLBACK_PREFIX = "user-panel-refresh:";
export const USER_PANEL_LAST_UPDATED_CALLBACK = "user-panel-last-updated";
export const USER_PANEL_REFRESH_ERROR_TEXT = "⚠️ تازه‌سازی انجام نشد؛ دوباره تلاش کنید.";

export function appendUserPanelRefreshError(caption: string) {
  if (caption.includes(USER_PANEL_REFRESH_ERROR_TEXT)) return caption;
  return `${caption}\n\n<b>${USER_PANEL_REFRESH_ERROR_TEXT}</b>`;
}

function formatLastUpdatedAt(value: Date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(value);
}

export function userPanelRefreshKeyboard(groupId: number, telegramUserId: number, remainingSeconds = 0, lastUpdatedAt?: Date) {
  const callbackData = `${USER_PANEL_REFRESH_CALLBACK_PREFIX}${groupId}:${telegramUserId}`;
  const text = remainingSeconds > 0 ? `🔄 تازه‌سازی در ${remainingSeconds} ثانیه` : "🔄 تازه‌سازی پنل";
  const keyboard = [[{ text, callback_data: callbackData, style: "primary" }]] as Array<Array<{ text: string; callback_data: string; style?: string }>>;
  // The informational row is intentionally unstyled: Telegram supports only the
  // three button styles declared by buttonStyle.ts, and rejects `secondary`.
  if (lastUpdatedAt) keyboard.push([{ text: `آخرین به‌روزرسانی: ${formatLastUpdatedAt(lastUpdatedAt)}`, callback_data: USER_PANEL_LAST_UPDATED_CALLBACK }]);
  return { inline_keyboard: keyboard };
}

function refreshCountdownMarkup(groupId: number, telegramUserId: number, expiresAt: number, lastUpdatedAt: Date) {
  const remainingSeconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  return userPanelRefreshKeyboard(groupId, telegramUserId, remainingSeconds, lastUpdatedAt);
}

function scheduleUserPanelRefreshCountdown(ctx: Context, groupId: number, telegramUserId: number, expiresAt: number, lastUpdatedAt: Date) {
  const tick = async () => {
    const remainingSeconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    try {
      await ctx.editMessageReplyMarkup(refreshCountdownMarkup(groupId, telegramUserId, expiresAt, lastUpdatedAt));
    } catch {
      return;
    }
    if (remainingSeconds > 0) setTimeout(tick, 1000);
  };
  setTimeout(tick, 0);
}

export const NON_MODERATOR_COMMAND_REPLY = "تو هنوز ضعیفی بیشتر تلاش کن";

/** Returns a concise hierarchy-aware explanation without weakening moderation access policy. */
export function moderationHierarchyDeniedReply(actorLevel: AccessLevel, targetLevel: AccessLevel) {
  if (!hasAtLeastAccess(actorLevel, "moderator")) return NON_MODERATOR_COMMAND_REPLY;
  if (hasAtLeastAccess(targetLevel, "moderator")) return "⛔ امکان اجرای این دستور وجود ندارد؛ ادمین، مالک یا کاربر مقام‌دار را نمی‌توان بن، سیک یا محدود کرد.";
  return "سطح دسترسی شما برای اقدام روی این کاربر کافی نیست.";
}

/** Resolves reply, numeric, and plain-text username targets without relying solely on Bot API getChat. */
export async function resolveModerationTarget(ctx: Context, command: ParsedModerationCommand): Promise<ResolvedTarget | undefined> {
  const target = await resolveTelegramTarget(ctx, command.target);
  return target ? { telegramUserId: target.telegramUserId, displayName: target.displayName } : undefined;
}

function mutePermissions() {
  return {
    can_send_messages: false,
    can_send_audios: false,
    can_send_documents: false,
    can_send_photos: false,
    can_send_videos: false,
    can_send_video_notes: false,
    can_send_voice_notes: false,
    can_send_polls: false,
    can_send_other_messages: false,
    can_add_web_page_previews: false,
    can_change_info: false,
    can_invite_users: false,
    can_pin_messages: false,
    can_manage_topics: false,
  };
}

export function unrestrictedPermissions() {
  return Object.fromEntries(Object.keys(mutePermissions()).map(key => [key, true]));
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function accessLabel(level: AccessLevel) {
  return ({ owner: "مالک اصلی ربات", global_admin: "مالک ربات", group_owner: "مالک گروه", group_admin: "مدیر گروه", moderator: "مقام ربات", user: "کاربر" } as Record<AccessLevel, string>)[level];
}

function panelAccessLabel(level: AccessLevel, isVip = false) {
  if (level === "owner" || level === "global_admin" || level === "group_owner") return "مالک";
  if (level === "group_admin" || level === "moderator") return "مدیر";
  if (isVip) return "ویژه";
  return "بدون دسترسی";
}

function telegramRoleLabel(role?: string | null) {
  if (role === "owner") return "مالک";
  if (role === "administrator") return "مدیر";
  return "بدون مقام";
}

export function buildUserPanelCaption(input: { displayName: string; telegramUserId: number; username?: string | null; warningCount: number; role: AccessLevel; isVip?: boolean; telegramRole?: string | null; actionCount: number; memberSince?: Date | null; lastSeenAt?: Date | null; profilePhotoCount?: number; kronosTitle?: string | null; isSelf?: boolean; stats?: { today: { messages: number; addedMembers: number }; week: { messages: number; addedMembers: number }; month: { messages: number; addedMembers: number }; all: { messages: number; addedMembers: number }; messageRank: number | null; addedMemberRank: number | null } }) {
  const username = input.username ? `@${escapeHtml(input.username.replace(/^@/, ""))}` : "ندارد";
  const joined = input.memberSince ? new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", { dateStyle: "medium" }).format(input.memberSince) : "ثبت نشده";
  const photoCount = input.profilePhotoCount === undefined ? "در دسترس نیست" : `${input.profilePhotoCount.toLocaleString("en-US")} تصویر`;
  // Bot API does not expose Telegram's private last-seen state; use the bot's latest observed activity as a conservative presence signal.
  const isRecentlyActive = Boolean(input.lastSeenAt && Date.now() - input.lastSeenAt.getTime() <= 5 * 60 * 1000);
  const presence = isRecentlyActive ? "🟢 آنلاین" : "⚪ آفلاین";
  const panelOwnership = input.isSelf ? "🟢 پنل شما" : "🔵 پنل کاربر دیگر";
  const missingStats = "ثبت نشده";
  const period = (value: number | undefined) => value === undefined ? missingStats : value.toLocaleString("en-US");
  const rank = (value: number | null | undefined) => value == null ? missingStats : `#${value.toLocaleString("en-US")}`;
  return [
    `<b>◈ پنل کاربر | Kronos Guard</b>`,
    `<i>پروندهٔ هویتی، دسترسی و فعالیت عضو در این گروه</i>`,
    `▸ نوع پنل: <b>${panelOwnership}</b>`,
    "────────────",
    `<b>شناسهٔ عضو</b>`,
    `▸ نام نمایشی: <b><a href="tg://user?id=${input.telegramUserId}">${escapeHtml(input.displayName)}</a></b>`,
    `▸ شناسهٔ عددی: <code>${input.telegramUserId}</code>`,
    `▸ نام کاربری: ${username}`,
    `▸ لقب کاربر: ${input.kronosTitle ? `<b>${escapeHtml(input.kronosTitle)}</b>` : "ندارد"}`,
    `▸ سطح دسترسی: <b>${panelAccessLabel(input.role, input.isVip)}</b>`,
    `▸ مقام کاربر: <b>${telegramRoleLabel(input.telegramRole)}</b>`,
    `▸ وضعیت حضور: <b>${presence}</b>`,
    `▸ اولین بازدید: ${joined}`,
    "",
    `<b>شاخص‌های فعالیت</b>`,
    `▸ پیام‌های امروز: <b>${period(input.stats?.today.messages)}</b>`,
    `▸ پیام‌های این هفته: <b>${period(input.stats?.week.messages)}</b>`,
    `▸ پیام‌های این ماه: <b>${period(input.stats?.month.messages)}</b>`,
    `▸ کل پیام‌ها: <b>${period(input.stats?.all.messages)}</b>`,
    `▸ رتبهٔ پیام: <b>${rank(input.stats?.messageRank)}</b>`,
    `▸ افزودن عضو امروز: <b>${period(input.stats?.today.addedMembers)}</b>`,
    `▸ افزودن عضو این هفته: <b>${period(input.stats?.week.addedMembers)}</b>`,
    `▸ افزودن عضو این ماه: <b>${period(input.stats?.month.addedMembers)}</b>`,
    `▸ کل افزودن عضو: <b>${period(input.stats?.all.addedMembers)}</b>`,
    `▸ رتبهٔ افزودن عضو: <b>${rank(input.stats?.addedMemberRank)}</b>`,
    "",
    `<b>وضعیت حفاظتی</b>`,
    `▸ اخطار فعال: <b>${input.warningCount.toLocaleString("en-US")}</b>`,
    `▸ اقدامات مدیریتی: <b>${input.actionCount.toLocaleString("en-US")}</b>`,
    `▸ تصاویر پروفایل: <b>${photoCount}</b>`,
    "",
    "<i>داده‌ها از Telegram و سامانهٔ آماری Kronos Guard خوانده شده‌اند.</i>",
  ].join("\n");
}

function actionDateTime(now = new Date()) {
  return {
    time: new Intl.DateTimeFormat("fa-IR", { timeStyle: "short" }).format(now),
    date: new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "long" }).format(now),
  };
}

export function isVipProtectedAction(action: ParsedModerationCommand["action"]): boolean {
  return action === "mute" || action === "ban" || action === "kick";
}

function vipProtectionKeyForAction(action: ParsedModerationCommand["action"]): VipProtectionKey | undefined {
  return action === "mute" ? "protectMute" : action === "ban" ? "protectBan" : action === "kick" ? "protectKick" : undefined;
}

export function buildVipProtectionMessage(target: ResolvedTarget): string {
  const mention = `<a href="tg://user?id=${target.telegramUserId}">${escapeHtml(target.displayName)}</a>`;
  return `کاربر ${mention} در حال حاضر عضو ویژه است؛ این عملیات روی او اجرا نشد.`;
}

export function buildModerationActionMessage(command: ParsedModerationCommand, target: ResolvedTarget, warningCount?: number, escalated = false, now = new Date(), state?: { noActiveMute?: boolean; noActiveWarnings?: boolean; noActiveBan?: boolean }): string {
  const mention = `<a href="tg://user?id=${target.telegramUserId}">${escapeHtml(target.displayName)}</a>`;
  const names: Record<ParsedModerationCommand["action"], string> = { ban: "مسدود شد", kick: "اخراج شد", mute: "سکوت شد", mute_list: "فهرست سکوت نمایش داده شد", unmute: "رفع سکوت شد", unban: "رفع مسدودیت شد", warn: "اخطار گرفت", unwarn: "اخطارش کاهش یافت", status: "وضعیتش بررسی شد", panel: "پنل کاربر نمایش داده شد" };
  const action = command.specialResponse === "sick_ban" ? "سیکش خورده شد" : names[command.action];
  const stateAwareText = state?.noActiveMute && command.action === "unmute" ? `${mention} این کاربر در حال حاضر در حالت سکوت نیست` : state?.noActiveWarnings && command.action === "unwarn" ? `کاربر ${mention} در حال حاضر اخطار فعالی ندارد` : state?.noActiveBan && command.action === "unban" ? `کاربر ${mention} در حال حاضر در مسدودیت نیست` : `کاربر ${mention} ${action}`;
  const details = state?.noActiveMute || state?.noActiveWarnings || state?.noActiveBan ? "" : command.action === "warn" && warningCount ? ` (${warningCount} اخطار${escalated ? " — اقدام خودکار اجرا شد" : ""})` : command.action === "unwarn" ? ` (${command.warningRemovalCount ?? 1} اخطار حذف شد${warningCount !== undefined ? `؛ ${warningCount} اخطار باقی‌مانده` : ""})` : "";
  if (command.action === "ban" && !command.specialResponse && !state?.noActiveBan) return `🚫 کاربر ${mention} بن شد.`;
  if (command.action === "unban" && !state?.noActiveBan) return `✅ کاربر ${mention} از بن خارج شد.`;
  if (command.action === "mute" && !state?.noActiveMute) {
    const duration = command.permanentMute ? "دائم" : formatMuteDuration(command.durationSeconds ?? 3600);
    return `🔇 کاربر ${mention} برای ${duration} سکوت شد.`;
  }
  const timestamp = actionDateTime(now);
  return `${stateAwareText}${details}\n\nساعت: ${timestamp.time}\nتاریخ: ${timestamp.date}`;
}

function formatMuteDuration(seconds: number) {
  if (seconds > 0 && seconds < 365 * 86400 && seconds % 86400 === 0) return `${(seconds / 86400).toLocaleString("fa-IR")} روز`;
  const units: Array<[string, number]> = [["سال", 365 * 86400], ["ماه", 30 * 86400], ["روز", 86400], ["ساعت", 3600], ["دقیقه", 60], ["ثانیه", 1]];
  let remaining = Math.max(0, Math.floor(seconds));
  return units.flatMap(([label, size]) => { const value = Math.floor(remaining / size); remaining %= size; return value ? [`${value.toLocaleString("fa-IR")} ${label}`] : []; }).join(" و ") || "۰ ثانیه";
}

export async function replyToInitiatingAdmin(ctx: Pick<Context, "message" | "reply" | "chat" | "telegram">, text: string, parseMode?: "HTML", replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }, options?: { temporarySuccess?: boolean }) {
  const messageId = ctx.message && "message_id" in ctx.message ? ctx.message.message_id : undefined;
  const response = await replySafely(ctx as Context, text, {
    ...(parseMode ? { parse_mode: parseMode } : {}),
    ...(messageId ? { reply_parameters: { message_id: messageId } } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
  if (options?.temporarySuccess) {
    await deleteTemporaryCommandSuccess({
      telegram: ctx.telegram,
      chatId: ctx.chat?.id,
      messageId: telegramMessageId(response),
    });
  }
  return response;
}

async function recordAction(input: { groupId: number; actorTelegramId: number; targetTelegramId: number; command: ParsedModerationCommand; expiresAt?: Date }) {
  const db = await getDb();
  if (!db) return;
  await db.insert(moderationActions).values({
    groupId: input.groupId,
    actorTelegramId: input.actorTelegramId,
    targetTelegramId: input.targetTelegramId,
    action: input.command.action as Exclude<ParsedModerationCommand["action"], "status" | "panel" | "mute_list">,
    source: "command",
    commandAlias: input.command.sourceAlias,
    reason: input.command.reason ?? null,
    expiresAt: input.expiresAt ?? null,
  });
}

export async function issueWarning(groupId: number, targetTelegramId: number, reason: string | undefined, additionCount = 1) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while recording warning");
  await db
    .insert(userWarnings)
    .values({ groupId, telegramUserId: targetTelegramId, count: additionCount, lastReason: reason ?? null })
    .onDuplicateKeyUpdate({ set: { count: sql`${userWarnings.count} + ${additionCount}`, lastReason: reason ?? null } });
  return (await db.select().from(userWarnings).where(and(eq(userWarnings.groupId, groupId), eq(userWarnings.telegramUserId, targetTelegramId))).limit(1))[0]?.count ?? additionCount;
}

async function removeWarnings(groupId: number, targetTelegramId: number, requestedCount: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while removing warning");
  const existing = (await db.select().from(userWarnings).where(and(eq(userWarnings.groupId, groupId), eq(userWarnings.telegramUserId, targetTelegramId))).limit(1))[0];
  const current = existing?.count ?? 0;
  const removed = Math.min(current, requestedCount);
  const remaining = Math.max(0, current - removed);
  if (existing) {
    await db.update(userWarnings).set({ count: remaining, lastReason: remaining === 0 ? null : existing.lastReason }).where(eq(userWarnings.id, existing.id));
  }
  return { removed, remaining };
}

export function moderationErrorMessage(error: unknown, context?: { userPanel?: boolean; selfPanel?: boolean }) {
  const raw = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();
  if (context?.userPanel) {
    if (raw.includes("database") || raw.includes("sql") || raw.includes("connection")) return "دریافت اطلاعات پنل موقتاً ممکن نشد؛ چند لحظه بعد دوباره تلاش کنید.";
    if (raw.includes("user not found") || raw.includes("member not found") || raw.includes("participant_id_invalid")) return "اطلاعات این کاربر در گروه پیدا نشد؛ پنل را با ریپلای روی یک پیام تازه دوباره باز کنید.";
    if (raw.includes("blocked") || raw.includes("forbidden") || raw.includes("telegram")) return "Telegram اجازهٔ دریافت اطلاعات پنل را نداد؛ عضویت و دسترسی ربات را بررسی کنید.";
    return context.selfPanel ? "بارگذاری پنل شما انجام نشد؛ چند لحظه بعد دوباره تلاش کنید." : "بارگذاری پنل کاربر انجام نشد؛ دوباره تلاش کنید.";
  }
  if (raw.includes("not enough rights") || raw.includes("chat_admin_required") || raw.includes("administrator rights")) return "ربات برای این عملیات دسترسی مدیریتی لازم را ندارد. دسترسی‌های ربات را در تنظیمات گروه بررسی کنید.";
  if (raw.includes("bot was kicked") || raw.includes("bot is not a member") || raw.includes("chat not found") || raw.includes("group is deactivated")) return "Kronos Guard در این گروه فعال نیست. ربات را دوباره به گروه اضافه و مدیر کنید، سپس فرمان را تکرار کنید.";
  if (raw.includes("user not found") || raw.includes("member not found") || raw.includes("participant_id_invalid")) return "اطلاعات این کاربر در گروه پیدا نشد. لطفاً روی یک پیام تازه از همان کاربر ریپلای کنید.";
  if (raw.includes("blocked") || raw.includes("forbidden")) return "Telegram اجازهٔ انجام این عملیات را نداد. وضعیت عضویت و دسترسی ربات را بررسی کنید.";
  if (raw.includes("database") || raw.includes("sql") || raw.includes("connection")) return "دریافت اطلاعات موقتاً ممکن نشد. چند لحظه بعد دوباره تلاش کنید.";
  return "انجام عملیات ممکن نشد. دسترسی ربات و ارتباط با Telegram را بررسی کنید؛ در صورت نیاز، هدف را با ریپلای، منشن، نام‌کاربری یا شناسهٔ عددی مشخص کنید.";
}

export function buildUserStatusCaption(input: { target: ResolvedTarget; username?: string | null; role: AccessLevel; warnings: number; muteExpiresAt?: Date | null; profilePhotoCount?: number }) {
  const mention = `<a href="tg://user?id=${input.target.telegramUserId}">${escapeHtml(input.target.displayName)}</a>`;
  const username = input.username ? `@${escapeHtml(input.username)}` : "ثبت نشده";
  const muted = input.muteExpiresAt
    ? `فعال تا ${new Intl.DateTimeFormat("fa-IR-u-ca-persian-nu-latn", { dateStyle: "medium", timeStyle: "short" }).format(input.muteExpiresAt)}`
    : "فعال نیست";
  const profilePhotos = input.profilePhotoCount === undefined ? "در دسترس نیست" : `${input.profilePhotoCount.toLocaleString("en-US")} تصویر`;
  return [
    "<b>◈ وضعیت کاربر</b>",
    `▸ کاربر: ${mention}`,
    `▸ شناسه: <code>${input.target.telegramUserId}</code>`,
    `▸ نام کاربری: ${username}`,
    `▸ مقام: <b>${accessLabel(input.role)}</b>`,
    `▸ اخطار: <b>${input.warnings.toLocaleString("en-US")}</b>`,
    `▸ سکوت: <b>${muted}</b>`,
    `▸ تصاویر پروفایل: <b>${profilePhotos}</b>`,
  ].join("\n");
}

async function loadUserStatusCaption(ctx: Context, groupId: number, target: ResolvedTarget, targetLevel: AccessLevel) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while preparing user status");
  const [identity, warnings, activeMute, profilePhotos] = await Promise.all([
    db.select().from(telegramUsers).where(eq(telegramUsers.telegramUserId, target.telegramUserId)).limit(1),
    db.select().from(userWarnings).where(and(eq(userWarnings.groupId, groupId), eq(userWarnings.telegramUserId, target.telegramUserId))).limit(1),
    db.select().from(moderationActions).where(and(eq(moderationActions.groupId, groupId), eq(moderationActions.targetTelegramId, target.telegramUserId), eq(moderationActions.action, "mute"), isNull(moderationActions.completedAt), gt(moderationActions.expiresAt, new Date()))).orderBy(desc(moderationActions.expiresAt)).limit(1),
    ctx.telegram.getUserProfilePhotos(target.telegramUserId, 0, 1).then(result => result.total_count).catch(() => undefined),
  ]);
  return buildUserStatusCaption({ target, username: identity[0]?.username, role: targetLevel, warnings: warnings[0]?.count ?? 0, muteExpiresAt: activeMute[0]?.expiresAt, profilePhotoCount: profilePhotos });
}

async function sendUserStatus(ctx: Context, groupId: number, target: ResolvedTarget, targetLevel: AccessLevel) {
  if (!ctx.chat) throw new Error("Chat unavailable while preparing user status");
  const caption = await loadUserStatusCaption(ctx, groupId, target, targetLevel);
  await replyToInitiatingAdmin(ctx, caption, "HTML");
}

async function loadUserPanelCaption(ctx: Context, groupId: number, target: ResolvedTarget, targetLevel: AccessLevel) {
  const db = await getDb();
  if (!db || !ctx.chat) throw new Error("Database unavailable while preparing user panel");
  const [identity, warnings, actions, member, kronosTitle, stats, roles] = await Promise.all([
    db.select().from(telegramUsers).where(eq(telegramUsers.telegramUserId, target.telegramUserId)).limit(1),
    db.select().from(userWarnings).where(and(eq(userWarnings.groupId, groupId), eq(userWarnings.telegramUserId, target.telegramUserId))).limit(1),
    db.select({ id: moderationActions.id }).from(moderationActions).where(and(eq(moderationActions.groupId, groupId), eq(moderationActions.targetTelegramId, target.telegramUserId))),
    db.select({ firstSeenAt: groupMembers.firstSeenAt, lastSeenAt: groupMembers.lastSeenAt, telegramRole: groupMembers.telegramRole }).from(groupMembers).where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.telegramUserId, target.telegramUserId))).limit(1),
    getKronosMemberTitle({ groupId, telegramUserId: target.telegramUserId }),
    getGroupUserActivityStats({ groupId, telegramUserId: target.telegramUserId }),
    db.select({ role: groupRoles.role }).from(groupRoles).where(and(eq(groupRoles.groupId, groupId), eq(groupRoles.telegramUserId, target.telegramUserId))),
  ]);
  let telegramRole = member[0]?.telegramRole;
  try {
    const liveMember = await ctx.telegram.getChatMember(ctx.chat.id, target.telegramUserId);
    telegramRole = liveMember.status === "creator" ? "owner" : liveMember.status === "administrator" ? "administrator" : liveMember.status === "member" ? "member" : liveMember.status === "restricted" ? "restricted" : "unknown";
  } catch {
    // Keep the last group-scoped role when Telegram cannot be queried.
  }
  let profilePhotoCount: number | undefined;
  try {
    profilePhotoCount = (await ctx.telegram.getUserProfilePhotos(target.telegramUserId, 0, 1)).total_count;
  } catch {
    profilePhotoCount = undefined;
  }
  return buildUserPanelCaption({
    displayName: target.displayName,
    telegramUserId: target.telegramUserId,
    username: identity[0]?.username,
    warningCount: warnings[0]?.count ?? 0,
    role: targetLevel,
    isVip: roles.some(row => row.role === "vip"),
    telegramRole,
    actionCount: actions.length,
    memberSince: member[0]?.firstSeenAt,
    lastSeenAt: member[0]?.lastSeenAt,
    profilePhotoCount,
    kronosTitle,
    stats,
    isSelf: ctx.from?.id === target.telegramUserId,
  });
}

async function sendUserPanel(ctx: Context, groupId: number, target: ResolvedTarget, targetLevel: AccessLevel) {
  if (!ctx.chat) throw new Error("Chat unavailable while preparing user panel");
  const caption = await loadUserPanelCaption(ctx, groupId, target, targetLevel);
  const messageId = ctx.message && "message_id" in ctx.message ? ctx.message.message_id : undefined;
  try {
    const photos = await ctx.telegram.getUserProfilePhotos(target.telegramUserId, 0, 1);
    const photoSet = photos.photos[0];
    const fileId = photoSet?.[photoSet.length - 1]?.file_id;
    if (fileId) {
      const lastUpdatedAt = new Date();
      try {
        await ctx.telegram.sendPhoto(ctx.chat.id, fileId, { caption, parse_mode: "HTML", reply_markup: userPanelRefreshKeyboard(groupId, target.telegramUserId, 0, lastUpdatedAt), ...(messageId ? { reply_parameters: { message_id: messageId } } : {}) });
      } catch (error) {
        if (!hasMissingReplyTarget(error)) throw error;
        await ctx.telegram.sendPhoto(ctx.chat.id, fileId, { caption, parse_mode: "HTML", reply_markup: userPanelRefreshKeyboard(groupId, target.telegramUserId, 0, lastUpdatedAt) });
      }
      return;
    }
  } catch (error) {
    console.warn("[Kronos Guard] profile photo unavailable for user panel", error);
  }
  await replyToInitiatingAdmin(ctx, caption, "HTML", userPanelRefreshKeyboard(groupId, target.telegramUserId, 0, new Date()));
}

export async function sendInlineSelfUserPanel(ctx: Context): Promise<boolean> {
  if (!ctx.chat || !ctx.from) return false;
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) throw new Error("Group unavailable while preparing inline user panel");
  const displayName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || String(ctx.from.id);
  const target = { telegramUserId: ctx.from.id, displayName };
  const targetLevel = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  const caption = await loadUserPanelCaption(ctx, group.id, target, targetLevel);
  const photos = await ctx.telegram.getUserProfilePhotos(ctx.from.id, 0, 1).catch(() => ({ photos: [] as Array<Array<{ file_id: string }>> }));
  const photoSet = photos.photos[0];
  const fileId = photoSet?.[photoSet.length - 1]?.file_id;
  if (fileId) {
    await ctx.telegram.sendPhoto(ctx.chat.id, fileId, { caption, parse_mode: "HTML", reply_markup: userPanelRefreshKeyboard(group.id, ctx.from.id, 0, new Date()) });
  } else {
    await ctx.reply(caption, { parse_mode: "HTML", ...userPanelRefreshKeyboard(group.id, ctx.from.id, 0, new Date()) });
  }
  return true;
}

export async function handleUserPanelLastUpdatedCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
  if (data !== USER_PANEL_LAST_UPDATED_CALLBACK) return false;
  await ctx.answerCbQuery("زمان آخرین به‌روزرسانی روی همین دکمه نمایش داده شده است.");
  return true;
}

export async function handleUserPanelRefreshCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
  if (typeof data !== "string" || !data.startsWith(USER_PANEL_REFRESH_CALLBACK_PREFIX)) return false;
  const [groupIdText, targetIdText] = data.slice(USER_PANEL_REFRESH_CALLBACK_PREFIX.length).split(":");
  const groupId = Number(groupIdText);
  const targetTelegramUserId = Number(targetIdText);
  if (!Number.isSafeInteger(groupId) || !Number.isSafeInteger(targetTelegramUserId) || !ctx.chat || !ctx.from) {
    await ctx.answerCbQuery("اطلاعات پنل معتبر نیست.", { show_alert: true });
    return true;
  }
  const key = `${ctx.chat.id}:${ctx.from.id}:${targetTelegramUserId}`;
  const now = Date.now();
  const nextAllowedAt = userPanelRefreshCooldowns.get(key) ?? 0;
  if (nextAllowedAt > now) {
    const seconds = Math.ceil((nextAllowedAt - now) / 1000);
    await ctx.answerCbQuery(`تازه‌سازی بعد از ${seconds} ثانیه ممکن است.`, { show_alert: true });
    return true;
  }
  const actorLevel = await resolveAccessLevel({ groupId, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  if (!hasAtLeastAccess(actorLevel, "moderator")) {
    await ctx.answerCbQuery("این پنل فقط برای مدیران مجاز است.", { show_alert: true });
    return true;
  }
  const expiresAt = now + USER_PANEL_REFRESH_TIMEOUT_MS;
  userPanelRefreshCooldowns.set(key, expiresAt);
  try {
    const callbackMessage = ctx.callbackQuery && "message" in ctx.callbackQuery ? ctx.callbackQuery.message : undefined;
    const group = await findGroupByChatId(ctx.chat.id);
    if (!group || group.id !== groupId) { await ctx.answerCbQuery("گروه پنل معتبر نیست.", { show_alert: true }); return true; }
    const db = await getDb();
    const identity = db ? (await db.select({ firstName: telegramUsers.firstName, lastName: telegramUsers.lastName }).from(telegramUsers).where(eq(telegramUsers.telegramUserId, targetTelegramUserId)).limit(1))[0] : undefined;
    const displayName = [identity?.firstName, identity?.lastName].filter(Boolean).join(" ") || String(targetTelegramUserId);
    const targetLevel = await resolveAccessLevel({ groupId, groupChatId: ctx.chat.id, telegramUserId: targetTelegramUserId }, ctx.telegram);
    const caption = await loadUserPanelCaption(ctx, groupId, { telegramUserId: targetTelegramUserId, displayName }, targetLevel);
    const refreshedAt = new Date(now);
    const replyMarkup = userPanelRefreshKeyboard(groupId, targetTelegramUserId, 0, refreshedAt);
    if (ctx.callbackQuery && "message" in ctx.callbackQuery && ctx.callbackQuery.message && "photo" in ctx.callbackQuery.message) {
      await ctx.editMessageCaption(caption, { parse_mode: "HTML", reply_markup: replyMarkup });
    } else {
      await ctx.editMessageText(caption, { parse_mode: "HTML", reply_markup: replyMarkup });
    }
    scheduleUserPanelRefreshCountdown(ctx, groupId, targetTelegramUserId, expiresAt, refreshedAt);
    await ctx.answerCbQuery("پنل با دادهٔ تازه به‌روزرسانی شد؛ شمارش معکوس 10 ثانیه‌ای آغاز شد.");
  } catch (error) {
    console.error("[Kronos Guard] user panel refresh failed", error);
    const callbackMessage = ctx.callbackQuery && "message" in ctx.callbackQuery ? ctx.callbackQuery.message : undefined;
    const existingCaption = callbackMessage && "caption" in callbackMessage ? callbackMessage.caption : undefined;
    const existingText = callbackMessage && "text" in callbackMessage ? callbackMessage.text : undefined;
    const warning = existingCaption ?? existingText;
    try {
      if (warning) {
        if (callbackMessage && "photo" in callbackMessage) {
          await ctx.editMessageCaption(appendUserPanelRefreshError(warning), { parse_mode: "HTML" });
        } else {
          await ctx.editMessageText(appendUserPanelRefreshError(warning), { parse_mode: "HTML" });
        }
      }
    } catch (warningError) {
      console.warn("[Kronos Guard] could not render user panel refresh warning", warningError);
    }
    try {
      await ctx.editMessageReplyMarkup(userPanelRefreshKeyboard(groupId, targetTelegramUserId, Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))));
    } catch (markupError) {
      console.warn("[Kronos Guard] could not restore user panel refresh button", markupError);
    }
    await ctx.answerCbQuery(USER_PANEL_REFRESH_ERROR_TEXT, { show_alert: true });
  }
  return true;
}

async function isVipTarget(groupId: number, telegramUserId: number) {
  return Boolean(await import("./vipProtection").then(({ getVipProtectionPolicy }) => getVipProtectionPolicy(groupId, telegramUserId)));
}

async function warningPolicy(groupId: number) {
  const db = await getDb();
  if (!db) return { warnLimit: 3, warnAction: "mute" as const, warnMuteMinutes: 0 };
  const settings = (await db.select().from(groupSettings).where(eq(groupSettings.groupId, groupId)).limit(1))[0];
  return { warnLimit: settings?.warnLimit ?? 3, warnAction: settings?.warnAction ?? "mute", warnMuteMinutes: settings?.warnMuteMinutes ?? 0 };
}

/** A zero value is the explicit permanent-mute policy for automatic warning escalation. */
export function warningEscalationMuteExpiry(warnMuteMinutes: number, now = Date.now()) {
  return warnMuteMinutes > 0 ? new Date(now + warnMuteMinutes * 60_000) : undefined;
}

async function executeAction(ctx: Context, command: ParsedModerationCommand, target: ResolvedTarget, groupId: number) {
  const chatId = ctx.chat!.id;
  let expiresAt: Date | undefined;
  if (command.action === "ban") {
    expiresAt = command.durationSeconds ? new Date(Date.now() + command.durationSeconds * 1000) : undefined;
    await ctx.telegram.banChatMember(chatId, target.telegramUserId, expiresAt ? Math.floor(expiresAt.getTime() / 1000) : undefined);
  } else if (command.action === "kick") {
    await ctx.telegram.banChatMember(chatId, target.telegramUserId);
    await ctx.telegram.unbanChatMember(chatId, target.telegramUserId, { only_if_banned: true });
  } else if (command.action === "mute") {
    const durationSeconds = command.durationSeconds ?? 3600;
    expiresAt = command.permanentMute ? undefined : new Date(Date.now() + durationSeconds * 1000);
    await ctx.telegram.restrictChatMember(chatId, target.telegramUserId, { permissions: mutePermissions(), ...(expiresAt ? { until_date: Math.floor(expiresAt.getTime() / 1000) } : {}) });
  } else if (command.action === "unmute") {
    const member = await ctx.telegram.getChatMember(chatId, target.telegramUserId);
    const isActuallyMuted = member.status === "restricted" && member.can_send_messages === false;
    const db = await getDb();
    const activeMute = db ? (await db.select({ id: moderationActions.id }).from(moderationActions).where(and(eq(moderationActions.groupId, groupId), eq(moderationActions.targetTelegramId, target.telegramUserId), eq(moderationActions.action, "mute"), isNull(moderationActions.completedAt), gt(moderationActions.expiresAt, new Date()))).limit(1))[0] : undefined;
    if (!isActuallyMuted && !activeMute) return { expiresAt, warningCount: undefined, escalated: false, noOp: "unmute_not_active" as const };
    const chat = await ctx.telegram.getChat(chatId) as { permissions?: Record<string, boolean> };
    await ctx.telegram.restrictChatMember(chatId, target.telegramUserId, { permissions: chat.permissions ?? unrestrictedPermissions(), until_date: 0 });
    if (db) await db.update(moderationActions).set({ completedAt: new Date() }).where(and(eq(moderationActions.groupId, groupId), eq(moderationActions.targetTelegramId, target.telegramUserId), eq(moderationActions.action, "mute"), isNull(moderationActions.completedAt)));
  } else if (command.action === "unban") {
    const member = await ctx.telegram.getChatMember(chatId, target.telegramUserId);
    const isActuallyBanned = member.status === "kicked";
    if (!isActuallyBanned) return { expiresAt, warningCount: undefined, escalated: false, noOp: "unban_not_active" as const };
    await ctx.telegram.unbanChatMember(chatId, target.telegramUserId, { only_if_banned: true });
  } else if (command.action === "warn") {
    const warningCount = await issueWarning(groupId, target.telegramUserId, command.reason, command.warningAdditionCount ?? 1);
    const policy = await warningPolicy(groupId);
    if (warningCount >= policy.warnLimit) {
      const escalationKey = policy.warnAction === "ban" ? "protectBan" : "protectMute";
      if (await isVipProtected(groupId, target.telegramUserId, escalationKey)) {
        return { expiresAt, warningCount, escalated: false, protectedEscalation: true as const };
      }
      if (policy.warnAction === "ban") {
        await ctx.telegram.banChatMember(chatId, target.telegramUserId);
      } else {
        expiresAt = warningEscalationMuteExpiry(policy.warnMuteMinutes);
        await ctx.telegram.restrictChatMember(chatId, target.telegramUserId, {
          permissions: mutePermissions(),
          ...(expiresAt ? { until_date: Math.floor(expiresAt.getTime() / 1000) } : {}),
        });
      }
    }
    return { expiresAt, warningCount, escalated: warningCount >= policy.warnLimit };
  } else if (command.action === "unwarn") {
    const result = await removeWarnings(groupId, target.telegramUserId, command.warningRemovalCount ?? 1);
    return { expiresAt, warningCount: result.remaining, escalated: false, ...(result.removed === 0 ? { noOp: "unwarn_no_active_warnings" as const } : {}) };
  }
  return { expiresAt, warningCount: undefined, escalated: false };
}

/** Interprets and executes moderation text in group chats, returning true when the message was a moderation command. */
export async function resolveUserPanelTarget(ctx: Context, command: ParsedModerationCommand): Promise<ResolvedTarget | undefined> {
  if (command.action !== "panel") return resolveModerationTarget(ctx, command);
  if (!ctx.from) return undefined;
  if (!command.target) {
    return {
      telegramUserId: ctx.from.id,
      displayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || String(ctx.from.id),
    };
  }
  return resolveModerationTarget(ctx, command);
}

export async function handleModerationCommand(ctx: Context): Promise<boolean> {
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") || !ctx.from || !ctx.message || !("text" in ctx.message)) return false;
  // Telegram can attach reply metadata to any message subtype. Read it from the
  // update itself instead of depending on command text or entity parsing.
  const replyTarget = "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
  const command = parseModerationCommand(prepareTargetAwareCommandText(ctx.message), Boolean(replyTarget));
  if (!command) return false;

  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) return false;
  const actorLevelPromise = resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  if (command.action === "mute_list") {
    const actorLevel = await actorLevelPromise;
    if (!hasAtLeastAccess(actorLevel, "moderator")) { await replyToInitiatingAdmin(ctx, NON_MODERATOR_COMMAND_REPLY); return true; }
    const db = await getDb();
    const rows = db ? await db.select({ targetTelegramId: moderationActions.targetTelegramId, expiresAt: moderationActions.expiresAt }).from(moderationActions).where(and(eq(moderationActions.groupId, group.id), eq(moderationActions.action, "mute"), isNull(moderationActions.completedAt), or(isNull(moderationActions.expiresAt), gt(moderationActions.expiresAt, new Date())))).orderBy(desc(moderationActions.createdAt)).limit(50) : [];
    const lines = rows.map((row, index) => `${index + 1}. <a href="tg://user?id=${row.targetTelegramId}">کاربر</a> — ${row.expiresAt ? `تا ${row.expiresAt.toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })}` : "دائمی"}`);
    await replyToInitiatingAdmin(ctx, lines.length ? `<b>لیست سکوت</b>\n\n${lines.join("\n")}` : "در حال حاضر کاربرِ ساکت فعالی وجود ندارد.", "HTML", undefined, { temporarySuccess: true });
    return true;
  }
  const isPanelCommand = command.action === "panel";

  // A bare panel command is a self-service view: use the sender when no
  // explicit target was supplied. Explicit reply/mention/ID targets still win.
  const target = await resolveUserPanelTarget(ctx, command);
  if (!target) {
    await replyToInitiatingAdmin(ctx, "کاربر هدف مشخص نیست. روی پیام او ریپلای کنید یا @username / شناسه عددی را وارد کنید.");
    return true;
  }
  const targetLevelPromise = resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: target.telegramUserId }, ctx.telegram);
  const [actorLevel, targetLevel]: [AccessLevel, AccessLevel] = await Promise.all([actorLevelPromise, targetLevelPromise]);
  if (!isPanelCommand && !hasAtLeastAccess(actorLevel, "moderator")) {
    await replyToInitiatingAdmin(ctx, NON_MODERATOR_COMMAND_REPLY);
    return true;
  }
  if (!isPanelCommand && command.action !== "status" && !mayModerateTarget(actorLevel, targetLevel)) {
    await replyToInitiatingAdmin(ctx, moderationHierarchyDeniedReply(actorLevel, targetLevel));
    return true;
  }

  const vipProtectionKey = vipProtectionKeyForAction(command.action);
  if (vipProtectionKey && await isVipProtected(group.id, target.telegramUserId, vipProtectionKey)) {
    await replyToInitiatingAdmin(ctx, buildVipProtectionMessage(target), "HTML");
    return true;
  }

  try {
    if (command.action === "panel") {
      await sendUserPanel(ctx, group.id, target, targetLevel);
      await writeAuditLog({ category: "moderation", event: "user_panel_viewed", groupId: group.id, actorTelegramId: ctx.from.id, subjectTelegramId: target.telegramUserId, details: { alias: command.sourceAlias, self: target.telegramUserId === ctx.from.id } });
      return true;
    }
    if (command.action === "status") {
      await sendUserStatus(ctx, group.id, target, targetLevel);
      await writeAuditLog({ category: "moderation", event: "status_viewed", groupId: group.id, actorTelegramId: ctx.from.id, subjectTelegramId: target.telegramUserId, details: { alias: command.sourceAlias } });
      return true;
    }
    const result = await executeAction(ctx, command, target, group.id);
    if (result.noOp) {
      await writeAuditLog({ category: "moderation", event: "no_op", groupId: group.id, actorTelegramId: ctx.from.id, subjectTelegramId: target.telegramUserId, details: { alias: command.sourceAlias, reason: result.noOp } });
      await replyToInitiatingAdmin(ctx, buildModerationActionMessage(command, target, result.warningCount, result.escalated, new Date(), { noActiveMute: result.noOp === "unmute_not_active", noActiveWarnings: result.noOp === "unwarn_no_active_warnings", noActiveBan: result.noOp === "unban_not_active" }), "HTML");
      return true;
    }
    await recordAction({ groupId: group.id, actorTelegramId: ctx.from.id, targetTelegramId: target.telegramUserId, command, expiresAt: result.expiresAt });
    await writeAuditLog({ category: "moderation", event: command.action, groupId: group.id, actorTelegramId: ctx.from.id, subjectTelegramId: target.telegramUserId, details: { alias: command.sourceAlias, special: command.specialResponse ?? null } });
    await notifyGroupEvent({
      groupId: group.id,
      eventType: `moderation.${command.action}`,
      actor: { telegramUserId: ctx.from.id, displayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || String(ctx.from.id), username: ctx.from.username },
      subject: { telegramUserId: target.telegramUserId, displayName: target.displayName },
      details: {
        reason: command.reason,
        summary: command.action === "warn" && result.warningCount !== undefined
          ? `${result.warningCount.toLocaleString("en-US")} اخطار فعال ثبت شد${result.escalated ? " و آستانهٔ اقدام خودکار اعمال شد." : "."}`
          : result.escalated ? "آستانهٔ اخطار فعال شد و اقدام حفاظتی خودکار اجرا شد." : undefined,
      },
      eventKey: `moderation:${group.id}:${command.action}:${target.telegramUserId}:${ctx.message.message_id}`,
      telegram: ctx.telegram,
    });
    await replyToInitiatingAdmin(ctx, buildModerationActionMessage(command, target, result.warningCount, result.escalated || Boolean(result.protectedEscalation)), "HTML", undefined, { temporarySuccess: true });
  } catch (error) {
    console.error("[Kronos Guard] moderation action failed", error);
    await replyToInitiatingAdmin(ctx, moderationErrorMessage(error, { userPanel: isPanelCommand, selfPanel: isPanelCommand && target.telegramUserId === ctx.from.id }));
  }
  return true;
}
