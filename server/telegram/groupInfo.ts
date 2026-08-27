import type { Context } from "telegraf";
import { randomBytes } from "node:crypto";
import type { InlineKeyboardMarkup } from "telegraf/types";
import { and, eq } from "drizzle-orm";
import { contentLocks } from "../../drizzle/schema";
import { getDb } from "../db";
import { hasAtLeastAccess, hasKronosModerationAccess, resolveAccessLevel } from "./authorization";
import { OWNER_TELEGRAM_ID, type AccessLevel } from "./constants";
import { findGroupByChatId, isGlobalAdmin, writeAuditLog } from "./repository";
import { replySafely, shouldEditTelegramMessage } from "./replySafe";
import { withTelegramButtonStyle, type TelegramButtonStyle } from "./buttonStyle";
import { getOrLoadGroupChatMetadata } from "./groupChatMetadataCache";

const LINK_PREVIEW_DISABLED = { link_preview_options: { is_disabled: true } as const };

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Telegram accepts a file_id string here, never the complete ChatPhoto object. */
export function telegramPhotoFileId(photo: unknown): string | null {
  if (!photo || typeof photo !== "object") return null;
  const candidate = (photo as { big_file_id?: unknown }).big_file_id;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

export type GroupLinkPhotoDelivery = {
  photoFileId: string | null;
  caption: string;
  replyMarkup: InlineKeyboardMarkup;
};

/**
 * Sends the visual link card as Telegram media. The profile photo is the
 * message media and the generated link card is its caption; it must not be
 * silently downgraded to a text-only message when Telegram rejects a cached
 * file_id, so a fresh file URL is attempted once before reporting failure.
 */
type GroupPhotoTelegram = Pick<Context["telegram"], "sendPhoto" | "getFileLink"> & {
  getFile?: (fileId: string) => Promise<{ file_path?: string }>;
};

export async function sendGroupLinkPhoto(
  telegram: GroupPhotoTelegram,
  chatId: number | string,
  delivery: GroupLinkPhotoDelivery,
) {
  if (!delivery.photoFileId) return null;
  const options = { caption: delivery.caption, parse_mode: "HTML" as const, reply_markup: delivery.replyMarkup, ...LINK_PREVIEW_DISABLED };
  try {
    return await telegram.sendPhoto(chatId, delivery.photoFileId, options);
  } catch (firstError) {
    try {
      const fileInfo = telegram.getFile ? await telegram.getFile(delivery.photoFileId) : undefined;
      const freshPhotoUrl = await telegram.getFileLink(delivery.photoFileId);
      const response = await fetch(freshPhotoUrl.toString());
      if (!response.ok) throw new Error(`profile photo download failed with HTTP ${response.status}`);
      const photoBytes = Buffer.from(await response.arrayBuffer());
      const filename = fileInfo?.file_path?.split("/").pop() || "kronos-group-profile.jpg";
      return await telegram.sendPhoto(chatId, { source: photoBytes, filename }, options);
    } catch (secondError) {
      console.error("[Kronos Guard] group link photo delivery failed", { firstError, secondError });
      return null;
    }
  }
}

/** Sends the replacement first; the old menu is removed only after success. */
export async function replaceLinkMenuWithPhoto(
  telegram: GroupPhotoTelegram & Pick<Context["telegram"], "deleteMessage">,
  chatId: number | string,
  menuMessageId: number,
  delivery: GroupLinkPhotoDelivery,
) {
  const sent = await sendGroupLinkPhoto(telegram, chatId, delivery);
  if (!sent) return null;
  await telegram.deleteMessage(chatId, menuMessageId).catch(error => {
    console.error("[Kronos Guard] old link menu cleanup failed", error);
  });
  return sent;
}

function faNumber(value: number) {
  return new Intl.NumberFormat("fa-IR").format(value);
}

export type GroupProfileCaptionInput = {
  title: string;
  username?: string | null;
  description?: string | null;
  memberCount?: number;
  type: string;
  chatId: number;
  botStatus: string;
  activeLockCount: number;
  inviteLink?: string | null;
};

/** Public, non-sensitive marker used to prove the link-authorization policy deployed to production. */
export const GROUP_LINK_ACCESS_POLICY_REVISION = "live-telegram-authority-r6-command-audit";

export function isGroupLinkCommand(text: string) {
  const normalized = text.trim().toLocaleLowerCase("fa-IR");
  return ["لینک", "لینک گروه", "گپ", "اطلاعات گپ", "پروفایل گپ", "مشخصات گپ"].includes(normalized);
}

export function isGroupStatusCommand(text: string) {
  const normalized = text.trim().toLocaleLowerCase("fa-IR");
  return normalized === "وضعیت گروه" || normalized === "group status";
}

export function groupStatusActorUnavailableMessage() {
  return "⚠️ شناسهٔ فرستندهٔ این پیام توسط تلگرام قابل تشخیص نیست. لطفاً حالت ناشناس ادمین را خاموش کنید و دوباره «وضعیت گروه» را بفرستید.";
}

export function buildGroupStatusCaption(input: { groupStatus: string; botStatus: string; activeLockCount: number }) {
  const status = input.groupStatus === "active" ? "فعال" : input.groupStatus === "removed" ? "حذف‌شده" : input.groupStatus === "permission_lost" ? "دسترسی از دست رفته" : input.groupStatus || "ثبت نشده";
  return `<b>📊 وضعیت گروه</b>\n\n<b>وضعیت ثبت در ربات:</b> ${status}\n<b>وضعیت ربات در گروه:</b> ${botStatusLabel(input.botStatus)}\n<b>قفل‌های فعال محتوا:</b> ${faNumber(Math.max(0, input.activeLockCount))}`;
}

export function groupLinkActorUnavailableMessage() {
  return "⚠️ شناسهٔ فرستندهٔ این پیام توسط تلگرام قابل تشخیص نیست. لطفاً حالت ناشناس ادمین را خاموش کنید و دوباره «لینک» را بفرستید.";
}

export function isGroupLinkActorAllowed(input: { telegramUserId: number; ownerTelegramId?: number | null; memberStatus?: string | null }) {
  const actorId = Number(input.telegramUserId);
  const registeredOwnerId = input.ownerTelegramId == null ? null : Number(input.ownerTelegramId);
  return actorId === OWNER_TELEGRAM_ID || (registeredOwnerId !== null && actorId === registeredOwnerId) || isTelegramGroupAdminStatus(input.memberStatus);
}

/**
 * Telegram omits `from` when an administrator sends a group message anonymously.
 * A sender chat matching the current group can only be produced by that group's
 * anonymous administrator mode; linked-channel posts use a different chat id and
 * remain ineligible. This permits the safe read/link workflow without granting
 * access to an unidentified external sender.
 */
export function isAnonymousGroupAdministratorLinkMessage(ctx: Pick<Context, "chat" | "from" | "message">) {
  if (ctx.from || !ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") || !ctx.message || !("text" in ctx.message) || !isGroupLinkCommand(ctx.message.text)) return false;
  const senderChat = "sender_chat" in ctx.message ? ctx.message.sender_chat : undefined;
  return senderChat?.id === ctx.chat.id;
}

/**
 * Link creation is available to Telegram group leadership and delegated Kronos
 * management roles. Internal owners and administrators resolve to at least the
 * `moderator` tier, allowing their explicitly granted bot authority to work
 * even when Telegram still reports them as regular group members.
 */
export function isGroupLinkAccessLevelAllowed(access: AccessLevel) {
  return hasAtLeastAccess(access, "moderator");
}

export function isGroupInformationAccessLevelAllowed(access: AccessLevel) {
  return hasKronosModerationAccess(access);
}

async function hasGroupLinkAccess(ctx: Context, group?: { id: number; ownerTelegramId: number | null }) {
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) return false;
  if (!ctx.from) return isAnonymousGroupAdministratorLinkMessage(ctx);
  const actorTelegramId = ctx.from.id;

  if (group) {
    // Keep this command on the same live-Telegram-first policy used by the
    // working moderation tools. The previous, bespoke lookup could reject a
    // real group owner/admin whenever cached rows were stale or incomplete.
    const access = await resolveAccessLevel({
      groupId: group.id,
      groupChatId: Number(ctx.chat.id),
      telegramUserId: actorTelegramId,
    }, ctx.telegram).catch(error => {
      console.warn("[Kronos Guard] central link access lookup failed", error);
      return "user" as const;
    });
    if (isGroupLinkAccessLevelAllowed(access)) return true;
  }

  // The sole bot owner and explicitly delegated global administrators retain
  // their bot-wide authority even before a group row is available.
  if (actorTelegramId === OWNER_TELEGRAM_ID) return true;

  try {
    if (await isGlobalAdmin(actorTelegramId)) return true;
  } catch (error) {
    console.warn("[Kronos Guard] fallback link access lookup failed", error);
  }
  const member = await ctx.telegram.getChatMember(ctx.chat.id, actorTelegramId).catch(() => null);
  if (isTelegramGroupAdminStatus(member?.status)) return true;

  // Some Telegram clients and transient Bot API states can return an incomplete
  // single-member record. Verify against the authoritative administrator roster
  // before denying a valid owner/admin. This fallback is shared by message entry
  // and inline callback paths, including a temporary database lookup miss.
  const getAdministrators = (ctx.telegram as Context["telegram"] & {
    getChatAdministrators?: (chatId: number) => Promise<Array<{ user?: { id?: number }; status?: string }>>;
  }).getChatAdministrators;
  if (getAdministrators) {
    const administrators = await getAdministrators.call(ctx.telegram, ctx.chat.id).catch(error => {
      console.warn("[Kronos Guard] link administrator roster lookup failed", error);
      return [];
    });
    if (administrators.some(administrator => administrator.user?.id === actorTelegramId && isTelegramGroupAdminStatus(administrator.status))) return true;
  }
  return false;
}

function groupLinkAccessDeniedDetails(
  ctx: Context,
  input: { group?: { id: number; ownerTelegramId: number | null } | null; anonymousGroupAdministrator: boolean },
) {
  const message = ctx.message;
  const messageFromId = message && "from" in message ? message.from?.id ?? null : null;
  const senderChatId = message && "sender_chat" in message ? message.sender_chat?.id ?? null : null;
  return {
    policyRevision: GROUP_LINK_ACCESS_POLICY_REVISION,
    chatId: ctx.chat?.id ?? null,
    contextFromId: ctx.from?.id ?? null,
    messageFromId,
    senderChatId,
    registeredGroupId: input.group?.id ?? null,
    registeredOwnerTelegramId: input.group?.ownerTelegramId ?? null,
    anonymousGroupAdministrator: input.anonymousGroupAdministrator,
  };
}

async function recordGroupLinkAccessDenied(
  ctx: Context,
  input: { group?: { id: number; ownerTelegramId: number | null } | null; anonymousGroupAdministrator: boolean },
) {
  await writeAuditLog({
    severity: "warning",
    category: "group_info",
    event: "link_access_denied",
    groupId: input.group?.id,
    actorTelegramId: ctx.from?.id,
    details: groupLinkAccessDeniedDetails(ctx, input),
  }).catch(error => console.error("[Kronos Guard] link access denial audit failed", error));
}

export function isTelegramGroupAdminStatus(status: string | null | undefined) {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  return normalized === "administrator" || normalized === "creator" || normalized === "owner";
}

function groupTypeLabel(type: string) {
  if (type === "supergroup") return "سوپرگروه";
  if (type === "group") return "گروه معمولی";
  return type || "ثبت نشده";
}

function botStatusLabel(status: string) {
  if (status === "administrator" || status === "creator") return "مدیر";
  if (status === "member") return "عضو معمولی";
  if (status === "restricted") return "دسترسی محدود";
  return "قابل تشخیص نیست";
}

export function buildGroupProfileCaption(input: GroupProfileCaptionInput) {
  const title = escapeHtml(input.title || "گروه بدون نام");
  const username = input.username ? `@${escapeHtml(input.username)}` : "ثبت نشده";
  const directLink = input.username ? `https://t.me/${encodeURIComponent(input.username)}` : "لینک دعوت در حال دریافت است";
  const description = input.description ? escapeHtml(input.description) : "ثبت نشده";
  const memberCount = input.memberCount === undefined ? "در دسترس نیست" : faNumber(input.memberCount);
  const activeLocks = faNumber(Math.max(0, input.activeLockCount));
  const shareLink = input.username ? directLink : input.inviteLink ? escapeHtml(input.inviteLink) : "برای این گروه لینک عمومی یا دعوت قابل دریافت نیست";
  return `<b>📋 پروفایل گروه</b>\n\n<b>نام:</b> ${title}\n<b>نام کاربری:</b> ${username}\n<b>لینک آمادهٔ اشتراک:</b> ${shareLink}\n<b>توضیحات:</b> ${description}\n<b>تعداد اعضا:</b> ${memberCount}\n<b>نوع گروه:</b> ${groupTypeLabel(input.type)}\n<b>شناسهٔ گروه:</b> <code>${input.chatId}</code>\n<b>وضعیت ربات:</b> ${botStatusLabel(input.botStatus)}\n<b>قفل‌های فعال:</b> ${activeLocks}`;
}

type TelegramGroupChat = {
  id: number;
  type: "group" | "supergroup";
  title: string;
  username?: string;
  description?: string;
  photo?: { big_file_id?: string };
};

export async function getGroupChatWithFallback(
  telegram: Pick<Context["telegram"], "getChat">,
  chat: TelegramGroupChat,
): Promise<TelegramGroupChat> {
  try {
    return await getOrLoadGroupChatMetadata(chat.id, async () => await telegram.getChat(chat.id) as TelegramGroupChat);
  } catch {
    // Never cache fallback metadata: a later request should be able to recover
    // fresh profile photo and biography data after a transient Telegram error.
    return chat;
  }
}

export async function handleGroupStatusCommand(ctx: Context): Promise<boolean> {
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") || !ctx.message || !("text" in ctx.message) || !isGroupStatusCommand(ctx.message.text)) return false;
  if (!ctx.from) {
    await replySafely(ctx, groupStatusActorUnavailableMessage(), { reply_parameters: { message_id: ctx.message.message_id } });
    return true;
  }
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) {
    await replySafely(ctx, "این گروه هنوز راه‌اندازی نشده است. ابتدا «setup» را ارسال کنید.", { reply_parameters: { message_id: ctx.message.message_id } });
    return true;
  }
  const actorLevel = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  if (!isGroupInformationAccessLevelAllowed(actorLevel)) {
    await replySafely(ctx, "این دستور فقط برای مدیران مجاز گروه یا Kronos قابل استفاده است.", { reply_parameters: { message_id: ctx.message.message_id } });
    return true;
  }
  try {
    const botIdentity = await ctx.telegram.getMe();
    const [botMember, db] = await Promise.all([
      ctx.telegram.getChatMember(ctx.chat.id, botIdentity.id).catch(() => ({ status: "unknown" })),
      getDb(),
    ]);
    const activeLockCount = db ? (await db.select({ id: contentLocks.id }).from(contentLocks).where(and(eq(contentLocks.groupId, group.id), eq(contentLocks.enabled, true)))).length : 0;
    const caption = buildGroupStatusCaption({ groupStatus: group.status, botStatus: botMember.status, activeLockCount });
    await replySafely(ctx, caption, { parse_mode: "HTML", reply_parameters: { message_id: ctx.message.message_id } });
    await writeAuditLog({ category: "group_info", event: "status_viewed", groupId: group.id, actorTelegramId: ctx.from.id, details: { alias: "وضعیت گروه" } });
  } catch (error) {
    console.error("[Kronos Guard] group status failed", error);
    await replySafely(ctx, "وضعیت گروه در حال حاضر قابل دریافت نیست. لطفاً کمی بعد دوباره تلاش کنید.", { reply_parameters: { message_id: ctx.message.message_id } });
  }
  return true;
}

