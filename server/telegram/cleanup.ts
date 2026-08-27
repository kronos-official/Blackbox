import { Markup, type Context } from "telegraf";
import { hasKronosModerationAccess, resolveAccessLevel } from "./authorization";
import type { AccessLevel } from "./constants";
import { findGroupByChatId, removeRecentGroupMessageIds, writeAuditLog } from "./repository";
import { withTelegramRetry } from "./retry";
import { recordGroupAuditEvent } from "./policyAudit";
import { commandRemainder, normalizeCommandDigits } from "./commandInput";
import { notifyGroupEvent } from "./groupEventNotifier";
import { withTelegramButtonStyle } from "./buttonStyle";
import { deleteTemporaryCommandSuccess, telegramMessageId } from "./temporarySuccess";

const MAX_CLEANUP_MESSAGES = 100;
const CLEANUP_CONFIRMATION_TTL_MS = 60_000;
// Keep extra Telegram message IDs so an already-deleted, protected, or unsupported
// message does not consume the user's requested deletion quota.
const CLEANUP_CANDIDATE_BUFFER = 25;

type PendingCleanupConfirmation = {
  actorTelegramId: number;
  groupId: number;
  groupChatId: number;
  requestedCount: number;
  availableCandidateCount: number;
  candidateMessageIds: number[];
  commandMessageId: number;
  expiresAt: number;
};

const pendingCleanupConfirmations = new Map<string, PendingCleanupConfirmation>();

type CleanupDeleteFailure = "not_found" | "permission" | "too_old_or_unsupported" | "unknown";

function telegramDeleteFailureDescription(error: unknown): string {
  if (error && typeof error === "object" && "response" in error) {
    const response = (error as { response?: { description?: unknown } }).response;
    if (typeof response?.description === "string") return response.description;
  }
  return error instanceof Error ? error.message : "";
}

export function classifyCleanupDeleteFailure(error: unknown): CleanupDeleteFailure {
  const description = telegramDeleteFailureDescription(error).toLowerCase();
  if (description.includes("not found")) return "not_found";
  if (description.includes("not enough rights") || description.includes("not allowed")) return "permission";
  if (description.includes("can't be deleted") || description.includes("cannot be deleted") || description.includes("too old")) return "too_old_or_unsupported";
  return "unknown";
}

function cleanupFailureMessage(failure: CleanupDeleteFailure): string {
  if (failure === "permission") return "Telegram ادامهٔ حذف را نپذیرفت؛ مجوز «حذف پیام‌ها»ی ربات را بررسی کنید.";
  if (failure === "too_old_or_unsupported") return "بخشی از پیام‌ها قدیمی، سیستمی یا غیرقابل‌حذف بودند.";
  if (failure === "not_found") return "بخشی از شناسه‌ها پیش از اجرا حذف شده یا دیگر در گروه در دسترس نبودند.";
  return "Telegram برای بخشی از پیام‌ها پاسخ قابل‌تشخیص نداد؛ بعداً دوباره تلاش کنید.";
}

/** Telegram permits removing other members' messages only for a group administrator with the delete-messages right. */
export function canBotDeleteGroupMessages(member: { status: string; can_delete_messages?: boolean } | undefined) {
  return member?.status === "creator"
    || member?.status === "owner"
    || (member?.status === "administrator" && member.can_delete_messages === true);
}

export function isCleanupAccessLevelAllowed(access: AccessLevel) {
  return hasKronosModerationAccess(access);
}

export function parseCleanupCommand(text: string): number | undefined {
  const remainder = ["حذف", "پاکسازی", "delete", "clear"]
    .map(command => commandRemainder(text, command))
    .find(value => value !== undefined);
  const normalizedRemainder = remainder === undefined ? undefined : normalizeCommandDigits(remainder);
  const count = normalizedRemainder && /^\d{1,3}$/.test(normalizedRemainder) ? Number(normalizedRemainder) : undefined;
  return count && count >= 1 && count <= MAX_CLEANUP_MESSAGES ? count : undefined;
}

