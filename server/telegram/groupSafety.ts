import type { Context } from "telegraf";
import { and, eq } from "drizzle-orm";
import { customCommands, filterRules, groupRoles, groupSettings } from "../../drizzle/schema";
import { getDb } from "../db";
import { alertOwner } from "./alerts";
import { hasAtLeastAccess, hasKronosModerationAccess, resolveAccessLevel } from "./authorization";
import { recordGroupAuditEvent } from "./policyAudit";
import type { AccessLevel } from "./constants";
import { getEnabledLocks } from "./locks";
import { findGroupByChatId, writeAuditLog } from "./repository";
import { getVipProtectionPolicy, isVipProtected } from "./vipProtection";
import { notifyGroupEvent } from "./groupEventNotifier";

const FLOOD_MUTE_SECONDS = 300;
const RAID_WINDOW_MS = 60_000;
const RAID_MEMBER_LIMIT = 8;
const RAID_MODE_SECONDS = 15 * 60;
const rateWindows = new Map<string, number[]>();
const duplicateWindows = new Map<string, number[]>();
const joinWindows = new Map<number, number[]>();
const SAFETY_WINDOW_RETENTION_MS = 5 * 60_000;
const riskCooldowns = new Map<string, number>();

export type RiskSignals = {
  messageCount: number;
  duplicateCount: number;
  linkCount: number;
  joinVelocity: number;
  priorModerationSignals?: number;
};

export type RiskDecision = {
  score: number;
  level: "low" | "elevated" | "high" | "critical";
  cooldownSeconds: number;
};

/** Deterministic, bounded score used by the webhook path and unit tests. */
export function calculateRiskScore(signals: RiskSignals): RiskDecision {
  const score = Math.min(100,
    Math.max(0, signals.messageCount) * 4 +
    Math.max(0, signals.duplicateCount) * 10 +
    Math.max(0, signals.linkCount) * 8 +
    Math.max(0, signals.joinVelocity) * 5 +
    Math.max(0, signals.priorModerationSignals ?? 0) * 12,
  );
  if (score >= 80) return { score, level: "critical", cooldownSeconds: 300 };
  if (score >= 55) return { score, level: "high", cooldownSeconds: 120 };
  if (score >= 30) return { score, level: "elevated", cooldownSeconds: 30 };
  return { score, level: "low", cooldownSeconds: 0 };
}

export function getRiskCooldownRemaining(key: string, now = Date.now()) {
  const until = riskCooldowns.get(key) ?? 0;
  if (until <= now) {
    riskCooldowns.delete(key);
    return 0;
  }
  return Math.ceil((until - now) / 1000);
}

export function isGroupSafetyConfigurationAccessLevelAllowed(access: AccessLevel) {
  return hasKronosModerationAccess(access);
}

/** Removes stale anti-spam state so long-lived webhook instances cannot retain inactive users forever. */
export function pruneSafetyWindows(now = Date.now(), retentionMs = SAFETY_WINDOW_RETENTION_MS) {
  const pruneMap = <K>(windows: Map<K, number[]>) => {
    windows.forEach((events: number[], key: K) => {
      const fresh = events.filter((event: number) => now - event <= retentionMs);
      if (fresh.length === 0) windows.delete(key);
      else windows.set(key, fresh);
    });
  };
  pruneMap(rateWindows);
  pruneMap(duplicateWindows);
  pruneMap(joinWindows);
  riskCooldowns.forEach((until, key) => {
    if (until <= now) riskCooldowns.delete(key);
  });
  return { rateKeys: rateWindows.size, duplicateKeys: duplicateWindows.size, joinKeys: joinWindows.size, cooldownKeys: riskCooldowns.size };
}

function escapeTelegramHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function displayName(ctx: Context) {
  return [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || ctx.from?.username || "کاربر";
}

function lockLabel(lockType: string) {
  return ({ gif: "گیف", sticker: "استیکر", photo: "عکس", video: "ویدئو", voice: "پیام صوتی", audio: "فایل صوتی", document: "فایل", link: "لینک", forward: "پیام فورواردی", mention: "منشن", hashtag: "هشتگ", emoji: "ایموجی", phone: "شماره تلفن", location: "موقعیت مکانی", poll: "نظرسنجی", game: "بازی", bot: "پیام ربات", command: "دستور", english: "متن انگلیسی", persian: "متن فارسی", edited_message: "پیام ویرایش‌شده", long_message: "پیام بلند", reply: "پاسخ به پیام", inline_button: "دکمهٔ درون‌خطی", profanity: "الفاظ نامناسب", text: "پیام متنی", all: "این نوع محتوا" } as Record<string, string>)[lockType] ?? lockType;
}

export function formatLockEnforcementNotice(lockType: string, action: string) {
  return `ارسال ${lockLabel(lockType)} در این گروه ممنوع است؛ پیام حذف شد.${action === "mute" ? " دسترسی ارسال پیام نیز موقتاً محدود شد." : ""}`;
}

async function notifyEnforcement(ctx: Context, text: string) {
  const message = (ctx.message ?? ctx.editedMessage) as MessageLike | undefined;
  const messageId = ctx.message?.message_id ?? ctx.editedMessage?.message_id;
  if (!ctx.from || !message || !messageId) return;
  const userLabel = `<a href="tg://user?id=${ctx.from.id}">${escapeTelegramHtml(displayName(ctx))}</a>`;
  try {
    await ctx.reply(`کاربر ${userLabel}، ${text}`, { parse_mode: "HTML", reply_parameters: { message_id: messageId } });
  } catch (error) {
    console.warn("[Kronos Guard] enforcement notice failed", { chatId: ctx.chat?.id, userId: ctx.from.id, error: error instanceof Error ? error.message : "unknown" });
  }
}

type MessageLike = {
  text?: string;
  caption?: string;
  entities?: Array<{ type: string }>;
  caption_entities?: Array<{ type: string }>;
  photo?: unknown;
  video?: unknown;
  video_note?: unknown;
  voice?: unknown;
  audio?: unknown;
  sticker?: unknown;
  document?: { mime_type?: string; file_name?: string };
  animation?: unknown;
  game?: unknown;
  forward_origin?: unknown;
  forward_date?: unknown;
  is_automatic_forward?: boolean;
  sender_chat?: { id?: number; type?: string };
  poll?: unknown;
  contact?: unknown;
  location?: unknown;
  reply_to_message?: unknown;
  reply_markup?: { inline_keyboard?: unknown[][] };
  via_bot?: unknown;
  from?: { is_bot?: boolean };
  edit_date?: unknown;
  new_chat_members?: unknown;
};

/**
 * Telegram sets this pair only when a post is automatically mirrored from the
 * channel linked to this discussion group. Regular forwarded or bot messages
 * do not meet both conditions and still pass through every safety control.
 */
export function isLinkedChannelAutomaticForward(message: MessageLike) {
  return message.is_automatic_forward === true && message.sender_chat?.type === "channel";
}

const PROFANITY_PATTERN = /(?:\bfuck\b|\bshit\b|\bbitch\b|\basshole\b|کس(?:کش)?|کیر|جنده|حرومزاده|مادر(?:جنده|قحبه))/i;
const EMOJI_ONLY_PATTERN = /^(?:[\u00A9\u00AE\u203C-\u3299\uD83C-\uDBFF\uDC00-\uDFFF\uFE0F\u200D]|\s)+$/;
const LONG_MESSAGE_MINIMUM_CHARACTERS = 700;

export function classifyLockedContent(message: MessageLike): string[] {
  const text = message.text ?? message.caption ?? "";
  const entityTypes = [...(message.entities ?? []), ...(message.caption_entities ?? [])].map(entity => entity.type);
  const types = new Set<string>();
  if (text) types.add("text");
  if (message.photo) types.add("photo");
  if (message.video) types.add("video");
  if (message.video_note) types.add("video");
  if (message.voice) types.add("voice");
  if (message.audio) types.add("audio");
  if (message.sticker) types.add("sticker");
  if (message.document) {
    types.add("document");
    if (/^(?:image\/gif|video\/mp4)$/i.test(message.document.mime_type ?? "") || /\.(?:gif|mp4)$/i.test(message.document.file_name ?? "")) types.add("gif");
  }
  if (message.animation) types.add("gif");
  if (message.game) types.add("game");
  if (message.forward_origin || message.forward_date) types.add("forward");
  if (message.poll) types.add("poll");
  if (message.contact) types.add("phone");
  if (message.location) types.add("location");
  if (message.reply_to_message) types.add("reply");
  if (message.reply_markup?.inline_keyboard?.length) types.add("inline_button");
  if (message.from?.is_bot || message.via_bot) types.add("bot");
  if (message.edit_date) types.add("edited_message");
  if (/^\//.test(text)) types.add("command");
  if (entityTypes.includes("url") || entityTypes.includes("text_link") || /(?:https?:\/\/|t\.me\/|www\.)/i.test(text)) types.add("link");
  if (entityTypes.includes("mention") || /@[a-zA-Z0-9_]{5,}/.test(text)) types.add("mention");
  if (entityTypes.includes("hashtag") || /#[A-Za-z0-9_\u0600-\u06FF]+/.test(text)) types.add("hashtag");
  if (/[A-Za-z]/.test(text)) types.add("english");
  if (/[\u0600-\u06FF]/.test(text)) types.add("persian");
  if (text.trim().length >= LONG_MESSAGE_MINIMUM_CHARACTERS) types.add("long_message");
  if (text.trim() && EMOJI_ONLY_PATTERN.test(text.trim())) types.add("emoji");
  if (PROFANITY_PATTERN.test(text)) types.add("profanity");
  return Array.from(types);
}

export function matchesFilter(pattern: string, matchType: "word" | "phrase" | "regex", text: string): boolean {
  if (matchType === "word") return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(pattern)}($|[^\\p{L}\\p{N}_])`, "iu").test(text);
  if (matchType === "phrase") return text.toLocaleLowerCase("fa-IR").includes(pattern.toLocaleLowerCase("fa-IR"));
  // Regex filters are bounded and reject nested quantifiers to avoid untrusted-pattern denial of service.
  if (pattern.length > 96 || /\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) return false;
  try {
    return new RegExp(pattern, "iu").test(text);
  } catch {
    return false;
  }
}

function escapeRegExp(input: string) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function prune(times: number[], windowMs: number, now: number) {
  return times.filter(time => now - time <= windowMs);
}

export function appendWindowEvents(existing: number[], additions: number, windowMs: number, now: number) {
  const next = prune(existing, windowMs, now);
  for (let index = 0; index < additions; index += 1) next.push(now);
  return next;
}

export function isRaidWave(joinCount: number) {
  return joinCount >= RAID_MEMBER_LIMIT;
}

/** A durable group-wide mode; only members joining during a detected wave are restricted. */
export function isRaidModeActive(raidModeUntil: Date | null | undefined, now = Date.now()) {
  return Boolean(raidModeUntil && raidModeUntil.getTime() > now);
}

export function getRaidModeRemaining(raidModeUntil: Date | null | undefined, now = Date.now()) {
  if (!isRaidModeActive(raidModeUntil, now)) return 0;
  return Math.ceil((raidModeUntil!.getTime() - now) / 1000);
}

export function getRaidModeExpiry(now = Date.now(), durationSeconds = RAID_MODE_SECONDS) {
  return new Date(now + durationSeconds * 1000);
}

async function isVip(groupId: number, telegramUserId: number) {
  const db = await getDb();
  if (!db) return false;
  return Boolean((await db.select({ id: groupRoles.id }).from(groupRoles).where(and(eq(groupRoles.groupId, groupId), eq(groupRoles.telegramUserId, telegramUserId), eq(groupRoles.role, "vip"))).limit(1))[0]);
}

export function isExempt(exemptionRole: "none" | "vip" | "moderator" | "admin", access: AccessLevel, vip: boolean) {
  if (exemptionRole === "none") return false;
  if (exemptionRole === "vip") return vip;

  if (exemptionRole === "moderator") return hasAtLeastAccess(access, "moderator");
  return hasAtLeastAccess(access, "group_admin");
}

export function isContentLockActorExempt(access: AccessLevel, vip: boolean) {
  return vip || hasAtLeastAccess(access, "moderator");
}

export function shouldEnforceLock(input: { lockType: string; exemptionRole: "none" | "vip" | "moderator" | "admin" }, contentTypes: string[], access: AccessLevel, vip: boolean) {
  return (input.lockType === "all" || contentTypes.includes(input.lockType)) && !isContentLockActorExempt(access, vip) && !isExempt(input.exemptionRole, access, vip);
}

/** The full-group lock deliberately does not exempt VIPs or internal moderators. */
export function shouldEnforceGroupLock(groupLocked: boolean, access: AccessLevel) {
  return groupLocked && !hasAtLeastAccess(access, "group_admin");
}

export type GreetingSetting = { field: "welcomeEnabled" | "goodbyeEnabled" | "welcomeMessage" | "goodbyeMessage"; value: boolean | string };

export function parseGreetingSetting(text: string): GreetingSetting | undefined {
  const match = text.trim().match(/^(welcome|خوشامد|goodbye|خداحافظ)\s+(on|off|روشن|خاموش|text|متن)(?:\s+(.+))?$/i);
  if (!match) return undefined;
  const kind = ["welcome", "خوشامد"].includes(match[1].toLocaleLowerCase("fa-IR")) ? "welcome" : "goodbye";
  const operation = match[2].toLocaleLowerCase("fa-IR");
  if (["on", "روشن"].includes(operation)) return { field: kind === "welcome" ? "welcomeEnabled" : "goodbyeEnabled", value: true };
  if (["off", "خاموش"].includes(operation)) return { field: kind === "welcome" ? "welcomeEnabled" : "goodbyeEnabled", value: false };
  if (operation === "text" || operation === "متن") {
    const body = match[3]?.trim();
    if (body && body.length <= 3500) return { field: kind === "welcome" ? "welcomeMessage" : "goodbyeMessage", value: body };
  }
  return undefined;
}

function isWelcomeGreetingCommand(value: string) {
  return ["welcome", "خوشامد"].includes(value.toLocaleLowerCase("fa-IR"));
}

async function deleteMessageSafely(ctx: Context) {
  try {
    await ctx.deleteMessage();
    return true;
  } catch {
    return false;
  }
}

function messageText(ctx: Context) {
  const message = (ctx.message ?? ctx.editedMessage) as MessageLike | undefined;
  return message?.text ?? message?.caption ?? "";
}

async function loadSettings(groupId: number) {
  const db = await getDb();
  if (!db) return undefined;
  return (await db.select().from(groupSettings).where(eq(groupSettings.groupId, groupId)).limit(1))[0];
}

async function requireAdmin(ctx: Context, groupId: number): Promise<boolean> {
  if (!ctx.chat || !ctx.from) return false;
  const access = await resolveAccessLevel({ groupId, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  if (isGroupSafetyConfigurationAccessLevelAllowed(access)) return true;
  await ctx.reply("فقط مدیران مجاز گروه یا Kronos می‌توانند این تنظیم را تغییر دهند.");
  return false;
}

async function handleConfiguration(ctx: Context, groupId: number, text: string): Promise<boolean> {
  const normalized = text.trim();
  const filterAdd = normalized.match(/^(?:filter\s+add|افزودن\s+فیلتر)\s+(.{1,160})$/i);
  const filterDelete = normalized.match(/^(?:filter\s+del|حذف\s+فیلتر)\s+(\d+)$/i);
  const customAdd = normalized.match(/^(?:cmd\s+add|افزودن\s+دستور)\s+([^|]{1,80})\|\s*(.{1,1200})$/i);
  const customDelete = normalized.match(/^(?:cmd\s+del|حذف\s+دستور)\s+(.{1,80})$/i);
  const setRules = normalized.match(/^(?:rules\s+set|تنظیم\s+قوانین)\s+(.{1,3500})$/i);
  const showRules = /^(?:rules|قوانین)$/i.test(normalized);
  const raidMode = normalized.match(/^(?:raid|ضد\s*حمله)\s+(on|off|status|روشن|خاموش|وضعیت)$/i);
  const greeting = parseGreetingSetting(normalized);
  const greetingPreview = normalized.match(/^(welcome|خوشامد|goodbye|خداحافظ)\s+(preview|پیش‌نمایش)$/i);
  const greetingReset = normalized.match(/^(welcome|خوشامد|goodbye|خداحافظ)\s+(reset|بازنشانی)$/i);
  if (!filterAdd && !filterDelete && !customAdd && !customDelete && !setRules && !showRules && !raidMode && !greeting && !greetingPreview && !greetingReset) return false;
  if (showRules) {
    const settings = await loadSettings(groupId);
    await ctx.reply(settings?.rulesText || "قانونی برای این گروه ثبت نشده است.");
    return true;
  }
  if (!ctx.from || !(await requireAdmin(ctx, groupId))) return true;
  const db = await getDb();
  if (!db) throw new Error("Database unavailable for group configuration");
  if (raidMode) {
    const operation = raidMode[1].toLocaleLowerCase("en-US");
    const settings = await loadSettings(groupId);
    if (["status", "وضعیت"].includes(operation)) {
      const remaining = getRaidModeRemaining(settings?.raidModeUntil);
      await ctx.reply(remaining > 0
        ? `حالت کنترل حمله فعال است و تا ${remaining} ثانیهٔ دیگر فقط ورودهای جدید محدود می‌شوند.`
        : "حالت کنترل حمله فعال نیست.");
      return true;
    }
    const enabled = ["on", "روشن"].includes(operation);
    const raidModeUntil = enabled ? getRaidModeExpiry() : null;
    await db.insert(groupSettings).values({ groupId, raidModeUntil }).onDuplicateKeyUpdate({ set: { raidModeUntil } });
    await recordGroupAuditEvent({ groupId, actorTelegramId: ctx.from.id, action: enabled ? "anti_raid_mode_activated" : "anti_raid_mode_deactivated", outcome: "completed", details: { source: "command", durationSeconds: enabled ? RAID_MODE_SECONDS : 0 } });
    await notifyGroupEvent({
      groupId,
      eventType: "protection.raid",
      actor: { telegramUserId: ctx.from.id, displayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || String(ctx.from.id), username: ctx.from.username },
      details: { summary: enabled ? `محافظت ضدحمله برای ${RAID_MODE_SECONDS / 60} دقیقه فعال شد.` : "محافظت ضدحمله به‌صورت دستی غیرفعال شد.", nextValue: enabled ? "فعال" : "غیرفعال" },
      eventKey: `raid-command:${groupId}:${enabled}:${ctx.message && "message_id" in ctx.message ? ctx.message.message_id : Date.now()}`,
      telegram: ctx.telegram,
    });
    await ctx.reply(enabled
      ? `حالت کنترل حمله برای ${RAID_MODE_SECONDS / 60} دقیقه فعال شد؛ فقط اعضایی که در این بازه وارد شوند موقتاً محدود می‌شوند.`
      : "حالت کنترل حمله غیرفعال شد.");
  } else if (filterAdd) {
    await db.insert(filterRules).values({ groupId, pattern: filterAdd[1].trim(), matchType: "word", action: "delete", createdByTelegramId: ctx.from.id });
    await ctx.reply("فیلتر با اقدام حذف پیام ثبت شد.");
  } else if (filterDelete) {
    await db.delete(filterRules).where(and(eq(filterRules.groupId, groupId), eq(filterRules.id, Number(filterDelete[1]))));
    await ctx.reply("فیلتر حذف شد.");
  } else if (customAdd) {
    const trigger = customAdd[1].trim().toLocaleLowerCase("fa-IR");
    await db.insert(customCommands).values({ groupId, trigger, response: customAdd[2].trim(), createdByTelegramId: ctx.from.id }).onDuplicateKeyUpdate({ set: { response: customAdd[2].trim(), enabled: true, createdByTelegramId: ctx.from.id } });
    await ctx.reply(`دستور «${trigger}» ذخیره شد.`);
  } else if (customDelete) {
    await db.delete(customCommands).where(and(eq(customCommands.groupId, groupId), eq(customCommands.trigger, customDelete[1].trim().toLocaleLowerCase("fa-IR"))));
    await ctx.reply("دستور سفارشی حذف شد.");
  } else if (setRules) {
    await db.insert(groupSettings).values({ groupId, rulesText: setRules[1].trim() }).onDuplicateKeyUpdate({ set: { rulesText: setRules[1].trim() } });
    await ctx.reply("قوانین گروه ثبت شد.");
  } else if (greetingPreview) {
    const welcome = isWelcomeGreetingCommand(greetingPreview[1]);
    const settings = await loadSettings(groupId);
    const group = await findGroupByChatId(ctx.chat!.id);
    const groupTitle = "title" in ctx.chat! ? ctx.chat!.title : "این گروه";
    const template = resolveGreetingTemplate(welcome ? "welcome" : "goodbye", welcome ? settings?.welcomeMessage : settings?.goodbyeMessage);
    const preview = renderTemplate(template, greetingTemplateInput({
      id: ctx.chat!.id,
      title: groupTitle,
      username: "username" in ctx.chat! ? ctx.chat!.username : undefined,
      language: group?.language,
      timezone: group?.timezone,
      rulesText: settings?.rulesText,
    }, ctx.from));
    await ctx.reply(`🔎 پیش‌نمایش قالب ${welcome ? "ورود" : "خروج"}:\n\n${preview}`, { parse_mode: "HTML" });
  } else if (greetingReset) {
    const welcome = isWelcomeGreetingCommand(greetingReset[1]);
    const field = welcome ? "welcomeMessage" : "goodbyeMessage";
    await db.insert(groupSettings).values({ groupId, [field]: null }).onDuplicateKeyUpdate({ set: { [field]: null } });
    await ctx.reply(`قالب ${welcome ? "ورود" : "خروج"} به حالت پیش‌فرض Kronos بازنشانی شد.`);
  } else if (greeting) {
    await db.insert(groupSettings).values({ groupId, [greeting.field]: greeting.value }).onDuplicateKeyUpdate({ set: { [greeting.field]: greeting.value } });
    await ctx.reply("تنظیم پیام ورود/خروج به‌روزرسانی شد.");
  }
  await writeAuditLog({ category: "group_configuration", event: "updated", groupId, actorTelegramId: ctx.from.id, details: { command: normalized.slice(0, 80) } });
  return true;
}

async function enforceFlood(ctx: Context, groupId: number, settings: NonNullable<Awaited<ReturnType<typeof loadSettings>>>, access: AccessLevel): Promise<boolean> {
  if (!ctx.from || !settings.antiSpamEnabled || hasAtLeastAccess(access, "moderator")) return false;
  const now = Date.now();
  const key = `${groupId}:${ctx.from.id}`;
  const times = appendWindowEvents(rateWindows.get(key) ?? [], 1, settings.floodWindowSeconds * 1000, now);
  rateWindows.set(key, times);
  const text = messageText(ctx).trim().toLocaleLowerCase("fa-IR");
  let duplicateCount = 0;
  if (text) {
    const duplicateKey = `${key}:${text.slice(0, 160)}`;
    const duplicates = appendWindowEvents(duplicateWindows.get(duplicateKey) ?? [], 1, settings.floodWindowSeconds * 1000, now);
    duplicateWindows.set(duplicateKey, duplicates);
    duplicateCount = duplicates.length;
    const linkCount = (text.match(/(?:https?:\/\/|t\.me\/|www\.)/gi) ?? []).length;
    const risk = calculateRiskScore({ messageCount: times.length, duplicateCount, linkCount, joinVelocity: 0 });
    if (risk.level === "high" || risk.level === "critical") {
      riskCooldowns.set(key, now + risk.cooldownSeconds * 1000);
      void recordGroupAuditEvent({ groupId, actorTelegramId: ctx.from.id, action: "anti_spam_risk_cooldown", outcome: "completed", details: { score: risk.score, level: risk.level, cooldownSeconds: risk.cooldownSeconds, messageCount: times.length, duplicateCount, linkCount } });
    }
    if (duplicates.length > settings.duplicateMessageLimit) {
      await notifyEnforcement(ctx, "به‌دلیل تکرار پیاپی پیام‌ها، به‌مدت 5 دقیقه محدود شد.");
      await deleteMessageSafely(ctx);
      await ctx.telegram.restrictChatMember(ctx.chat!.id, ctx.from.id, { permissions: { can_send_messages: false }, until_date: Math.floor((now + FLOOD_MUTE_SECONDS * 1000) / 1000) });
      await writeAuditLog({ severity: "warning", category: "anti_spam", event: "duplicate_mute", groupId, actorTelegramId: ctx.from.id, details: { count: duplicates.length } });
      await recordGroupAuditEvent({ groupId, actorTelegramId: ctx.from.id, action: "anti_spam_duplicate_mute", outcome: "completed", details: { count: duplicates.length, cooldownSeconds: getRiskCooldownRemaining(key, now) } });
      await notifyGroupEvent({
        groupId,
        eventType: "protection.anti_spam",
        actor: { telegramUserId: ctx.from.id, displayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || String(ctx.from.id), username: ctx.from.username },
        subject: { telegramUserId: ctx.from.id, displayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || String(ctx.from.id), username: ctx.from.username },
        details: { summary: `به‌دلیل ${duplicates.length.toLocaleString("en-US")} پیام تکراری، سکوت موقت 5 دقیقه‌ای اعمال شد.` },
        eventKey: `anti-spam-duplicate:${groupId}:${ctx.from.id}:${Math.floor(now / 10000)}`,
        telegram: ctx.telegram,
      });
      return true;
    }
  }
  if (times.length > settings.floodMessageLimit) {
    await notifyEnforcement(ctx, "به‌دلیل ارسال پیاپی پیام‌ها، به‌مدت 5 دقیقه محدود شد.");
    await deleteMessageSafely(ctx);
    await ctx.telegram.restrictChatMember(ctx.chat!.id, ctx.from.id, { permissions: { can_send_messages: false }, until_date: Math.floor((now + FLOOD_MUTE_SECONDS * 1000) / 1000) });
    await writeAuditLog({ severity: "warning", category: "anti_spam", event: "flood_mute", groupId, actorTelegramId: ctx.from.id, details: { count: times.length } });
    await recordGroupAuditEvent({ groupId, actorTelegramId: ctx.from.id, action: "anti_spam_flood_mute", outcome: "completed", details: { count: times.length, duplicateCount, cooldownSeconds: getRiskCooldownRemaining(key, now) } });
    await notifyGroupEvent({
      groupId,
      eventType: "protection.anti_spam",
      actor: { telegramUserId: ctx.from.id, displayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || String(ctx.from.id), username: ctx.from.username },
      subject: { telegramUserId: ctx.from.id, displayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || String(ctx.from.id), username: ctx.from.username },
      details: { summary: `به‌دلیل ${times.length.toLocaleString("en-US")} پیام در بازهٔ محدود، سکوت موقت 5 دقیقه‌ای اعمال شد.` },
      eventKey: `anti-spam-flood:${groupId}:${ctx.from.id}:${Math.floor(now / 10000)}`,
      telegram: ctx.telegram,
    });
    return true;
  }
  return false;
}

/** Runs after owner/forced-join/moderation middleware; returns true when a message was fully handled. */
export async function handleGroupMessageSafety(ctx: Context): Promise<boolean> {
  pruneSafetyWindows();
  const message = (ctx.message ?? ctx.editedMessage) as MessageLike | undefined;
  const isEditedMessage = Boolean(ctx.editedMessage);
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") || !ctx.from || !message) return false;
  const sourceMessageId = (message as MessageLike & { message_id?: number }).message_id;
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) return false;
  const text = messageText(ctx);
  const isBotAuthor = Boolean(ctx.from.is_bot);
  const db = await getDb();
  if (!db) return false;
  let settings = await loadSettings(group.id);
  if (!settings) {
    await db.insert(groupSettings).values({ groupId: group.id }).onDuplicateKeyUpdate({ set: {} });
    settings = await loadSettings(group.id);
  }
  if (!settings) return false;
  const access = isBotAuthor ? "user" : await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  if (shouldEnforceGroupLock(Boolean(settings.groupLocked), access)) {
    const deleted = await deleteMessageSafely(ctx);
    await writeAuditLog({ category: "group_lock", event: "message_blocked", groupId: group.id, actorTelegramId: ctx.from.id, details: { deleted, messageId: sourceMessageId ?? null, actorIsBot: isBotAuthor } });
    void recordGroupAuditEvent({ groupId: group.id, actorTelegramId: ctx.from.id, action: "group_lock.message_blocked", outcome: deleted ? "completed" : "failed", details: { messageId: sourceMessageId ?? null, actorIsBot: isBotAuthor } });
    return true;
  }
  if (isLinkedChannelAutomaticForward(message)) return false;
  if (!isEditedMessage && !isBotAuthor && await handleConfiguration(ctx, group.id, text)) return true;
  const vipPolicy = !isBotAuthor ? await getVipProtectionPolicy(group.id, ctx.from.id) : undefined;
  if (!isBotAuthor && !vipPolicy?.ignoreAntiSpam && await enforceFlood(ctx, group.id, settings, access)) return true;

  const custom = !isBotAuthor && text ? (await db.select().from(customCommands).where(and(eq(customCommands.groupId, group.id), eq(customCommands.trigger, text.trim().toLocaleLowerCase("fa-IR")), eq(customCommands.enabled, true))).limit(1))[0] : undefined;
  if (custom) {
    await ctx.reply(custom.response);
    return true;
  }

  const vip = !isBotAuthor && await isVip(group.id, ctx.from.id);
  const lockTypes = classifyLockedContent(message);
  const locks = await getEnabledLocks(group.id);
  const violatedLock = locks.find(lock => shouldEnforceLock(lock, lockTypes, access, vip));
  if (violatedLock) {
    const deleted = await deleteMessageSafely(ctx);
    try {
      await notifyEnforcement(ctx, deleted
        ? formatLockEnforcementNotice(violatedLock.lockType, violatedLock.action)
        : `${formatLockEnforcementNotice(violatedLock.lockType, violatedLock.action)} ربات مجوز حذف پیام را ندارد؛ مدیر گروه باید دسترسی «Delete messages» را فعال کند.`);
    } catch (error) {
      console.warn("[Kronos Guard] content-lock notice failed after delete attempt", error);
    }
    if (violatedLock.action === "mute") await ctx.telegram.restrictChatMember(ctx.chat.id, ctx.from.id, { permissions: { can_send_messages: false }, until_date: Math.floor(Date.now() / 1000) + FLOOD_MUTE_SECONDS });
    await writeAuditLog({ category: "content_lock", event: "enforced", groupId: group.id, actorTelegramId: ctx.from.id, details: { lockType: violatedLock.lockType, action: violatedLock.action, deleted } });
    await notifyGroupEvent({
      groupId: group.id,
      eventType: "protection.content_lock",
      actor: { telegramUserId: ctx.from.id, displayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || String(ctx.from.id), username: ctx.from.username },
      subject: { telegramUserId: ctx.from.id, displayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || String(ctx.from.id), username: ctx.from.username },
      details: { summary: `قفل ${violatedLock.lockType} اجرا شد؛ اقدام: ${violatedLock.action}${deleted ? "، پیام حذف شد." : "."}` },
      eventKey: `content-lock:${group.id}:${ctx.from.id}:${sourceMessageId ?? Date.now()}`,
      telegram: ctx.telegram,
    });
    return true;
  }

  if (text && !hasAtLeastAccess(access, "moderator") && !vipPolicy?.ignoreFilters) {
    const filters = await db.select().from(filterRules).where(and(eq(filterRules.groupId, group.id), eq(filterRules.enabled, true)));
    const violatedFilter = filters.find(rule => matchesFilter(rule.pattern, rule.matchType, text));
    if (violatedFilter) {
      await notifyEnforcement(ctx, `پیام شما با قوانین فیلتر این گروه سازگار نیست و حذف شد.${violatedFilter.action === "mute" ? " دسترسی ارسال پیام نیز موقتاً محدود شد." : violatedFilter.action === "ban" ? " دسترسی شما به گروه نیز مسدود شد." : ""}`);
      await deleteMessageSafely(ctx);
      if (violatedFilter.action === "mute") await ctx.telegram.restrictChatMember(ctx.chat.id, ctx.from.id, { permissions: { can_send_messages: false }, until_date: Math.floor(Date.now() / 1000) + FLOOD_MUTE_SECONDS });
      if (violatedFilter.action === "ban") await ctx.telegram.banChatMember(ctx.chat.id, ctx.from.id);
      await writeAuditLog({ category: "filter", event: "enforced", groupId: group.id, actorTelegramId: ctx.from.id, details: { ruleId: violatedFilter.id, action: violatedFilter.action } });
      await notifyGroupEvent({
        groupId: group.id,
        eventType: "protection.content_lock",
        actor: { telegramUserId: ctx.from.id, displayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || String(ctx.from.id), username: ctx.from.username },
        subject: { telegramUserId: ctx.from.id, displayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || String(ctx.from.id), username: ctx.from.username },
        details: { summary: `فیلتر محتوایی شمارهٔ ${violatedFilter.id.toLocaleString("en-US")} اجرا شد؛ اقدام: ${violatedFilter.action}.` },
        eventKey: `filter-enforcement:${group.id}:${violatedFilter.id}:${ctx.from.id}:${sourceMessageId ?? Date.now()}`,
        telegram: ctx.telegram,
      });
      return true;
    }
  }
  return false;
}

type GreetingTemplateInput = {
  name: string; username?: string; group: string; telegramUserId?: number; chatId?: number; now?: Date; botUsername?: string;
  groupUsername?: string | null; rulesText?: string | null; locale?: string | null; timezone?: string | null;
};

export const DEFAULT_WELCOME_TEMPLATE = "سلام منشن_کاربر عزیز\nبه گروه نام_گروه خوش آمدی\n\nساعت: زمان_ساعت\nتاریخ: زمان_تاریخ";
export const DEFAULT_GOODBYE_TEMPLATE = "منشن_کاربر از گروه نام_گروه خارج شد\n\nساعت: زمان_ساعت\nتاریخ: زمان_تاریخ";

export function resolveGreetingTemplate(kind: "welcome" | "goodbye", template?: string | null) {
  return template?.trim() || (kind === "welcome" ? DEFAULT_WELCOME_TEMPLATE : DEFAULT_GOODBYE_TEMPLATE);
}

const persianTemplateAliases: Record<string, string> = {
  "منشن_کاربر": "mention", "نام_کاربر": "name", "آیدی_کاربر": "username", "آیدی_عددی_کاربر": "userid",
  "لینک_گروه": "grouplink", "قوانین_گروه": "rules", "نام_گروه": "group", "زمان_تاریخ": "date", "زمان_ساعت": "time",
  "تاریخ_شمسی": "jalalidate", "تاریخ_میلادی": "gregoriandate", "ساعت_دقیقه": "shorttime", "ساعت_دقیقه_ثانیه": "fulltime",
  "ایموجی_خودکار": "autoemoji", "عدد_سال": "year", "اسم_ماه": "monthname", "عدد_ماه": "month", "اسم_روز": "weekday",
  "عدد_روز": "day", "عدد_ساعت": "hour", "عدد_دقیقه": "minute",
};

function escapeTemplateHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function applyTelegramMarkup(value: string) {
  const inline = (line: string) => line
    .replace(/`([^`\n]{1,512})`/g, "<code>$1</code>")
    .replace(/\|\|([^|\n]{1,1500})\|\|/g, "<tg-spoiler>$1</tg-spoiler>")
    .replace(/~~([^~\n]{1,1500})~~/g, "<s>$1</s>")
    .replace(/__([^_\n]{1,1500})__/g, "<u>$1</u>")
    .replace(/\*\*([^*\n]{1,1500})\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*\n]{1,1500})\*(?!\*)/g, "$1<i>$2</i>");
  return value.split("\n").map(line => line.startsWith("&gt;") ? `<blockquote>${inline(line.replace(/^&gt;\s?/, ""))}</blockquote>` : inline(line)).join("\n");
}

function groupLocale(locale?: string | null) {
  return locale?.toLocaleLowerCase().startsWith("fa") ? "fa-IR-u-ca-persian" : (locale || "en-US");
}

function timeEmoji(now: Date, timeZone?: string | null) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: timeZone || "Asia/Tehran" }).format(now));
  if (hour < 6) return "🌙";
  if (hour < 12) return "🌤";
  if (hour < 18) return "☀️";
  return "🌙";
}