export async function handleGroupLinkCommand(ctx: Context): Promise<boolean> {
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") || !ctx.message || !("text" in ctx.message) || !isGroupLinkCommand(ctx.message.text)) return false;
  const anonymousGroupAdministrator = isAnonymousGroupAdministratorLinkMessage(ctx);
  if (!ctx.from && !anonymousGroupAdministrator) {
    await replySafely(ctx, groupLinkActorUnavailableMessage(), { reply_parameters: { message_id: ctx.message.message_id } });
    return true;
  }
  // A transient database failure must not abort a command whose update already
  // carries enough Telegram metadata for a safe administrator-only response.
  const group = await findGroupByChatId(ctx.chat.id).catch(error => {
    console.error("[Kronos Guard] group lookup failed", error);
    return null;
  });
  if (!group) {
    // A group can be present in Telegram before its setup record is written or
    // after a transient database miss. Verify the actor directly, then render
    // truthful chat metadata without inventing database-backed lock information.
    if (!anonymousGroupAdministrator && !(await hasGroupLinkAccess(ctx))) {
      await recordGroupLinkAccessDenied(ctx, { group: null, anonymousGroupAdministrator });
      await replySafely(ctx, "این گروه هنوز راه‌اندازی نشده است. ابتدا «setup» را ارسال کنید.", { reply_parameters: { message_id: ctx.message.message_id } });
      return true;
    }
    try {
      const chat = await getGroupChatWithFallback(ctx.telegram, ctx.chat as TelegramGroupChat);
      const botIdentity = await ctx.telegram.getMe().catch(() => null);
      const [memberCount, botMember, inviteLink] = await Promise.all([
        ctx.telegram.getChatMembersCount(ctx.chat.id).catch(() => undefined),
        botIdentity ? ctx.telegram.getChatMember(ctx.chat.id, botIdentity.id).catch(() => ({ status: "unknown" })) : Promise.resolve({ status: "unknown" }),
        ctx.telegram.exportChatInviteLink(ctx.chat.id).catch(() => null),
      ]);
      const caption = buildGroupProfileCaption({ title: chat.title, username: chat.username, description: chat.description, memberCount, type: chat.type, chatId: chat.id, botStatus: botMember.status, activeLockCount: 0, inviteLink });
      await replySafely(ctx, caption, { parse_mode: "HTML", reply_parameters: { message_id: ctx.message.message_id } });
    } catch (error) {
      console.error("[Kronos Guard] unregistered group profile failed", error);
      await replySafely(ctx, "اطلاعات پروفایل گروه در حال حاضر قابل دریافت نیست. لطفاً کمی بعد دوباره تلاش کنید.", { reply_parameters: { message_id: ctx.message.message_id } });
    }
    return true;
  }
  if (!anonymousGroupAdministrator && !(await hasGroupLinkAccess(ctx, group))) {
    await recordGroupLinkAccessDenied(ctx, { group, anonymousGroupAdministrator });
    await replySafely(ctx, "این دستور فقط برای مالک یا مدیر گروه قابل استفاده است.", { reply_parameters: { message_id: ctx.message.message_id } });
    return true;
  }

  try {
    // Telegram can reject getChat for groups whose membership/cache state is
    // temporarily stale even though the update already contains usable chat
    // metadata. Prefer that metadata over turning a recoverable request into
    // the generic "unavailable" response.
    const chat = await getGroupChatWithFallback(ctx.telegram, ctx.chat as TelegramGroupChat);
    const botIdentity = await ctx.telegram.getMe().catch(() => null);
    const [memberCount, botMember, inviteLink, db] = await Promise.all([
      ctx.telegram.getChatMembersCount(ctx.chat.id).catch(() => undefined),
      botIdentity ? ctx.telegram.getChatMember(ctx.chat.id, botIdentity.id).catch(() => ({ status: "unknown" })) : Promise.resolve({ status: "unknown" }),
      ctx.telegram.exportChatInviteLink(ctx.chat.id).catch(() => null),
      getDb().catch(() => null),
    ]);
    const activeLockCount = db ? await db.select({ id: contentLocks.id }).from(contentLocks).where(and(eq(contentLocks.groupId, group.id), eq(contentLocks.enabled, true))).then(rows => rows.length).catch(() => 0) : 0;
    const caption = LINK_MENU_TEXT;
    const replyParameters = { reply_parameters: { message_id: ctx.message.message_id } };
    const photoFileId = telegramPhotoFileId(chat.photo);
    if (photoFileId) {
      await ctx.telegram.sendPhoto(ctx.chat.id, photoFileId, { caption, parse_mode: "HTML", reply_markup: groupLinkModeKeyboard(), ...replyParameters }).catch(() => replySafely(ctx, caption, { parse_mode: "HTML", reply_markup: groupLinkModeKeyboard(), ...replyParameters }));
    } else {
      await replySafely(ctx, caption, { parse_mode: "HTML", reply_markup: groupLinkModeKeyboard(), ...replyParameters });
    }
    await writeAuditLog({ category: "group_info", event: "profile_viewed", groupId: group.id, actorTelegramId: ctx.from?.id, details: { alias: "لینک", anonymousGroupAdministrator } }).catch(error => console.error("[Kronos Guard] group profile audit failed", error));
  } catch (error) {
    console.error("[Kronos Guard] group profile card failed", error);
    await replySafely(ctx, "اطلاعات پروفایل گروه در حال حاضر قابل دریافت نیست. لطفاً کمی بعد دوباره تلاش کنید.", { reply_parameters: { message_id: ctx.message.message_id } });
  }
  return true;
}