function isManagedGroupContext(ctx: Pick<Context, "chat">) {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

function cleanupConfirmationToken() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function cleanupConfirmationKeyboard(token: string) {
  return Markup.inlineKeyboard([[
    withTelegramButtonStyle(Markup.button.callback("لغو", `cleanup-confirm:no:${token}`), "danger"),
    withTelegramButtonStyle(Markup.button.callback("تأیید", `cleanup-confirm:yes:${token}`), "success"),
  ]]).reply_markup;
}

function cleanupCandidateLimit(count: number) {
  return Math.min(MAX_CLEANUP_MESSAGES + CLEANUP_CANDIDATE_BUFFER, count + CLEANUP_CANDIDATE_BUFFER);
}

/**
 * Telegram does not expose chat-history reads to bots. Message IDs are sequential
 * in each chat though, so safely attempt a bounded recent window. This includes
 * user messages, third-party bot messages, and Kronos's own messages even when
 * their outbound tracking record was not available.
 */
export function buildCleanupCandidateMessageIds(commandMessageId: number, count: number) {
  if (!Number.isSafeInteger(commandMessageId) || commandMessageId < 1) return [];
  const length = Math.min(commandMessageId, cleanupCandidateLimit(count));
  return Array.from({ length }, (_, index) => commandMessageId - index);
}

function cleanupConfirmationText(requestedCount: number, availableCandidateCount: number) {
  return `<b>تأیید پاک‌سازی گروه</b>\n\n📊 <b>شناسه‌های پیام در صف بررسی:</b> ${availableCandidateCount.toLocaleString("en-US")} پیام برای ${requestedCount.toLocaleString("en-US")} حذف درخواستی\n\nپیام‌های اعضا، ربات‌ها و پیام‌های Kronos Guard تا حد مجاز Telegram بررسی می‌شوند.\n\nآیا از اجرای پاک‌سازی اطمینان دارید؟\n\n⏳ <b>زمان باقی‌مانده:</b> 60 ثانیه`;
}

function messageIdFromTelegramMessage(message: unknown) {
  return message && typeof message === "object" && "message_id" in message && typeof message.message_id === "number" ? message.message_id : undefined;
}

function scheduleCleanupConfirmationExpiry(token: string, telegram: Context["telegram"], chatId: number, confirmationMessageId?: number) {
  const timer = setTimeout(() => {
    const pending = pendingCleanupConfirmations.get(token);
    if (!pending || pending.expiresAt > Date.now()) return;
    pendingCleanupConfirmations.delete(token);
    if (confirmationMessageId) void telegram.deleteMessage(chatId, confirmationMessageId).catch(() => undefined);
  }, CLEANUP_CONFIRMATION_TTL_MS);
  timer.unref?.();
}

async function canExecuteCleanup(ctx: Context, group: { id: number }, count: number) {
  if (!ctx.chat || !ctx.from) return false;
  const access = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  const allowed = isCleanupAccessLevelAllowed(access);
  void recordGroupAuditEvent({ groupId: group.id, actorTelegramId: ctx.from.id, action: "command.cleanup.access", outcome: allowed ? "allowed" : "denied", details: { resolvedAccess: access, requested: count } });
  if (!allowed) return false;

  const botIdentity = await ctx.telegram.getMe().catch(() => undefined);
  const botMembership = botIdentity
    ? await ctx.telegram.getChatMember(ctx.chat.id, botIdentity.id).catch(() => undefined)
    : undefined;
  if (!canBotDeleteGroupMessages(botMembership)) {
    void recordGroupAuditEvent({ groupId: group.id, actorTelegramId: ctx.from.id, action: "command.cleanup.bot_permission", outcome: "denied", details: { requested: count, botStatus: botMembership?.status ?? "unknown" } });
    return false;
  }
  return true;
}

async function executeConfirmedCleanup(ctx: Context, group: { id: number }, count: number, candidateMessageIds: number[], commandMessageId: number) {
  if (!ctx.chat || !ctx.from) return "⚠️ اجرای پاک‌سازی ممکن نشد.";

  let deleted = 0;
  let firstFailure: CleanupDeleteFailure | undefined;
  const retiredMessageIds: number[] = [];
  const rejectedMessageIds: Array<{ messageId: number; failure: CleanupDeleteFailure }> = [];
  for (const messageId of candidateMessageIds) {
    if (deleted >= count) break;
    try {
      await withTelegramRetry(() => ctx.telegram.deleteMessage(ctx.chat!.id, messageId));
      deleted += 1;
      retiredMessageIds.push(messageId);
    } catch (error) {
      const failure = classifyCleanupDeleteFailure(error);
      firstFailure ??= failure;
      rejectedMessageIds.push({ messageId, failure });
      if (failure === "not_found" || failure === "too_old_or_unsupported") retiredMessageIds.push(messageId);
      // A single protected/system message must not prevent later bot-authored
      // messages in the candidate window from being attempted.
    }
  }
  await removeRecentGroupMessageIds(group.id, retiredMessageIds);
  const attempted = deleted + rejectedMessageIds.length;
  const failed = rejectedMessageIds.length;
  const unavailable = Math.max(0, count - deleted);
  const details = {
    requested: count,
    candidatesStored: candidateMessageIds.length,
    attempted,
    deleted,
    failed,
    unavailable,
    firstFailure,
    rejectedMessageIds: rejectedMessageIds.slice(0, 10),
  };
  await writeAuditLog({ category: "cleanup", event: "bulk_delete", groupId: group.id, actorTelegramId: ctx.from.id, details });
  void recordGroupAuditEvent({ groupId: group.id, actorTelegramId: ctx.from.id, action: "command.cleanup.completed", outcome: "completed", details });
  const summary = deleted === count
    ? `✅ ${deleted.toLocaleString("en-US")} پیام حذف شد.`
    : `⚠️ ${deleted.toLocaleString("en-US")} پیام حذف شد.`;
  await notifyGroupEvent({
    groupId: group.id,
    eventType: "moderation.delete",
    actor: { telegramUserId: ctx.from.id, displayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || String(ctx.from.id), username: ctx.from.username },
    details: { summary },
    eventKey: `cleanup:${group.id}:${ctx.from.id}:${commandMessageId}`,
    telegram: ctx.telegram,
  });
  return summary;
}

/** Requests an actor-bound confirmation before deleting a bounded number of recent group messages. */
export async function handleCleanupCommand(ctx: Context): Promise<boolean> {
  if (!ctx.chat || !isManagedGroupContext(ctx) || !ctx.from || !ctx.message || !("text" in ctx.message)) return false;
  const count = parseCleanupCommand(ctx.message.text);
  if (!count) return false;
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) return false;
  const executable = await canExecuteCleanup(ctx, group, count);
  if (!executable) {
    const access = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
    await ctx.reply(isCleanupAccessLevelAllowed(access)
      ? "برای پاک‌کردن پیام‌های همهٔ اعضا، ربات باید مدیر گروه باشد و دسترسی «حذف پیام‌ها» را داشته باشد."
      : "فقط مدیران مجاز گروه یا Kronos می‌توانند پیام‌ها را پاکسازی کنند.");
    return true;
  }

  const candidateMessageIds = buildCleanupCandidateMessageIds(ctx.message.message_id, count);
  const availableCandidateCount = Math.min(count, candidateMessageIds.length);
  if (availableCandidateCount === 0) {
    await ctx.reply("شناسهٔ معتبری برای بررسی حذف در این گروه پیدا نشد.");
    return true;
  }
  void recordGroupAuditEvent({
    groupId: group.id,
    actorTelegramId: ctx.from.id,
    action: "command.cleanup.preflight",
    outcome: "completed",
    details: { requested: count, availableCandidateCount, candidateWindow: candidateMessageIds.length },
  });

  const token = cleanupConfirmationToken();
  const pending: PendingCleanupConfirmation = {
    actorTelegramId: ctx.from.id,
    groupId: group.id,
    groupChatId: ctx.chat.id,
    requestedCount: count,
    availableCandidateCount,
    candidateMessageIds,
    commandMessageId: ctx.message.message_id,
    expiresAt: Date.now() + CLEANUP_CONFIRMATION_TTL_MS,
  };
  pendingCleanupConfirmations.set(token, pending);
  const confirmationMessage = await ctx.reply(cleanupConfirmationText(count, availableCandidateCount), {
    parse_mode: "HTML",
    reply_markup: cleanupConfirmationKeyboard(token),
  });
  scheduleCleanupConfirmationExpiry(token, ctx.telegram, ctx.chat.id, messageIdFromTelegramMessage(confirmationMessage));
  return true;
}

