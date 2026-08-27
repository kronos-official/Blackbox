import type { Context } from "telegraf";
import { and, eq } from "drizzle-orm";
import { contentLocks, groupSettings } from "../../drizzle/schema";
import { getDb } from "../db";
import { hasAtLeastAccess, hasKronosModerationAccess, resolveAccessLevel } from "./authorization";
import type { AccessLevel } from "./constants";
import { findGroupByChatId, writeAuditLog } from "./repository";
import { replySafely } from "./replySafe";
import { recordGroupAuditEvent } from "./policyAudit";
import { deleteTemporaryCommandSuccess, telegramMessageId } from "./temporarySuccess";

const lockAliases: Record<string, string[]> = {
  link: ["link", "لینک"],
  photo: ["photo", "عکس"],
  video: ["video", "ویدیو"],
  sticker: ["sticker", "استیکر"],
  gif: ["gif", "گیف"],
  document: ["document", "فایل"],
  forward: ["forward", "فوروارد"],
  mention: ["mention", "منشن"],
  hashtag: ["hashtag", "هشتگ"],
  emoji: ["emoji", "ایموجی"],
  phone: ["phone", "شماره"],
  poll: ["poll", "نظرسنجی"],
  bot: ["bot", "ربات"],
  command: ["command", "دستور"],
  english: ["english", "انگلیسی"],
  persian: ["persian", "فارسی"],
  text: ["text", "متن"],
  all: ["all", "همه"],
};

const lockLabels: Record<keyof typeof lockAliases, string> = {
  link: "لینک",
  photo: "عکس",
  video: "ویدیو",
  sticker: "استیکر",
  gif: "گیف",
  document: "فایل",
  forward: "فوروارد",
  mention: "منشن",
  hashtag: "هشتگ",
  emoji: "ایموجی",
  phone: "شماره تماس",
  poll: "نظرسنجی",
  bot: "ربات",
  command: "دستور",
  english: "متن انگلیسی",
  persian: "متن فارسی",
  text: "متن",
  all: "همهٔ محتوا",
};

type LockType = keyof typeof lockAliases;

/** Link lock keeps its historical persistent confirmation message. */
export function shouldAutoDeleteLockSuccess(lockType: LockType) {
  return lockType !== "link";
}

export function isLockManagementAccessLevelAllowed(access: AccessLevel) {
  return hasKronosModerationAccess(access);
}

export function isGroupLockManagementAccessLevelAllowed(access: AccessLevel) {
  return hasAtLeastAccess(access, "group_admin");
}

export function parseGroupLockCommand(text: string): { enabled: boolean } | undefined {
  const normalized = text.trim().replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/\s+/g, " ").toLocaleLowerCase("fa-IR");
  if (["قفل گروه", "lock group"].includes(normalized)) return { enabled: true };
  if (["باز کردن گروه", "بازکردن گروه", "باز گروه", "unlock group", "open group"].includes(normalized)) return { enabled: false };
  return undefined;
}

export function buildGroupLockConfirmationMessage(enabled: boolean) {
  return enabled
    ? "🔒 <b>گروه قفل شد</b>\nفقط مالک و ادمین‌ها می‌توانند پیام یا رسانه ارسال کنند."
    : "🔓 <b>گروه باز شد</b>\nارسال پیام و رسانه برای کاربران دوباره مجاز است.";
}

export function parseLockCommand(text: string): { enabled: boolean; lockType: LockType } | undefined {
  const normalized = text.trim().replace(/^\//, "").replace(/ي/g, "ی").replace(/ك/g, "ک").toLocaleLowerCase("fa-IR");
  const words = normalized.split(/\s+/);
  const isDeleteLock = (words[0] === "حذف" || words[0] === "delete") && (words[1] === "قفل" || words[1] === "lock");
  const enabled = isDeleteLock
    ? false
    : ["lock", "قفل"].includes(words[0])
      ? true
      : ["unlock", "باز", "بازکردن"].includes(words[0])
        ? false
        : undefined;
  if (enabled === undefined) return undefined;
  const subject = words.slice(isDeleteLock ? 2 : 1).join(" ");
  const entry = (Object.entries(lockAliases) as [LockType, string[]][]).find(([, aliases]) => aliases.includes(subject));
  return entry ? { enabled, lockType: entry[0] } : undefined;
}

export function isLockStatusCommand(text: string) {
  const normalized = text.trim().toLocaleLowerCase("fa-IR");
  return normalized === "وضعیت قفل" || normalized === "lock status";
}

export function buildLockStatusMessage(lockTypes: string[]) {
  if (!lockTypes.length) return "🔓 هیچ قفل محتوایی در این گروه فعال نیست.";
  const labels = lockTypes.map(lockType => lockLabels[lockType as LockType] ?? lockType);
  return `🔒 <b>وضعیت قفل‌های محتوا</b>\n\n${labels.map(label => `• ${label}`).join("\n")}`;
}

export async function handleLockStatusCommand(ctx: Context): Promise<boolean> {
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") || !ctx.from || !ctx.message || !("text" in ctx.message) || !isLockStatusCommand(ctx.message.text)) return false;
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) {
    await replySafely(ctx, "این گروه هنوز راه‌اندازی نشده است. ابتدا «setup» را ارسال کنید.", { reply_parameters: { message_id: ctx.message.message_id } });
    return true;
  }
  const level = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  const allowed = isLockManagementAccessLevelAllowed(level);
  void recordGroupAuditEvent({ groupId: group.id, actorTelegramId: ctx.from.id, action: "command.locks.status.access", outcome: allowed ? "allowed" : "denied", details: { resolvedAccess: level } });
  if (!allowed) {
    await replySafely(ctx, "این دستور فقط برای مدیران مجاز گروه یا Kronos قابل استفاده است.", { reply_parameters: { message_id: ctx.message.message_id } });
    return true;
  }
  const enabled = await getEnabledLockTypes(group.id);
  await replySafely(ctx, buildLockStatusMessage(enabled), { parse_mode: "HTML", reply_parameters: { message_id: ctx.message.message_id } });
  await writeAuditLog({ category: "content_lock", event: "status_viewed", groupId: group.id, actorTelegramId: ctx.from.id, details: { lockTypes: enabled } });
  void recordGroupAuditEvent({ groupId: group.id, actorTelegramId: ctx.from.id, action: "command.locks.status.completed", outcome: "completed", details: { lockTypes: enabled } });
  return true;
}