export type GroupLinkMode = "text" | "image" | "once" | "request";
type GroupLinkAction = GroupLinkMode | "share" | "private" | "revoke" | "revoke-confirm" | "revoke-yes" | "revoke-no" | "back" | "guide" | "close";

const BACK_LABEL = "◁ بازگشت";
const LINK_MENU_TEXT = "<b>─┅━ مرکز ساخت لینک Kronos Guard ━┅─</b>";
const LINK_IMAGE_PROCESSING_TEXT = "<b>⏳ در حال آماده‌سازی لینک تصویری...</b>\n\nپروفایل گروه، بیوگرافی و لینک دعوت در حال دریافت است.";
const linkState = new Map<string, { link: string; mode: GroupLinkMode }>();
const linkStateKey = (chatId: number | string, messageId: number) => `${chatId}:${messageId}`;

const KRONOS_GUARD_BOT_URL = "https://t.me/kronosguard_bot";
const PRIVATE_LINK_TRANSFER_TTL_MS = 10 * 60 * 1000;
const privateLinkTransfers = new Map<string, { text: string; expiresAt: number }>();

function prunePrivateLinkTransfers(now = Date.now()) {
  privateLinkTransfers.forEach((transfer, token) => {
    if (transfer.expiresAt <= now) privateLinkTransfers.delete(token);
  });
  while (privateLinkTransfers.size > 500) {
    const oldest = privateLinkTransfers.keys().next().value;
    if (!oldest) break;
    privateLinkTransfers.delete(oldest);
  }
}

