import type { Context } from "telegraf";
import { hasKronosModerationAccess, resolveAccessLevel } from "./authorization";
import { findGroupByChatId, findTelegramUserByUsername, getKronosMemberTitle, recordKnownGroupMember, setKronosMemberTitle, writeAuditLog } from "./repository";
import { normalizeCommandInput } from "./commandInput";
import { notifyGroupEvent } from "./groupEventNotifier";
import { prepareTargetAwareCommandText, resolveTelegramTarget, targetReferenceFromToken, type TargetReference } from "./targetResolver";
import { deleteTemporaryCommandSuccess, telegramMessageId } from "./temporarySuccess";

type TitleAction = { action: "set"; title: string; target?: TargetReference } | { action: "remove"; target?: TargetReference };
type NicknameTarget = TargetReference;
type NicknameCommand =
  | { action: "set"; title: string; target?: NicknameTarget }
  | { action: "remove" | "show"; target?: NicknameTarget };

const TITLE_OPERATION_TIMEOUT_MS = 10_000;

function normalizeText(value: string) {
  return normalizeCommandInput(value);
}

export function parseNicknameCommand(text: string): NicknameCommand | undefined {
  const normalized = normalizeText(text);
  const remove = normalized.match(/^(?:حذف لقب|پاک کردن لقب)(?:\s*(@[a-zA-Z0-9_]{5,32}|-?\d{5,16}|@__kronos_target__))?$/i);
  if (remove) return { action: "remove", target: targetReferenceFromToken(remove[1]) };
  const match = normalized.match(/^لقب(?:\s*(.+))?$/i);
  if (!match) return undefined;
  const rest = (match[1] ?? "").trim();
  if (!rest) return { action: "show" };
  const displayTarget = rest.match(/^(@[a-zA-Z0-9_]{5,32}|-?\d{5,16}|@__kronos_target__)$/);
  if (displayTarget) return { action: "show", target: targetReferenceFromToken(displayTarget[1]) };
  const targetMatch = rest.match(/^(@[a-zA-Z0-9_]{5,32}|-?\d{5,16}|@__kronos_target__)\s*(.+)$/);
  if (targetMatch) return { action: "set", title: targetMatch[2].trim(), target: targetReferenceFromToken(targetMatch[1]) };
  return { action: "set", title: rest };
}

