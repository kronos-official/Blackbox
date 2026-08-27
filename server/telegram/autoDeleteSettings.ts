import type { Context } from "telegraf";
import { resolveAccessLevel, hasKronosModerationAccess } from "./authorization";
import { normalizeCommandDigits, normalizeCommandInput } from "./commandInput";
import { getGroupEventNotificationPreferences, updateGroupEventNotificationPreferences } from "./groupEventPreferences";
import { recordGroupAuditEvent } from "./policyAudit";
import { findGroupByChatId } from "./repository";
import { replySafely } from "./replySafe";
import { deleteTemporaryCommandSuccess, telegramMessageId } from "./temporarySuccess";

const MIN_DELAY_SECONDS = 5;
const MAX_DELAY_SECONDS = 86_400;

export type AutoDeleteDelayCommand = { delaySeconds: number };

const DELAY_UNIT_MULTIPLIERS: Record<string, number> = {
  "": 60,
  "ثانیه": 1,
  "ثانیه‌ای": 1,
  "sec": 1,
  "secs": 1,
  "second": 1,
  "seconds": 1,
  "s": 1,
  "دقیقه": 60,
  "دقیقه‌ای": 60,
  "min": 60,
  "mins": 60,
  "minute": 60,
  "minutes": 60,
  "m": 60,
  "ساعت": 3_600,
  "ساعته": 3_600,
  "hour": 3_600,
  "hours": 3_600,
  "hr": 3_600,
  "hrs": 3_600,
  "h": 3_600,
};

export function formatAutoDeleteDelay(delaySeconds: number) {
  if (delaySeconds % 3_600 === 0) return `${delaySeconds / 3_600} ساعت`;
  if (delaySeconds % 60 === 0) return `${delaySeconds / 60} دقیقه`;
  return `${delaySeconds} ثانیه`;
}

export function parseAutoDeleteDelayCommand(text: string): AutoDeleteDelayCommand | undefined {
  const normalized = normalizeCommandInput(normalizeCommandDigits(text));
  const match = normalized.match(/^(?:زمان\s*حذف|حذف\s*خودکار|auto\s*delete)\s*(\d+)\s*(ثانیه(?:-?ای)?|دقیقه(?:-?ای)?|ساعت|ساعته|sec(?:s)?|second(?:s)?|s|min(?:s)?|minute(?:s)?|m|hour(?:s)?|hr(?:s)?|h)?$/i);
  if (!match) return undefined;
  const count = Number(match[1]);
  const unit = (match[2] ?? "").toLocaleLowerCase("fa-IR");
  const multiplier = DELAY_UNIT_MULTIPLIERS[unit];
  const delaySeconds = count * multiplier;
  if (!Number.isInteger(count) || !multiplier || !Number.isSafeInteger(delaySeconds) || delaySeconds < MIN_DELAY_SECONDS || delaySeconds > MAX_DELAY_SECONDS) return undefined;
  return { delaySeconds };
}

export function autoDeleteDelayHelpText() {
  return `زمان حذف خودکار باید بین ${MIN_DELAY_SECONDS} ثانیه تا 24 ساعت باشد.\nنمونه: زمان حذف 5 ثانیه · زمان حذف 10 دقیقه · زمان حذف 2 ساعت\nبرای سازگاری، عددِ بدون واحد به دقیقه تعبیر می‌شود.`;
}

export function autoDeleteDelayConfirmationText(delaySeconds: number) {
  return `✅ زمان حذف خودکار پیام‌های موقت Kronos Guard برای این گروه روی <b>${formatAutoDeleteDelay(delaySeconds)}</b> تنظیم شد.`;
}

export async function handleAutoDeleteDelayCommand(ctx: Context): Promise<boolean> {
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") || !ctx.from || !ctx.message || !("text" in ctx.message)) return false;
  const command = parseAutoDeleteDelayCommand(ctx.message.text);
  const looksLikeAutoDeleteCommand = /^(?:زمان\s*حذف|حذف\s*خودکار|auto\s*delete)/i.test(normalizeCommandInput(normalizeCommandDigits(ctx.message.text)));
  if (!command && !looksLikeAutoDeleteCommand) return false;
  if (!command) {
    await replySafely(ctx, `⚠️ ${autoDeleteDelayHelpText()}`, { reply_parameters: { message_id: ctx.message.message_id } });
    return true;
  }
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) {
    await replySafely(ctx, "این گروه هنوز راه‌اندازی نشده است. ابتدا «setup» را ارسال کنید.", { reply_parameters: { message_id: ctx.message.message_id } });
    return true;
  }
  const access = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  if (!hasKronosModerationAccess(access)) {
    void recordGroupAuditEvent({ groupId: group.id, actorTelegramId: ctx.from.id, action: "command.auto_delete_delay.access", outcome: "denied", details: { resolvedAccess: access } });
    await replySafely(ctx, "⛔ تغییر زمان حذف خودکار فقط برای مدیران مجاز گروه فعال است.", { reply_parameters: { message_id: ctx.message.message_id } });
    return true;
  }
  const preferences = await updateGroupEventNotificationPreferences(group.id, { temporarySuccessDeleteDelaySeconds: command.delaySeconds });
  void recordGroupAuditEvent({ groupId: group.id, actorTelegramId: ctx.from.id, action: "command.auto_delete_delay.update", outcome: "allowed", details: { delaySeconds: preferences.temporarySuccessDeleteDelaySeconds } });
  const response = await replySafely(ctx, autoDeleteDelayConfirmationText(command.delaySeconds), { parse_mode: "HTML", reply_parameters: { message_id: ctx.message.message_id } });
  await deleteTemporaryCommandSuccess({ telegram: ctx.telegram, chatId: ctx.chat.id, messageId: telegramMessageId(response) });
  return true;
}

export async function getAutoDeleteDelaySeconds(groupId: number) {
  const preferences = await getGroupEventNotificationPreferences(groupId);
  return preferences.temporarySuccessDeleteDelaySeconds;
}