/** Configures a content lock. Enforcement is performed by the content-protection middleware. */
export async function handleLockCommand(ctx: Context): Promise<boolean> {
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") || !ctx.from || !ctx.message || !("text" in ctx.message)) return false;
  const parsed = parseLockCommand(ctx.message.text);
  if (!parsed) return false;

  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) return false;
  const level = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  const allowed = isLockManagementAccessLevelAllowed(level);
  void recordGroupAuditEvent({ groupId: group.id, actorTelegramId: ctx.from.id, action: "command.locks.mutate.access", outcome: allowed ? "allowed" : "denied", details: { resolvedAccess: level, lockType: parsed.lockType, enabled: parsed.enabled } });
  if (!allowed) {
    await ctx.reply("فقط مدیران مجاز گروه یا Kronos می‌توانند قفل‌ها را تغییر دهند.");
    return true;
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable while updating content lock");
  const lockType = parsed.lockType as typeof contentLocks.$inferInsert.lockType;
  await db
    .insert(contentLocks)
    .values({ groupId: group.id, lockType, enabled: parsed.enabled, updatedByTelegramId: ctx.from.id })
    .onDuplicateKeyUpdate({ set: { enabled: parsed.enabled, updatedByTelegramId: ctx.from.id } });
  await writeAuditLog({ category: "content_lock", event: parsed.enabled ? "locked" : "unlocked", groupId: group.id, actorTelegramId: ctx.from.id, details: { lockType: parsed.lockType } });
  void recordGroupAuditEvent({ groupId: group.id, actorTelegramId: ctx.from.id, action: "command.locks.mutate.completed", outcome: "completed", details: { lockType: parsed.lockType, enabled: parsed.enabled } });
  const label = lockLabels[parsed.lockType];
  const message = parsed.enabled
    ? `قفل «${label}» فعال شد. از این لحظه پیام‌های این نوع طبق تنظیمات گروه حذف می‌شوند.`
    : `قفل «${label}» غیرفعال شد. ارسال این نوع محتوا دوباره مجاز است.`;
  const response = await replySafely(ctx, message, { reply_parameters: { message_id: ctx.message.message_id } });
  if (shouldAutoDeleteLockSuccess(parsed.lockType)) {
    await deleteTemporaryCommandSuccess({ telegram: ctx.telegram, chatId: ctx.chat.id, messageId: telegramMessageId(response) });
  }
  return true;
}

/** Locks every group message except messages authored by the bot owner or live Telegram administrators. */
export async function handleGroupLockCommand(ctx: Context): Promise<boolean> {
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") || !ctx.from || !ctx.message || !("text" in ctx.message)) return false;
  const parsed = parseGroupLockCommand(ctx.message.text);
  if (!parsed) return false;

  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) return false;
  const access = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  const allowed = isGroupLockManagementAccessLevelAllowed(access);
  void recordGroupAuditEvent({ groupId: group.id, actorTelegramId: ctx.from.id, action: "command.group_lock.access", outcome: allowed ? "allowed" : "denied", details: { resolvedAccess: access, enabled: parsed.enabled } });
  if (!allowed) {
    await ctx.reply("⛔ فقط مالک یا ادمین‌های واقعی گروه/Kronos می‌توانند قفل کامل گروه را تغییر دهند.");
    return true;
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable while updating group lock");
  await db.insert(groupSettings).values({ groupId: group.id, groupLocked: parsed.enabled }).onDuplicateKeyUpdate({ set: { groupLocked: parsed.enabled } });
  await writeAuditLog({ category: "group_lock", event: parsed.enabled ? "activated" : "deactivated", groupId: group.id, actorTelegramId: ctx.from.id, details: { source: "command" } });
  void recordGroupAuditEvent({ groupId: group.id, actorTelegramId: ctx.from.id, action: "command.group_lock.completed", outcome: "completed", details: { enabled: parsed.enabled } });
  await ctx.reply(buildGroupLockConfirmationMessage(parsed.enabled), { parse_mode: "HTML", reply_parameters: { message_id: ctx.message.message_id } });
  return true;
}

export async function getEnabledLockTypes(groupId: number) {
  const db = await getDb();
  if (!db) return [] as string[];
  const rows = await db.select({ lockType: contentLocks.lockType }).from(contentLocks).where(and(eq(contentLocks.groupId, groupId), eq(contentLocks.enabled, true)));
  return rows.map(row => row.lockType);
}

export async function getEnabledLocks(groupId: number) {
  const db = await getDb();
  if (!db) return [] as (typeof contentLocks.$inferSelect)[];
  return db.select().from(contentLocks).where(and(eq(contentLocks.groupId, groupId), eq(contentLocks.enabled, true)));
}