export function createPrivateLinkTransfer(text: string) {
  prunePrivateLinkTransfers();
  const token = randomBytes(9).toString("base64url");
  privateLinkTransfers.set(token, { text, expiresAt: Date.now() + PRIVATE_LINK_TRANSFER_TTL_MS });
  return `${KRONOS_GUARD_BOT_URL}?start=link_${token}`;
}

export function consumePrivateLinkTransfer(payload: string) {
  prunePrivateLinkTransfers();
  const match = payload.match(/^link_([A-Za-z0-9_-]{8,32})$/);
  if (!match) return null;
  const transfer = privateLinkTransfers.get(match[1]);
  if (!transfer || transfer.expiresAt <= Date.now()) {
    privateLinkTransfers.delete(match[1]);
    return null;
  }
  privateLinkTransfers.delete(match[1]);
  return transfer.text;
}

export function groupLinkModeKeyboard() {
  return { inline_keyboard: [
    [withTelegramButtonStyle({ text: "• نمایش لینک به‌صورت متن", callback_data: "group-link:text" }, "primary")],
    [withTelegramButtonStyle({ text: "• نمایش لینک به صورت عکس", callback_data: "group-link:image" }, "primary")],
    [withTelegramButtonStyle({ text: "• ساخت لینک یک‌بارمصرف", callback_data: "group-link:once" }, "primary")],
    [withTelegramButtonStyle({ text: "• ساخت لینک درخواست عضویت", callback_data: "group-link:request" }, "primary")],
    [withTelegramButtonStyle({ text: "ارسال لینک به پیوی", callback_data: "group-link:private" }, "primary")],
    [withTelegramButtonStyle({ text: "• بستن مرکز لینک", callback_data: "group-link:close" }, "danger")],
  ] };
}