export function parseAdministratorTitleCommand(text: string): TitleAction | undefined {
  const normalized = normalizeText(text);
  const remove = normalized.match(/^(?:حذف لقب|پاک کردن لقب)(?:\s+(.+))?$/i);
  if (remove) {
    const target = targetReferenceFromToken(remove[1]?.trim());
    return remove[1] && !target ? undefined : { action: "remove", target };
  }
  const match = normalized.match(/^(?:تنظیم لقب|تنظیم\s*لقب)(?:\s*(.+))?$/i);
  if (!match) return undefined;
  const rest = match[1]?.trim() ?? "";
  const targetMatch = rest.match(/^(@[a-zA-Z0-9_]{5,32}|-?\d{5,16}|@__kronos_target__)\s+(.+)$/);
  if (targetMatch) return { action: "set", target: targetReferenceFromToken(targetMatch[1]), title: targetMatch[2].trim() };
  const trailingTargetMatch = rest.match(/^(.+?)\s+(@[a-zA-Z0-9_]{5,32}|-?\d{5,16}|@__kronos_target__)$/);
  if (trailingTargetMatch) return { action: "set", title: trailingTargetMatch[1].trim(), target: targetReferenceFromToken(trailingTargetMatch[2]) };
  return { action: "set", title: rest };
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function targetDisplayName(user: { first_name: string; last_name?: string; username?: string; id: number }) {
  const base = [user.first_name, user.last_name].filter(Boolean).join(" ") || (user.username ? `@${user.username}` : String(user.id));
  return base;
}

function targetMention(user: { first_name: string; last_name?: string; username?: string; id: number }) {
  return `<a href="tg://user?id=${user.id}">${escapeHtml(targetDisplayName(user))}</a>`;
}

async function handleNicknameCommand(ctx: Context, command: NicknameCommand): Promise<boolean> {
  const group = await findGroupByChatId(ctx.chat!.id);
  if (!group) { await ctx.reply("این گروه هنوز راه‌اندازی نشده است."); return true; }
  const reference = command.target ?? (ctx.message && "reply_to_message" in ctx.message && ctx.message.reply_to_message?.from ? { kind: "reply" as const } : undefined);
  const resolved = await resolveTelegramTarget(ctx, reference);
  if (!resolved) { await ctx.reply("کاربر هدف را با ریپلای، منشن، یوزرنیم یا شناسهٔ عددی مشخص کنید."); return true; }
  const target = { id: resolved.telegramUserId, first_name: resolved.displayName, username: resolved.username, is_bot: false };
  const mention = targetMention(target);
  if (command.action === "show") {
    const title = await getKronosMemberTitle({ groupId: group.id, telegramUserId: target.id });
    await ctx.reply(title ? `🏷 لقب ${mention}: «${escapeHtml(title)}»` : `🏷 برای ${mention} لقبی ثبت نشده است.`, { parse_mode: "HTML" });
    return true;
  }
  const actorAccess = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat!.id, telegramUserId: ctx.from!.id }, ctx.telegram);
  if (!hasKronosModerationAccess(actorAccess)) { await ctx.reply("فقط مدیران مجاز گروه یا Kronos می‌توانند لقب تنظیم کنند."); return true; }
  if (command.action === "set" && (!command.title || Array.from(command.title).length > 16)) { await ctx.reply("لقب باید بین ۱ تا ۱۶ نویسه باشد."); return true; }
  const previousTitle = await getKronosMemberTitle({ groupId: group.id, telegramUserId: target.id });
  await recordKnownGroupMember({ groupId: group.id, telegramUserId: target.id, status: "active", telegramRole: "member" });
  const stored = await setKronosMemberTitle({ groupId: group.id, telegramUserId: target.id, title: command.action === "set" ? command.title : null });
  if (stored) {
    await notifyGroupEvent({
      groupId: group.id,
      eventType: "role.title_changed",
      actor: { telegramUserId: ctx.from!.id, displayName: targetDisplayName(ctx.from!) },
      subject: { telegramUserId: target.id, displayName: targetDisplayName(target) },
      details: { previousValue: previousTitle || "بدون لقب", nextValue: command.action === "set" ? command.title : "بدون لقب" },
      eventKey: `kronos-title:${group.id}:${target.id}:${command.action}:${command.action === "set" ? command.title : "none"}:${ctx.message?.message_id ?? Date.now()}`,
      telegram: ctx.telegram,
      includeActorInDashboard: true,
    });
    const response = await ctx.reply(command.action === "set" ? `✅ لقب ${mention} به «${escapeHtml(command.title)}» تغییر کرد.` : `✅ لقب ${mention} حذف شد.`, { parse_mode: "HTML" });
    await deleteTemporaryCommandSuccess({ telegram: ctx.telegram, chatId: ctx.chat!.id, messageId: telegramMessageId(response) });
  }
  else await ctx.reply("ذخیرهٔ لقب انجام نشد. لطفاً دوباره تلاش کنید.");
  return true;
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("TITLE_OPERATION_TIMEOUT")), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type TelegramMemberTagApi = {
  getChatMember: (chatId: number, userId: number) => Promise<{ status: string }>;
  setChatMemberTag?: (chatId: number, userId: number, tag: string) => Promise<unknown>;
  callApi?: (method: string, payload: Record<string, unknown>) => Promise<unknown>;
};

async function setTelegramMemberTag(telegram: TelegramMemberTagApi, chatId: number, userId: number, tag: string) {
  if (telegram.setChatMemberTag) return telegram.setChatMemberTag(chatId, userId, tag);
  if (telegram.callApi) return telegram.callApi("setChatMemberTag", { chat_id: chatId, user_id: userId, tag });
  throw new Error("MEMBER_TAG_API_UNAVAILABLE");
}