/** Renders escaped user text plus the documented Markdown-style Telegram formats and safe variables. */
export function renderTemplate(template: string, input: GreetingTemplateInput) {
  const now = input.now ?? new Date();
  const locale = groupLocale(input.locale);
  const dateOptions = { timeZone: input.timezone || "Asia/Tehran" };
  const dateParts = new Intl.DateTimeFormat(locale, { ...dateOptions, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const timeParts = new Intl.DateTimeFormat(locale, { ...dateOptions, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  const clock = (second: boolean) => {
    const parts = new Intl.DateTimeFormat(locale, { ...dateOptions, hour: "2-digit", minute: "2-digit", ...(second ? { second: "2-digit" as const } : {}), hourCycle: "h23" }).formatToParts(now);
    return [part(parts, "hour"), part(parts, "minute"), ...(second ? [part(parts, "second")] : [])].join(":");
  };
  const jalaliDate = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { ...dateOptions, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const gregorianDate = new Intl.DateTimeFormat("en-CA-u-ca-gregory", { ...dateOptions, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const displayName = escapeTemplateHtml(input.name);
  const values: Record<string, string> = {
    name: displayName, first_name: escapeTemplateHtml(input.name.split(" ")[0] || input.name), last_name: escapeTemplateHtml(input.name.split(" ").slice(1).join(" ")),
    username: escapeTemplateHtml(input.username ? `@${input.username}` : input.name), group: escapeTemplateHtml(input.group), gap_name: escapeTemplateHtml(input.group),
    mention: input.telegramUserId ? `<a href="tg://user?id=${input.telegramUserId}">${displayName}</a>` : displayName,
    userid: String(input.telegramUserId ?? ""), user_id: String(input.telegramUserId ?? ""), chatid: String(input.chatId ?? ""), chat_id: String(input.chatId ?? ""),
    grouplink: input.groupUsername ? `<a href="https://t.me/${encodeURIComponent(input.groupUsername)}">${escapeTemplateHtml(input.group)}</a>` : escapeTemplateHtml(input.group),
    rules: escapeTemplateHtml(input.rulesText ?? ""), date: new Intl.DateTimeFormat(locale, { ...dateOptions, dateStyle: "medium" }).format(now), time: new Intl.DateTimeFormat(locale, { ...dateOptions, timeStyle: "short" }).format(now),
    jalalidate: jalaliDate, jalali_date: jalaliDate, gregoriandate: gregorianDate, gregorian_date: gregorianDate,
    shorttime: clock(false), short_time: clock(false), fulltime: clock(true), full_time: clock(true),
    year: part(dateParts, "year"), month: part(dateParts, "month"), day: part(dateParts, "day"), monthname: new Intl.DateTimeFormat(locale, { ...dateOptions, month: "long" }).format(now),
    weekday: new Intl.DateTimeFormat(locale, { ...dateOptions, weekday: "long" }).format(now), hour: part(timeParts, "hour"), minute: part(timeParts, "minute"),
    autoemoji: timeEmoji(now, input.timezone), botuser: escapeTemplateHtml(input.botUsername ?? "KronosGuard"), person: displayName,
  };
  const escaped = escapeTemplateHtml(template);
  const aliases = Object.keys(persianTemplateAliases).sort((left, right) => right.length - left.length).join("|");
  const pattern = new RegExp(`\\{([a-z_]+|${aliases})\\}|\\[([A-Z_]+)\\]|(${aliases})`, "g");
  return applyTelegramMarkup(escaped.replace(pattern, (token, braced, bracketed, persian) => {
    const raw = String(braced ?? bracketed ?? "");
    const key = persian ? persianTemplateAliases[persian] : (persianTemplateAliases[raw] ?? raw.toLocaleLowerCase("en-US"));
    return values[key] ?? token;
  }));
}

export const greetingTemplateHelpFa = "فرمت‌ها: **بولد**، *ایتالیک*، > نقل‌قول، ~~خط‌خورده~~، ||اسپویلر||، __زیرخط__ و `کد`. متغیرها: منشن_کاربر، نام_کاربر، آیدی_کاربر، آیدی_عددی_کاربر، لینک_گروه، قوانین_گروه، نام_گروه، زمان_تاریخ، زمان_ساعت، تاریخ_شمسی، تاریخ_میلادی، ساعت_دقیقه، ساعت_دقیقه_ثانیه، ایموجی_خودکار، عدد_سال، اسم_ماه، عدد_ماه، اسم_روز، عدد_روز، عدد_ساعت و عدد_دقیقه. پیش‌نمایش بدون ذخیره: خوشامد پیش‌نمایش یا خداحافظ پیش‌نمایش. بازگشت به قالب پیش‌فرض: خوشامد بازنشانی یا خداحافظ بازنشانی.";

export function greetingTemplateInput(chat: { id: number; title: string; username?: string; language?: string | null; timezone?: string | null; rulesText?: string | null }, member: { id: number; first_name: string; last_name?: string; username?: string }) {
  return {
    name: [member.first_name, member.last_name].filter(Boolean).join(" "),
    username: member.username,
    group: chat.title,
    telegramUserId: member.id,
    chatId: chat.id,
    groupUsername: chat.username,
    locale: chat.language,
    timezone: chat.timezone,
    rulesText: chat.rulesText,
  };
}

export async function handleGroupJoinOrLeave(ctx: Context) {
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") || !ctx.message) return;
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) return;
  const settings = await loadSettings(group.id);
  if (!settings) return;
  const message = ctx.message as any;
  if (message.new_chat_members?.length) {
    const now = Date.now();
    const times = appendWindowEvents(joinWindows.get(group.id) ?? [], message.new_chat_members.length, RAID_WINDOW_MS, now);
    joinWindows.set(group.id, times);
    if (settings.antiRaidEnabled && isRaidWave(times.length)) {
      const raidModeUntil = getRaidModeExpiry(now);
      await (await getDb())?.insert(groupSettings).values({ groupId: group.id, raidModeUntil }).onDuplicateKeyUpdate({ set: { raidModeUntil } });
      const newMembers = (await Promise.all(message.new_chat_members.filter((member: { id: number; is_bot?: boolean }) => !member.is_bot).map(async (member: { id: number }) => ({ member, protected: await isVipProtected(group.id, member.id, "ignoreAntiRaid") })))).filter(entry => !entry.protected).map(entry => entry.member);
      const restriction = { permissions: { can_send_messages: false }, until_date: Math.floor(raidModeUntil.getTime() / 1000) };
      const restrictionResults = await Promise.allSettled(newMembers.map((member: { id: number }) => ctx.telegram.restrictChatMember(ctx.chat!.id, member.id, restriction)));
      const restrictedMembers = restrictionResults.filter(result => result.status === "fulfilled").length;
      const bot = (await import("./bot")).getTelegramBot();
      if (bot) await alertOwner(bot.telegram, { alertType: "raid", severity: "critical", title: "حمله ورود گروهی شناسایی شد", body: `در گروه «${ctx.chat.title}» در کمتر از یک دقیقه ${times.length} عضو جدید وارد شدند.`, dedupeKey: `raid-${group.id}-${new Date().toISOString().slice(0, 13)}`, relatedEntityType: "telegram_group", relatedEntityId: group.id });
      await writeAuditLog({ severity: "critical", category: "anti_raid", event: "join_wave", groupId: group.id, details: { joins: times.length, raidModeUntil: raidModeUntil.toISOString(), restrictedMembers } });
      await recordGroupAuditEvent({ groupId: group.id, action: "anti_raid_mode_activated", outcome: "completed", details: { source: "automatic_join_wave", joins: times.length, restrictedMembers, durationSeconds: RAID_MODE_SECONDS } });
      await notifyGroupEvent({
        groupId: group.id,
        eventType: "protection.raid",
        actor: { telegramUserId: ctx.botInfo?.id, displayName: ctx.botInfo?.first_name ?? "Kronos Guard", username: ctx.botInfo?.username, isBot: true },
        details: { summary: `ضدحمله پس از ${times.length.toLocaleString("en-US")} ورود در کمتر از یک دقیقه فعال شد؛ ${restrictedMembers.toLocaleString("en-US")} عضو تازه موقتاً محدود شدند.`, nextValue: "فعال" },
        eventKey: `automatic-raid:${group.id}:${Math.floor(now / 60000)}`,
        telegram: ctx.telegram,
      });
    }
    if (settings.welcomeEnabled) {
      for (const member of message.new_chat_members) {
        if (!member.is_bot) await ctx.reply(renderTemplate(resolveGreetingTemplate("welcome", settings.welcomeMessage), greetingTemplateInput({ id: ctx.chat.id, title: ctx.chat.title, username: "username" in ctx.chat ? ctx.chat.username : undefined, language: group.language, timezone: group.timezone, rulesText: settings.rulesText }, member)), { parse_mode: "HTML" });
      }
    }
  }
  if (message.left_chat_member && settings.goodbyeEnabled && !message.left_chat_member.is_bot) {
    const member = message.left_chat_member;
    await ctx.reply(renderTemplate(resolveGreetingTemplate("goodbye", settings.goodbyeMessage), greetingTemplateInput({ id: ctx.chat.id, title: ctx.chat.title, username: "username" in ctx.chat ? ctx.chat.username : undefined, language: group.language, timezone: group.timezone, rulesText: settings.rulesText }, member)), { parse_mode: "HTML" });
  }
}