type LinkButton = ({ text: string; callback_data: string } | { text: string; url: string }) & { style?: TelegramButtonStyle };

export function linkResultKeyboard(mode: GroupLinkMode, canRevoke: boolean, shareLink?: string | null): InlineKeyboardMarkup {
  const shareUrl = shareLink ? `https://t.me/share/url?url=${encodeURIComponent(shareLink)}&text=${encodeURIComponent("پیوند دعوت Kronos Guard")}` : undefined;
  const privateUrl = shareLink ? createPrivateLinkTransfer(`<b>پیوند دعوت Kronos Guard</b>\n\nپیوند آمادهٔ ارسال به گفت‌وگوی خصوصی شما:\n🔗 ${escapeHtml(shareLink)}`) : KRONOS_GUARD_BOT_URL;
  const rows: LinkButton[][] = [
    [shareUrl
      ? withTelegramButtonStyle({ text: "اشتراک‌گذاری لینک", url: shareUrl }, "primary")
      : withTelegramButtonStyle({ text: "اشتراک‌گذاری لینک", callback_data: "group-link:share" }, "primary")],
    [withTelegramButtonStyle({ text: "ارسال لینک به پیوی", url: privateUrl }, "primary")],
  ];
  if (mode === "text" || mode === "image" || mode === "once" || mode === "request") {
    rows.push([withTelegramButtonStyle(
      { text: canRevoke ? "• ابطال و ساخت لینک تازه" : "• ساخت لینک تازه", callback_data: canRevoke ? "group-link:revoke-confirm" : `group-link:${mode}` },
      canRevoke ? "danger" : "primary",
    )]);
  }
  if (mode === "request") rows.push([withTelegramButtonStyle({ text: "• راهنمای فعال‌سازی", callback_data: "group-link:guide" }, "primary")]);
  rows.push([withTelegramButtonStyle({ text: BACK_LABEL, callback_data: "group-link:back" }, "primary")]);
  return { inline_keyboard: rows };
}