function isRegularMemberStatus(status: string) {
  return status === "member" || status === "restricted";
}

/** Sets or clears the Telegram-visible tag for a regular member only. Telegram remains the final authority for the target operation. */
export async function handleAdministratorTitleCommand(ctx: Context): Promise<boolean> {
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") || !ctx.from || !ctx.message || !("text" in ctx.message)) return false;
  const targetAwareText = prepareTargetAwareCommandText(ctx.message);
  const command = parseAdministratorTitleCommand(targetAwareText);
  const nickname = parseNicknameCommand(targetAwareText);
  if (!command) return nickname ? handleNicknameCommand(ctx, nickname) : false;
  const reference = command.target ?? (ctx.message.reply_to_message?.from ? { kind: "reply" as const } : undefined);
  const resolvedTarget = await resolveTelegramTarget(ctx, reference);
  if (!resolvedTarget) {
    await ctx.reply("کاربر هدف را با ریپلای، منشن، یوزرنیم یا شناسهٔ عددی مشخص کنید.", { reply_parameters: { message_id: ctx.message.message_id } });
    return true;
  }
  const replyTarget = { id: resolvedTarget.telegramUserId, first_name: resolvedTarget.displayName, username: resolvedTarget.username, is_bot: false };
  if (command.action === "set" && !command.title) {
    await ctx.reply("پس از «تنظیم لقب» متن لقب را وارد کنید؛ برای نمونه: تنظیم لقب خوشحال", { reply_parameters: { message_id: ctx.message.message_id } });
    return true;
  }
  if (command.action === "set" && Array.from(command.title).length > 16) {
    await ctx.reply("لقب مدیر حداکثر می‌تواند ۱۶ نویسه باشد.", { reply_parameters: { message_id: ctx.message.message_id } });
    return true;
  }
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) {
    await ctx.reply("این گروه هنوز راه‌اندازی نشده است. ابتدا «setup» را ارسال کنید.", { reply_parameters: { message_id: ctx.message.message_id } });
    return true;
  }
  const actorAccess = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  if (!hasKronosModerationAccess(actorAccess)) {
    await ctx.reply("فقط مدیران مجاز گروه یا Kronos می‌توانند لقب اعضا را تغییر دهند.", { reply_parameters: { message_id: ctx.message.message_id } });
    return true;
  }
  const telegram = ctx.telegram as typeof ctx.telegram & TelegramMemberTagApi;
  const title = command.action === "set" ? command.title : "";
  const target = targetMention(replyTarget);
  try {
    const previousTitle = await getKronosMemberTitle({ groupId: group.id, telegramUserId: replyTarget.id });
    const chatMember = await withTimeout(telegram.getChatMember(ctx.chat.id, replyTarget.id), TITLE_OPERATION_TIMEOUT_MS);
    const usesMemberTag = isRegularMemberStatus(chatMember.status);
    const message = command.action === "set"
      ? `لقب ${target} به <b>${escapeHtml(title)}</b> تغییر کرد.`
      : `لقب ${target} حذف شد.`;
    if (!usesMemberTag) {
      if (chatMember.status === "creator" || chatMember.status === "administrator") {
        await recordKnownGroupMember({ groupId: group.id, telegramUserId: replyTarget.id, status: "active", telegramRole: chatMember.status === "creator" ? "owner" : "administrator" });
        await setKronosMemberTitle({ groupId: group.id, telegramUserId: replyTarget.id, title: title || null });
        await writeAuditLog({ category: "member_title", event: command.action === "set" ? "set" : "remove", groupId: group.id, actorTelegramId: ctx.from.id, subjectTelegramId: replyTarget.id, details: { previousTitle: previousTitle || null, nextTitle: title || null, source: "kronos_member_title" } });
        await notifyGroupEvent({
          groupId: group.id,
          eventType: "role.title_changed",
          actor: { telegramUserId: ctx.from.id, displayName: targetDisplayName(ctx.from) },
          subject: { telegramUserId: replyTarget.id, displayName: targetDisplayName(replyTarget) },
          details: { previousValue: previousTitle || "بدون لقب", nextValue: title || "بدون لقب", summary: "لقب داخلی مدیر یا مالک گروه به‌روزرسانی شد." },
          eventKey: `kronos-member-title:${group.id}:${replyTarget.id}:${title || "none"}:${ctx.message.message_id}`,
          telegram: ctx.telegram,
          includeActorInDashboard: true,
        });
        const response = await ctx.reply(message, { parse_mode: "HTML", reply_parameters: { message_id: ctx.message.message_id } });
        await deleteTemporaryCommandSuccess({ telegram: ctx.telegram, chatId: ctx.chat.id, messageId: telegramMessageId(response) });
      } else {
        await ctx.reply(`${target} اکنون عضو فعال گروه نیست؛ لقب تغییر نکرد.`, { parse_mode: "HTML", reply_parameters: { message_id: ctx.message.message_id } });
      }
      return true;
    }
    await withTimeout(setTelegramMemberTag(telegram, ctx.chat.id, replyTarget.id, title), TITLE_OPERATION_TIMEOUT_MS);
    await recordKnownGroupMember({ groupId: group.id, telegramUserId: replyTarget.id, status: "active", telegramRole: "member" });
    await setKronosMemberTitle({ groupId: group.id, telegramUserId: replyTarget.id, title: title || null });
    const response = await ctx.reply(message, { parse_mode: "HTML", reply_parameters: { message_id: ctx.message.message_id } });
    await deleteTemporaryCommandSuccess({ telegram: ctx.telegram, chatId: ctx.chat.id, messageId: telegramMessageId(response) });
    await writeAuditLog({ category: "member_tag", event: command.action === "set" ? "set" : "remove", groupId: group.id, actorTelegramId: ctx.from.id, subjectTelegramId: replyTarget.id, details: { title: title || null, source: "telegram_member_tag" } });
    await notifyGroupEvent({
      groupId: group.id,
      eventType: "role.title_changed",
      actor: { telegramUserId: ctx.from.id, displayName: targetDisplayName(ctx.from) },
      subject: { telegramUserId: replyTarget.id, displayName: targetDisplayName(replyTarget) },
      details: { previousValue: previousTitle || "بدون لقب", nextValue: title || "بدون لقب", summary: "تگ نمایشی عضو در Telegram به‌روزرسانی شد." },
      eventKey: `telegram-member-tag:${group.id}:${replyTarget.id}:${title || "none"}:${ctx.message.message_id}`,
      telegram: ctx.telegram,
      includeActorInDashboard: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("TITLE_OPERATION_TIMEOUT")) {
      await ctx.reply("تغییر لقب در ۱۰ ثانیه کامل نشد. لطفاً چند لحظه بعد دوباره تلاش کنید.", { reply_parameters: { message_id: ctx.message.message_id } });
    } else if (message.includes("MEMBER_TAG_API_UNAVAILABLE")) {
      await ctx.reply("نسخهٔ فعلی اتصال ربات هنوز از تغییر لقب عضو پشتیبانی نمی‌کند؛ لقب تغییر نکرد.", { reply_parameters: { message_id: ctx.message.message_id } });
    } else if (/not enough rights|manage tags|can_manage_tags/i.test(message)) {
      await ctx.reply("لقب تغییر نکرد. ربات باید مدیر گروه باشد و مجوز «مدیریت تگ‌ها» را داشته باشد.", { reply_parameters: { message_id: ctx.message.message_id } });
    } else {
      await ctx.reply("لقب در حال حاضر تغییر نکرد. لطفاً عضویت کاربر در گروه و دسترسی ربات را بررسی کنید.", { reply_parameters: { message_id: ctx.message.message_id } });
    }
  }
  return true;
}