/** Consumes a one-time cleanup confirmation callback and executes only after a valid yes decision. */
export async function handleCleanupConfirmation(ctx: Context): Promise<boolean> {
  const callbackData = ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
  const match = typeof callbackData === "string" ? callbackData.match(/^cleanup-confirm:(yes|no):([a-z0-9]{8,32})$/i) : null;
  if (!match || !ctx.chat || !ctx.from || !isManagedGroupContext(ctx)) return false;
  const [, decision, token] = match;
  const pending = pendingCleanupConfirmations.get(token);
  if (!pending || pending.expiresAt <= Date.now()) {
    pendingCleanupConfirmations.delete(token);
    await ctx.answerCbQuery("این تأیید منقضی شده یا برای شما نیست.", { show_alert: true }).catch(() => undefined);
    return true;
  }
  if (pending.actorTelegramId !== ctx.from.id || pending.groupChatId !== ctx.chat.id) {
    await ctx.answerCbQuery("این تأیید منقضی شده یا برای شما نیست.", { show_alert: true }).catch(() => undefined);
    return true;
  }
  pendingCleanupConfirmations.delete(token);
  await ctx.answerCbQuery().catch(() => undefined);
  if (decision === "no") {
    await ctx.editMessageText("پاک‌سازی لغو شد.").catch(() => undefined);
    return true;
  }

  const group = await findGroupByChatId(ctx.chat.id);
  if (!group || group.id !== pending.groupId || !(await canExecuteCleanup(ctx, group, pending.requestedCount))) {
    await ctx.editMessageText("دسترسی شما یا مجوز حذف پیام‌های ربات برای اجرای پاک‌سازی کافی نیست.").catch(() => undefined);
    return true;
  }
  const summary = await executeConfirmedCleanup(ctx, group, pending.requestedCount, pending.candidateMessageIds, pending.commandMessageId);
  const edited = await ctx.editMessageText(summary).catch(() => undefined);
  if (summary.startsWith("✅")) {
    const callbackMessage = ctx.callbackQuery && "message" in ctx.callbackQuery ? ctx.callbackQuery.message : undefined;
    await deleteTemporaryCommandSuccess({
      telegram: ctx.telegram,
      chatId: ctx.chat.id,
      messageId: telegramMessageId(edited) ?? telegramMessageId(callbackMessage),
    });
  }
  return true;
}