function groupLinkText(input: GroupProfileCaptionInput, link: string, mode: GroupLinkMode) {
  const title = escapeHtml(input.title || "گروه بدون نام");
  const members = input.memberCount === undefined ? "نامشخص" : String(Math.max(0, input.memberCount));
  const description = input.description ? escapeHtml(input.description) : "برای این گروه توضیحی ثبت نشده است.";
  const heading = mode === "once" ? "لینک یک‌بارمصرف امن" : mode === "request" ? "لینک درخواست عضویت" : "لینک ورود به گروه";
  const label = mode === "once" ? "لینک یک‌بارمصرف" : mode === "request" ? "لینک درخواست عضویت" : "لینک گروه";
  return `<b>◈ ${heading} | Kronos Guard</b>\n\n<b>• نام گروه:</b> ${title}\n<b>• تعداد اعضا:</b> ${members}\n<b>• بیوگرافی گپ:</b> ${description}${mode === "once" ? "\n<b>• اعتبار:</b> ۲۴ ساعت\n<b>• ظرفیت:</b> ۱ نفر" : ""}\n\n━┅┅ ✦ ┅┅━\n<b>• ${label}:</b>\n🔗 ${escapeHtml(link)}\n\n<i>ساخته‌شده با زیرساخت مدیریت امن Kronos Guard.</i>`;
}

export function buildGroupLinkModeCaption(input: GroupProfileCaptionInput, mode: GroupLinkMode, generatedLink?: string | null) {
  const fallback = input.inviteLink ?? "لینک دعوت در دسترس نیست";
  return groupLinkText(input, generatedLink ?? fallback, mode);
}

export function isGroupLinkModeCallback(data: string | undefined): data is `group-link:${GroupLinkAction}` {
  return typeof data === "string" && /^group-link:(text|image|once|request|share|private|revoke|revoke-confirm|revoke-yes|revoke-no|back|guide|close)$/.test(data);
}

function callbackMessage(ctx: Context) {
  return "callbackQuery" in ctx ? ctx.callbackQuery?.message : undefined;
}

function messageLink(message: unknown) {
  if (!message || typeof message !== "object") return null;
  const value = message as { text?: string; caption?: string };
  return (value.text ?? value.caption ?? "").match(/https:\/\/t\.me(?:\/\+|\/)[^\s<]+/)?.[0] ?? null;
}

async function loadGroupLinkInput(ctx: Context): Promise<{ chat: TelegramGroupChat; input: GroupProfileCaptionInput; message: any } | null> {
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) return null;
  const chat = await getGroupChatWithFallback(ctx.telegram, ctx.chat as TelegramGroupChat);
  const botIdentity = await ctx.telegram.getMe().catch(() => null);
  const [memberCount, botMember, inviteLink] = await Promise.all([
    ctx.telegram.getChatMembersCount(ctx.chat.id).catch(() => undefined),
    botIdentity ? ctx.telegram.getChatMember(ctx.chat.id, botIdentity.id).catch(() => ({ status: "unknown" })) : Promise.resolve({ status: "unknown" }),
    ctx.telegram.exportChatInviteLink(ctx.chat.id).catch(() => null),
  ]);
  return { chat, input: { title: chat.title, username: chat.username, description: chat.description, memberCount, type: chat.type, chatId: ctx.chat.id, botStatus: botMember.status, activeLockCount: 0, inviteLink }, message: callbackMessage(ctx) };
}

export async function handleGroupLinkModeCallback(ctx: Context): Promise<boolean> {
  const data = "callbackQuery" in ctx && ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
  if (!isGroupLinkModeCallback(data)) return false;
  const action = data.slice("group-link:".length) as GroupLinkAction;
  const callbackGroup = ctx.chat ? await findGroupByChatId(ctx.chat.id).catch(() => undefined) : undefined;
  if (!(await hasGroupLinkAccess(ctx, callbackGroup))) {
    await ctx.answerCbQuery("این دکمه فقط برای مالک یا مدیر مجاز گروه است.", { show_alert: true }).catch(() => undefined);
    return true;
  }
  await ctx.answerCbQuery().catch(() => undefined);
  if (action === "close") {
    const message = callbackMessage(ctx);
    if (message && "message_id" in message && ctx.chat) await ctx.telegram.deleteMessage(ctx.chat.id, message.message_id).catch(() => undefined);
    return true;
  }
  if (action === "back") {
    const message = callbackMessage(ctx);
    if (message && "message_id" in message && ctx.chat && shouldEditTelegramMessage(message as { text?: string; caption?: string; reply_markup?: unknown }, LINK_MENU_TEXT, groupLinkModeKeyboard())) await ctx.telegram.editMessageText(ctx.chat.id, message.message_id, undefined, LINK_MENU_TEXT, { parse_mode: "HTML", reply_markup: groupLinkModeKeyboard() }).catch(() => undefined);
    return true;
  }
  if (action === "revoke-confirm") {
    const message = callbackMessage(ctx);
    const keyboard = { inline_keyboard: [
      [withTelegramButtonStyle({ text: "• بله، لینک تازه ساخته شود", callback_data: "group-link:revoke-yes" }, "success")],
      [withTelegramButtonStyle({ text: "• خیر، لینک فعلی حفظ شود", callback_data: "group-link:revoke-no" }, "danger")],
      [withTelegramButtonStyle({ text: BACK_LABEL, callback_data: "group-link:back" }, "primary")],
    ] };
    const confirmText = "<b>تأیید عملیات امنیتی</b>\n\nآیا از باطل‌کردن لینک فعلی و ساخت یک لینک تازه برای این گروه اطمینان دارید؟";
    if (message && "message_id" in message && ctx.chat && shouldEditTelegramMessage(message as { text?: string; caption?: string; reply_markup?: unknown }, confirmText, keyboard)) await ctx.telegram.editMessageText(ctx.chat.id, message.message_id, undefined, confirmText, { parse_mode: "HTML", reply_markup: keyboard }).catch(() => undefined);
    return true;
  }
  if (action === "revoke-no") {
    const message = callbackMessage(ctx);
    const backMarkup = { inline_keyboard: [[withTelegramButtonStyle({ text: "• بازگشت به منوی لینک", callback_data: "group-link:back" }, "primary")]] };
    const currentMessage = message as { text?: string; caption?: string; reply_markup?: unknown };
    if (message && "message_id" in message && ctx.chat && shouldEditTelegramMessage(currentMessage, currentMessage.text ?? currentMessage.caption ?? "", backMarkup)) await ctx.telegram.editMessageReplyMarkup(ctx.chat.id, message.message_id, undefined, backMarkup).catch(() => undefined);
    return true;
  }
  if (action === "guide") {
    await ctx.reply("<b>راهنمای فعال‌سازی لینک درخواست عضویت</b>\n\nاین لینک را برای مخاطبان موردنظر بفرستید. درخواست‌های ورود در پنل مدیریت گروه نمایش داده می‌شوند و فقط مدیران مجاز می‌توانند آن‌ها را بررسی کنند.", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[withTelegramButtonStyle({ text: BACK_LABEL, callback_data: "group-link:back" }, "primary")]] } });
    return true;
  }
  const resolved = await loadGroupLinkInput(ctx);
  if (!resolved) return true;
  const { chat, input, message } = resolved;
  let mode: GroupLinkMode | null = ["text", "image", "once", "request"].includes(action) ? action as GroupLinkMode : null;
  if (action === "revoke-yes") {
    const messageId = message && "message_id" in message ? message.message_id : undefined;
    const previousState = messageId === undefined ? undefined : linkState.get(linkStateKey(chat.id, messageId));
    const previous = previousState?.link ?? messageLink(message);
    if (previous) await ctx.telegram.revokeChatInviteLink(chat.id, previous).catch(() => undefined);
    mode = previousState?.mode ?? "text";
  }
  if (action === "share" || action === "private") {
    let link = messageLink(message);
    if (!link && action === "private") {
      link = input.inviteLink ?? await ctx.telegram.exportChatInviteLink(chat.id).catch(() => null);
    }
    if (!link) { await ctx.answerCbQuery("Kronos Guard هنوز لینک قابل اشتراک برای این گروه ندارد", { show_alert: true }).catch(() => undefined); return true; }
    const shareText = `<b>پیوند دعوت Kronos Guard</b>\n\nبرای ورود به «${escapeHtml(input.title)}» از پیوند زیر استفاده کنید:\n🔗 ${escapeHtml(link)}\n\n<i>این پیوند با ساختار امن Kronos Guard آماده شده است.</i>`;
    const privateDeliveryText = `✅ لینک با موفقیت به پیوی شما ارسال شد.\n\n${shareText}`;
    if (action === "private" && ctx.from) {
      try {
        await ctx.telegram.sendMessage(ctx.from.id, privateDeliveryText, { parse_mode: "HTML", ...LINK_PREVIEW_DISABLED });
        await ctx.answerCbQuery("پیوند به گفت‌وگوی خصوصی شما ارسال شد").catch(() => undefined);
      } catch (error) {
        console.warn("[Kronos Guard] direct private link delivery unavailable; offering deep-link", error);
        const deepLink = createPrivateLinkTransfer(privateDeliveryText);
        await ctx.reply("برای دریافت لینک در گفت‌وگوی خصوصی، دکمهٔ زیر را بزنید و ربات را باز کنید.", {
          reply_parameters: message && "message_id" in message ? { message_id: message.message_id } : undefined,
          reply_markup: { inline_keyboard: [[withTelegramButtonStyle({ text: "بازکردن ربات و دریافت لینک", url: deepLink }, "primary")]] },
        }).catch(() => undefined);
        await ctx.answerCbQuery("برای ارسال خصوصی، ربات را از دکمهٔ پیام باز کنید").catch(() => undefined);
      }
    } else if (ctx.from && ctx.chat && message && "message_id" in message) {
      await ctx.telegram.forwardMessage(ctx.from.id, ctx.chat.id, message.message_id).catch(() => undefined);
      await ctx.answerCbQuery("پیام لینک برای فوروارد آماده شد").catch(() => undefined);
    }
    return true;
  }
  if (!mode) return true;
  let link = input.inviteLink;
  if (mode === "once") link = await ctx.telegram.createChatInviteLink(chat.id, { member_limit: 1, expire_date: Math.floor(Date.now() / 1000) + 86400, name: "Kronos Guard one-time" }).then(result => result.invite_link).catch(() => null);
  if (mode === "request") link = await ctx.telegram.createChatInviteLink(chat.id, { creates_join_request: true, name: "Kronos Guard join request" }).then(result => result.invite_link).catch(() => null);
  if (!link) { await ctx.reply("Kronos Guard نتوانست لینک امن این گروه را بسازد؛ دسترسی مدیریت لینک دعوت را بررسی کنید."); return true; }
  const caption = buildGroupLinkModeCaption(input, mode, link);
  const canRevoke = true;
  if (mode === "image" && message && "message_id" in message && ctx.chat) {
    await ctx.answerCbQuery("⏳ در حال آماده‌سازی لینک تصویری...").catch(() => undefined);
    const currentMessage = message as { text?: string; caption?: string; reply_markup?: unknown };
    if (shouldEditTelegramMessage(currentMessage, LINK_IMAGE_PROCESSING_TEXT, undefined)) {
      await ctx.telegram.editMessageText(ctx.chat.id, message.message_id, undefined, LINK_IMAGE_PROCESSING_TEXT, { parse_mode: "HTML" }).catch(() => undefined);
    }
    let sent: any = null;
    // `loadGroupLinkInput` may use update metadata when getChat is temporarily stale.
    // Refresh once specifically for image mode so the profile photo is not lost.
    const photoSource = await ctx.telegram.getChat(chat.id).catch(() => chat);
    const photoFileId = telegramPhotoFileId((photoSource as TelegramGroupChat).photo) ?? telegramPhotoFileId(chat.photo);
    if (photoFileId) {
      sent = await replaceLinkMenuWithPhoto(ctx.telegram, ctx.chat.id, message.message_id, {
        photoFileId,
        caption,
        replyMarkup: linkResultKeyboard(mode, canRevoke, link),
      });
    }
    if (!sent) {
      const failureText = photoFileId
        ? "تصویر پروفایل گروه از تلگرام قابل ارسال نبود؛ لطفاً دوباره تلاش کنید."
        : "برای این گروه تصویر پروفایل قابل دریافت نیست؛ ابتدا تصویر گروه را تنظیم کنید و دوباره تلاش کنید.";
      await ctx.telegram.editMessageText(ctx.chat.id, message.message_id, undefined, failureText, { reply_markup: groupLinkModeKeyboard() }).catch(() => ctx.reply(failureText, { reply_parameters: { message_id: message.message_id }, reply_markup: groupLinkModeKeyboard() })).catch(() => undefined);
    }
    if (sent && "message_id" in sent) linkState.set(linkStateKey(ctx.chat.id, sent.message_id), { link, mode });
  } else if (message && "message_id" in message && ctx.chat) {
    linkState.set(linkStateKey(ctx.chat.id, message.message_id), { link, mode });
    const resultMarkup = linkResultKeyboard(mode, canRevoke, link);
    if (shouldEditTelegramMessage(message as { text?: string; caption?: string; reply_markup?: unknown }, caption, resultMarkup)) await ctx.telegram.editMessageText(ctx.chat.id, message.message_id, undefined, caption, { parse_mode: "HTML", reply_markup: resultMarkup, ...LINK_PREVIEW_DISABLED }).catch(() => ctx.reply(caption, { parse_mode: "HTML", reply_markup: resultMarkup, ...LINK_PREVIEW_DISABLED }));
  } else {
    const sent = await ctx.reply(caption, { parse_mode: "HTML", reply_markup: linkResultKeyboard(mode, canRevoke, link), ...LINK_PREVIEW_DISABLED });
    if (sent && "message_id" in sent) linkState.set(linkStateKey(ctx.chat?.id ?? "private", sent.message_id), { link, mode });
  }
  return true;
}
