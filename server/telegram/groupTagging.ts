import { Markup } from "telegraf";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { groupMembers, groupRoles, telegramUsers } from "../../drizzle/schema";
import { getDb } from "../db";
import { hasAtLeastAccess, resolveAccessLevel } from "./authorization";
import { findGroupByChatId, writeAuditLog } from "./repository";
import { withTelegramButtonStyle } from "./buttonStyle";

const MAX_TAG_RECIPIENTS = 200;
const TAG_CHUNK_SIZE = 25;
const TAG_THROTTLE_MS = 325;
const TAG_COOLDOWN_MS = 90_000;
const TAG_DRAFT_TTL_MS = 60_000;

type TagMode = "privileged" | "members";
type TagDraftStep = "selecting" | "count" | "exclusions";

type TagDraft = {
  mode: TagMode;
  requestedCount: number;
  excludedTelegramIds: number[];
  step: TagDraftStep;
  expiresAt: number;
  replyToMessageId?: number;
  formMessageId?: number;
};

type PendingTagConfirmation = {
  actorTelegramId: number;
  groupId: number;
  groupChatId: number;
  key: string;
  draft: TagDraft;
  confirmationMessageId?: number;
  expiresAt: number;
};

type TagUser = {
  telegramUserId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  isBot: boolean;
  kronosTitle: string | null;
};

type GroupTagContext = {
  chat: { id: number; type: string };
  from?: { id: number };
  message: { text: string; reply_to_message?: { message_id: number } };
  telegram: {
    getChatMember: (chatId: number, userId: number) => Promise<{ status: string }>;
    sendMessage: (chatId: number, text: string, options?: { parse_mode?: "HTML"; disable_web_page_preview?: boolean; reply_parameters?: { message_id: number; allow_sending_without_reply?: boolean }; reply_to_message_id?: number; reply_markup?: unknown }) => Promise<unknown>;
    deleteMessage?: (chatId: number, messageId: number) => Promise<unknown>;
  };
  reply: (text: string, options?: unknown) => Promise<unknown>;
};

type TagCallbackContext = {
  chat?: { id: number; type: string };
  from?: { id: number };
  callbackQuery?: { data?: string };
  telegram: GroupTagContext["telegram"];
  reply?: GroupTagContext["reply"];
  answerCbQuery: (text?: string, options?: { show_alert?: boolean }) => Promise<unknown>;
  editMessageText: (text: string, options?: unknown) => Promise<unknown>;
  deleteMessage?: () => Promise<unknown>;
};

const tagDrafts = new Map<string, TagDraft>();
const pendingTagConfirmations = new Map<string, PendingTagConfirmation>();
const tagCooldowns = new Map<string, number>();
const TAG_CONFIRMATION_TTL_MS = 60_000;

function draftKey(groupChatId: number, actorTelegramId: number) {
  return `${groupChatId}:${actorTelegramId}`;
}

function isManagedGroupContext(ctx: { chat?: { type: string } }) {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function toEnglishDigits(value: string | number) {
  return String(value).replace(/[۰-۹٠-٩]/g, digit => {
    const persianIndex = "۰۱۲۳۴۵۶۷۸۹".indexOf(digit);
    if (persianIndex >= 0) return String(persianIndex);
    return String("٠١٢٣٤٥٦٧٨٩".indexOf(digit));
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
}

export function tagLink(user: TagUser) {
  const baseName = user.username ? `@${user.username}` : [user.firstName, user.lastName].filter(Boolean).join(" ") || `کاربر ${user.telegramUserId}`;
  // Internal Kronos titles are metadata, not part of a Telegram mention.
  return `<a href="tg://user?id=${user.telegramUserId}">${escapeHtml(baseName)}</a>`;
}

export function isInvalidTagIdentity(user: Pick<TagUser, "telegramUserId" | "username" | "firstName" | "isBot">) {
  const username = user.username?.trim().toLocaleLowerCase("en-US");
  const firstName = user.firstName?.trim().toLocaleLowerCase("en-US");
  // 777000 and the Telegram service identity can be recorded as a non-bot member by channel/service updates.
  return user.isBot || user.telegramUserId === 777000 || username === "telegram" || firstName === "telegram";
}

export function tagAnnouncementHeader(index: number) {
  return index === 0 ? "<b>اعلان تگ اعضای گروه</b>\n\n" : "";
}

function tagPanelText() {
  return "<b>سامانهٔ تگ Kronos Guard</b>\n\nروش تگ را انتخاب کنید.";
}

export function tagPanelKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("◈ تگ کاربران مقام‌دار", "tag:privileged")],
    [Markup.button.callback("◈ تگ 50 عضو فعال", "tag:50")],
    [Markup.button.callback("◈ تگ 200 عضو فعال", "tag:200")],
    [Markup.button.callback("◈ تعیین تعداد دلخواه", "tag:custom")],
    [Markup.button.callback("◈ افزودن فهرست استثنا", "tag:exclude")],
    [withTelegramButtonStyle(Markup.button.callback("لغو", "tag:cancel"), "danger")],
  ]);
}

export function tagExclusionPrompt() {
  return "شناسه یا @username افراد استثنا را بفرستید. حداکثر 50 نفر.";
}

export function tagFormCancelKeyboard() {
  return Markup.inlineKeyboard([
    [withTelegramButtonStyle(Markup.button.callback("لغو", "tag:cancel"), "danger")],
  ]);
}

export function tagReplyOptions(messageId: number | undefined) {
  return messageId && Number.isSafeInteger(messageId) && messageId > 0
    ? {
      reply_parameters: { message_id: messageId, allow_sending_without_reply: false },
      // Keep the legacy field as a compatibility fallback for Telegram clients/API paths
      // that do not render reply_parameters on direct telegram.sendMessage calls.
      reply_to_message_id: messageId,
    }
    : {};
}

export function isValidTagDraft(value: unknown): value is TagDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<TagDraft>;
  return (draft.mode === "privileged" || draft.mode === "members")
    && typeof draft.requestedCount === "number"
    && Number.isInteger(draft.requestedCount)
    && draft.requestedCount >= 1
    && draft.requestedCount <= MAX_TAG_RECIPIENTS
    && Array.isArray(draft.excludedTelegramIds)
    && draft.excludedTelegramIds.every(id => typeof id === "number" && Number.isSafeInteger(id))
    && (draft.step === "selecting" || draft.step === "count" || draft.step === "exclusions")
    && typeof draft.expiresAt === "number"
    && Number.isFinite(draft.expiresAt)
    && (draft.replyToMessageId === undefined || (typeof draft.replyToMessageId === "number" && Number.isSafeInteger(draft.replyToMessageId) && draft.replyToMessageId > 0))
    && (draft.formMessageId === undefined || (typeof draft.formMessageId === "number" && Number.isSafeInteger(draft.formMessageId) && draft.formMessageId > 0));
}

function tagDraftSummary(draft: TagDraft) {
  const scope = draft.mode === "privileged" ? "فقط کاربران مقام‌دار" : `${toEnglishDigits(draft.requestedCount)} عضو فعال`;
  return `روش انتخاب شد: <b>${scope}</b>\nاستثناهای ثبت‌شده: <b>${toEnglishDigits(draft.excludedTelegramIds.length)}</b>\n\nبرای اجرای فوری این روش، همان گزینه را انتخاب کنید یا فهرست استثنا را تکمیل کنید.`;
}

function newTagConfirmationToken() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function tagConfirmationKeyboard(token: string) {
  return Markup.inlineKeyboard([[
    withTelegramButtonStyle(Markup.button.callback("خیر", `tag-confirm:no:${token}`), "danger"),
    withTelegramButtonStyle(Markup.button.callback("بله", `tag-confirm:yes:${token}`), "success"),
  ]]);
}

function tagConfirmationText(draft: TagDraft) {
  const scope = draft.mode === "privileged" ? "کاربران مقام‌دار" : `${toEnglishDigits(draft.requestedCount)} عضو فعال`;
  return `<b>تأیید اجرای تگ</b>\n\nآیا از تگ‌کردن ${scope} اطمینان دارید؟\n\n⏳ <b>زمان باقی‌مانده:</b> 60 ثانیه`;
}

async function deleteTagSelectionMenu(ctx: Pick<TagCallbackContext, "deleteMessage">) {
  await (ctx.deleteMessage?.() ?? Promise.resolve()).catch(() => undefined);
}

function scheduleTagConfirmationExpiry(token: string, telegram: GroupTagContext["telegram"], chatId: number, messageId?: number) {
  setTimeout(() => {
    const pending = pendingTagConfirmations.get(token);
    if (!pending || pending.expiresAt > Date.now()) return;
    pendingTagConfirmations.delete(token);
    if (messageId) void (telegram.deleteMessage?.(chatId, messageId) ?? Promise.resolve()).catch(() => undefined);
  }, TAG_CONFIRMATION_TTL_MS);
}

async function requestTagConfirmation(input: {
  ctx: {
    chat?: { id: number; type: string };
    from?: { id: number };
    telegram: GroupTagContext["telegram"];
    reply?: GroupTagContext["reply"];
    answerCbQuery?: TagCallbackContext["answerCbQuery"];
  };
  authorization: { group: { id: number } };
  key: string;
  draft: TagDraft;
}) {
  const actor = input.ctx.from;
  const chat = input.ctx.chat;
  if (!actor || !chat) return;
  const token = newTagConfirmationToken();
  const pending: PendingTagConfirmation = {
    actorTelegramId: actor.id,
    groupId: input.authorization.group.id,
    groupChatId: chat.id,
    key: input.key,
    draft: { ...input.draft, excludedTelegramIds: [...input.draft.excludedTelegramIds] },
    expiresAt: Date.now() + TAG_CONFIRMATION_TTL_MS,
  };
  pendingTagConfirmations.set(token, pending);
  tagDrafts.delete(input.key);
  const markup = tagConfirmationKeyboard(token);
  const replyMarkup = markup.reply_markup;
  const message = "reply" in input.ctx && input.ctx.reply
    ? await input.ctx.reply(tagConfirmationText(input.draft), { parse_mode: "HTML", reply_markup: replyMarkup })
    : await sendTagCallbackMessage(input.ctx, tagConfirmationText(input.draft), { parse_mode: "HTML", reply_markup: replyMarkup });
  const messageId = messageIdFromTelegramMessage(message);
  pending.confirmationMessageId = messageId;
  scheduleTagConfirmationExpiry(token, input.ctx.telegram, chat.id, messageId);
  await (input.ctx.answerCbQuery?.("روش تگ انتخاب شد؛ تأیید کنید.") ?? Promise.resolve());
}

async function sendTagCallbackMessage(ctx: { chat?: { id: number }; telegram: GroupTagContext["telegram"] }, text: string, options?: unknown) {
  if (!ctx.chat) return undefined;
  return ctx.telegram.sendMessage(ctx.chat.id, text, options as Parameters<GroupTagContext["telegram"]["sendMessage"]>[2]);
}

function messageIdFromTelegramMessage(message: unknown) {
  return message && typeof message === "object" && "message_id" in message && typeof message.message_id === "number" ? message.message_id : undefined;
}

function clearTagState(key: string) {
  tagDrafts.delete(key);
  for (const [token, pending] of Array.from(pendingTagConfirmations.entries())) {
    if (pending.key === key) pendingTagConfirmations.delete(token);
  }
}

async function showTemporaryTagCancellation(ctx: { chat?: { id: number }; telegram: GroupTagContext["telegram"] }) {
  if (!ctx.chat) return;
  const message = await ctx.telegram.sendMessage(ctx.chat.id, "عملیات لغو شد");
  const messageId = messageIdFromTelegramMessage(message);
  if (messageId) {
    setTimeout(() => {
      void (ctx.telegram.deleteMessage?.(ctx.chat!.id, messageId) ?? Promise.resolve()).catch(() => undefined);
    }, 3000);
  }
}

async function deleteTagFormMessage(ctx: { chat?: { id: number }; telegram: GroupTagContext["telegram"]; deleteMessage?: () => Promise<unknown> }, formMessageId?: number) {
  if (ctx.deleteMessage) {
    await ctx.deleteMessage().catch(() => undefined);
    return;
  }
  if (ctx.chat && formMessageId) {
    await (ctx.telegram.deleteMessage?.(ctx.chat.id, formMessageId) ?? Promise.resolve()).catch(() => undefined);
  }
}

export function isExactTagCommand(text: string) {
  const normalized = text.trim().toLocaleLowerCase("en-US");
  return normalized === "تگ" || normalized === "tag" || normalized === "/تگ" || normalized === "/tag";
}

export function parseTagCountInput(text: string) {
  const normalized = text.trim();
  if (!/^\d{1,3}$/.test(normalized)) return undefined;
  const value = Number(normalized);
  return value >= 1 && value <= MAX_TAG_RECIPIENTS ? value : undefined;
}

export function parseTagExclusionTokens(text: string) {
  return Array.from(new Set(text.trim().split(/[\s,،]+/).filter(Boolean))).slice(0, 50);
}

function getLiveDraft(groupChatId: number, actorTelegramId: number) {
  const key = draftKey(groupChatId, actorTelegramId);
  const draft = tagDrafts.get(key);
  if (!isValidTagDraft(draft) || draft.expiresAt < Date.now()) {
    tagDrafts.delete(key);
    return undefined;
  }
  return draft;
}

async function resolveTagExclusions(tokens: string[]) {
  const numericIds = tokens.filter(token => /^\d{5,16}$/.test(token)).map(Number);
  const usernames = tokens.filter(token => /^@[A-Za-z0-9_]{5,32}$/.test(token)).map(token => token.slice(1).toLocaleLowerCase("en-US"));
  if (numericIds.length + usernames.length !== tokens.length) return { error: "فهرست استثنا فقط باید شامل @username یا شناسهٔ عددی باشد." as const };

  const db = await getDb();
  if (!db) return { error: "پایگاه‌داده برای بررسی فهرست استثنا در دسترس نیست." as const };

  const usernameIds: number[] = [];
  for (const username of usernames) {
    const match = await db.select({ telegramUserId: telegramUsers.telegramUserId }).from(telegramUsers).where(sql`LOWER(${telegramUsers.username}) = ${username}`).limit(1);
    if (match[0]) usernameIds.push(match[0].telegramUserId);
  }
  return { ids: Array.from(new Set([...numericIds, ...usernameIds])), unresolvedUsernames: usernames.length - usernameIds.length };
}

async function getTagCandidates(groupId: number, draft: TagDraft): Promise<TagUser[]> {
  const db = await getDb();
  if (!db) throw new Error("database unavailable");

  const activeMembers = await db
    .select({ telegramUserId: groupMembers.telegramUserId, telegramRole: groupMembers.telegramRole, kronosTitle: groupMembers.kronosTitle })
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.membershipStatus, "active")))
    .orderBy(desc(groupMembers.lastSeenAt));
  const activeIds = activeMembers.map(member => member.telegramUserId);
  if (activeIds.length === 0) return [];

  const identities = await db
    .select({ telegramUserId: telegramUsers.telegramUserId, username: telegramUsers.username, firstName: telegramUsers.firstName, lastName: telegramUsers.lastName, isBot: telegramUsers.isBot })
    .from(telegramUsers)
    .where(inArray(telegramUsers.telegramUserId, activeIds));
  const identityById = new Map(identities.map(user => [user.telegramUserId, user]));
  const excluded = new Set(draft.excludedTelegramIds);

  if (draft.mode === "privileged") {
    const assignedRoles = await db.select({ telegramUserId: groupRoles.telegramUserId }).from(groupRoles).where(eq(groupRoles.groupId, groupId));
    const privilegedIds = new Set<number>([
      ...activeMembers.filter(member => member.telegramRole === "owner" || member.telegramRole === "administrator").map(member => member.telegramUserId),
      ...assignedRoles.map(role => role.telegramUserId),
    ]);
    return activeIds
      .filter(id => privilegedIds.has(id) && !excluded.has(id))
      .map(id => {
        const identity = identityById.get(id);
        const member = activeMembers.find(item => item.telegramUserId === id);
        return identity ? { ...identity, kronosTitle: member?.kronosTitle ?? null } : undefined;
      })
      .filter((user): user is TagUser => Boolean(user && !isInvalidTagIdentity(user)))
      .slice(0, MAX_TAG_RECIPIENTS);
  }

  return activeIds
    .filter(id => !excluded.has(id))
    .map(id => {
      const identity = identityById.get(id);
      const member = activeMembers.find(item => item.telegramUserId === id);
      return identity ? { ...identity, kronosTitle: member?.kronosTitle ?? null } : undefined;
    })
    .filter((user): user is TagUser => Boolean(user && !isInvalidTagIdentity(user)))
    .slice(0, Math.min(draft.requestedCount, MAX_TAG_RECIPIENTS));
}

function splitIntoChunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));
}

async function canManageTags(ctx: { chat?: { id: number; type: string }; from?: { id: number }; telegram: GroupTagContext["telegram"] }) {
  if (!isManagedGroupContext(ctx) || !ctx.chat || !ctx.from) return undefined;
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) return undefined;
  const access = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  return hasAtLeastAccess(access, "moderator") ? { group, access } : undefined;
}

export async function handleTagCommand(ctx: GroupTagContext) {
  if (!isManagedGroupContext(ctx) || !isExactTagCommand(ctx.message.text)) return false;
  const authorization = await canManageTags(ctx);
  if (!authorization || !ctx.chat || !ctx.from) {
    await ctx.reply("این ابزار فقط برای مالک، مدیر یا مدیرِ موردتأیید Kronos Guard در همین گروه فعال است.");
    return true;
  }
  const replyToMessageId = ctx.message.reply_to_message?.message_id;
  const draft: TagDraft = { mode: "members", requestedCount: 50, excludedTelegramIds: [], step: "selecting", expiresAt: Date.now() + TAG_DRAFT_TTL_MS, ...(replyToMessageId ? { replyToMessageId } : {}) };
  tagDrafts.set(draftKey(ctx.chat.id, ctx.from.id), draft);
  await writeAuditLog({ category: "group_tagging", event: "panel_opened", actorTelegramId: ctx.from.id, groupId: authorization.group.id, details: { chatId: ctx.chat.id } });
  await ctx.reply(tagPanelText(), { parse_mode: "HTML", ...tagPanelKeyboard(), ...tagReplyOptions(replyToMessageId) });
  return true;
}

async function executeTagDraft(
  ctx: {
    chat: { id: number };
    from: { id: number };
    telegram: GroupTagContext["telegram"];
    reply?: GroupTagContext["reply"];
    answerCbQuery?: TagCallbackContext["answerCbQuery"];
    deleteMessage?: TagCallbackContext["deleteMessage"];
  },
  authorization: { group: { id: number } },
  key: string,
  draft: TagDraft,
) {
  const cooldownKey = key;
  await deleteTagSelectionMenu(ctx);
  const remaining = (tagCooldowns.get(cooldownKey) ?? 0) + TAG_COOLDOWN_MS - Date.now();
  if (remaining > 0) {
    await ctx.answerCbQuery?.(`برای جلوگیری از اسپم، ${toEnglishDigits(Math.ceil(remaining / 1000))} ثانیه صبر کنید.`, { show_alert: true });
    return;
  }
  let candidates: TagUser[];
  try {
    candidates = (await getTagCandidates(authorization.group.id, draft)).filter(user => user.telegramUserId !== ctx.from.id);
  } catch {
    await ctx.answerCbQuery?.("فهرست عضوهای گروه فعلاً در دسترس نیست. چند لحظه بعد دوباره تلاش کنید.", { show_alert: true });
    return;
  }
  if (candidates.length === 0) {
    await ctx.answerCbQuery?.("عضو فعالِ قابل‌تگ برای این انتخاب یافت نشد.", { show_alert: true });
    return;
  }
  tagCooldowns.set(cooldownKey, Date.now());
  tagDrafts.delete(key);
  await ctx.answerCbQuery?.("ارسال تگ آغاز شد.");
  const chunks = splitIntoChunks(candidates, TAG_CHUNK_SIZE);
  let deliveredChunks = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    const header = tagAnnouncementHeader(index);
    try {
      await ctx.telegram.sendMessage(ctx.chat.id, toEnglishDigits(`${header}${chunk.map(tagLink).join(" · ")}`), { parse_mode: "HTML", disable_web_page_preview: true, ...tagReplyOptions(draft.replyToMessageId) });
      deliveredChunks += 1;
    } catch {
      break;
    }
    if (index < chunks.length - 1) await wait(TAG_THROTTLE_MS);
  }
  const deliveredCount = chunks.slice(0, deliveredChunks).reduce((total, chunk) => total + chunk.length, 0);
  await writeAuditLog({ category: "group_tagging", event: deliveredChunks === chunks.length ? "tag_sent" : "tag_partially_sent", actorTelegramId: ctx.from.id, groupId: authorization.group.id, details: { chatId: ctx.chat.id, mode: draft.mode, requestedCount: draft.requestedCount, excludedCount: draft.excludedTelegramIds.length, sentCount: deliveredCount, plannedCount: candidates.length, deliveredChunks, chunkCount: chunks.length, replyToMessageId: draft.replyToMessageId ?? null } });
  if (deliveredChunks === chunks.length) {
    await ctx.telegram.sendMessage(ctx.chat.id, toEnglishDigits(`✅ اطلاع‌رسانی برای ${candidates.length} عضو فعال در ${chunks.length} پیام کنترل‌شده انجام شد.`), tagReplyOptions(draft.replyToMessageId));
  } else {
    await ctx.telegram.sendMessage(ctx.chat.id, toEnglishDigits(`⚠️ ارسال پس از ${deliveredCount} تگ متوقف شد. نتیجه در گزارش مدیریتی ثبت شد؛ پیش از تلاش دوباره، دسترسی ارسال پیام ربات را بررسی کنید.`), tagReplyOptions(draft.replyToMessageId));
  }
}

export async function handleTagCallback(ctx: TagCallbackContext) {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("tag:") || !ctx.chat || !ctx.from || !isManagedGroupContext(ctx)) return false;
  const authorization = await canManageTags(ctx);
  if (!authorization) {
    await ctx.answerCbQuery("مجوز لازم را ندارید.", { show_alert: true });
    return true;
  }
  const key = draftKey(ctx.chat.id, ctx.from.id);
  if (data === "tag:cancel") {
    const draft = getLiveDraft(ctx.chat.id, ctx.from.id);
    clearTagState(key);
    await ctx.answerCbQuery("فرم تگ لغو شد.").catch(() => undefined);
    await deleteTagFormMessage(ctx, draft?.formMessageId);
    await showTemporaryTagCancellation(ctx);
    return true;
  }
  const draft = getLiveDraft(ctx.chat.id, ctx.from.id);
  if (!draft) {
    await ctx.answerCbQuery("این فرم منقضی شده است. دوباره «تگ» را بفرستید.", { show_alert: true });
    return true;
  }

  if (data === "tag:privileged") {
    draft.mode = "privileged";
    draft.requestedCount = MAX_TAG_RECIPIENTS;
    draft.step = "selecting";
    await deleteTagSelectionMenu(ctx);
    await requestTagConfirmation({ ctx, authorization, key, draft });
    return true;
  } else if (data === "tag:50" || data === "tag:200") {
    draft.mode = "members";
    draft.requestedCount = Number(data.slice(4));
    draft.step = "selecting";
    await deleteTagSelectionMenu(ctx);
    await requestTagConfirmation({ ctx, authorization, key, draft });
    return true;
  } else if (data === "tag:custom") {
    draft.mode = "members";
    draft.step = "count";
    draft.expiresAt = Date.now() + TAG_DRAFT_TTL_MS;
    await ctx.answerCbQuery();
    await deleteTagSelectionMenu(ctx);
    const formMessage = await sendTagCallbackMessage(ctx, "تعداد عضوهای موردنظر را به‌صورت یک عدد بین 1 تا 200 بفرستید.", { ...tagFormCancelKeyboard(), ...tagReplyOptions(draft.replyToMessageId) });
    draft.formMessageId = messageIdFromTelegramMessage(formMessage);
    tagDrafts.set(key, draft);
    return true;
  } else if (data === "tag:exclude") {
    draft.step = "exclusions";
    draft.expiresAt = Date.now() + TAG_DRAFT_TTL_MS;
    await ctx.answerCbQuery();
    await deleteTagSelectionMenu(ctx);
    const formMessage = await sendTagCallbackMessage(ctx, tagExclusionPrompt(), { ...tagFormCancelKeyboard(), ...tagReplyOptions(draft.replyToMessageId) });
    draft.formMessageId = messageIdFromTelegramMessage(formMessage);
    tagDrafts.set(key, draft);
    return true;
  } else {
    return false;
  }
}

export async function handleTagConfirmation(ctx: TagCallbackContext) {
  const data = ctx.callbackQuery?.data;
  const match = typeof data === "string" ? data.match(/^tag-confirm:(yes|no):([a-z0-9]{8,32})$/i) : null;
  if (!match || !ctx.chat || !ctx.from || !isManagedGroupContext(ctx)) return false;
  const [, decision, token] = match;
  const pending = pendingTagConfirmations.get(token);
  if (!pending || pending.expiresAt <= Date.now() || pending.actorTelegramId !== ctx.from.id || pending.groupChatId !== ctx.chat.id) {
    pendingTagConfirmations.delete(token);
    await ctx.answerCbQuery("این تأیید منقضی شده یا برای شما نیست.", { show_alert: true }).catch(() => undefined);
    return true;
  }
  pendingTagConfirmations.delete(token);
  await ctx.answerCbQuery().catch(() => undefined);
  if (decision === "no") {
    await ctx.editMessageText("اجرای تگ لغو شد.").catch(async () => { await sendTagCallbackMessage(ctx, "اجرای تگ لغو شد."); });
    return true;
  }
  const authorization = await canManageTags(ctx);
  const group = await findGroupByChatId(ctx.chat.id);
  if (!authorization || !group || group.id !== pending.groupId) {
    await ctx.editMessageText("سطح دسترسی شما برای اجرای این تگ کافی نیست.").catch(() => undefined);
    return true;
  }
  await executeTagDraft({ ...ctx, chat: ctx.chat, from: ctx.from }, authorization, pending.key, pending.draft);
  await ctx.editMessageText("✅ اجرای تگ تأیید شد.").catch(() => undefined);
  return true;
}

export async function handleTagDraftInput(ctx: GroupTagContext) {
  if (!isManagedGroupContext(ctx) || !ctx.chat || !ctx.from) return false;
  const draft = getLiveDraft(ctx.chat.id, ctx.from.id);
  if (!draft || draft.step === "selecting") return false;
  const input = ctx.message.text.trim();
  if (input === "لغو" || input.toLocaleLowerCase("en-US") === "cancel") {
    const key = draftKey(ctx.chat.id, ctx.from.id);
    clearTagState(key);
    await deleteTagFormMessage(ctx, draft.formMessageId);
    await showTemporaryTagCancellation(ctx);
    return true;
  }
  const authorization = await canManageTags(ctx);
  if (!authorization) return false;
  if (draft.step === "count") {
    const count = parseTagCountInput(input);
    if (!count) {
      await ctx.reply("تعداد باید یک عدد بین 1 تا 200 باشد.", tagReplyOptions(draft.replyToMessageId));
      return true;
    }
    draft.requestedCount = count;
    draft.step = "selecting";
    draft.expiresAt = Date.now() + TAG_DRAFT_TTL_MS;
    tagDrafts.set(draftKey(ctx.chat.id, ctx.from.id), draft);
    await requestTagConfirmation({ ctx, authorization, key: draftKey(ctx.chat.id, ctx.from.id), draft });
    return true;
  }
  const tokens = parseTagExclusionTokens(input);
  if (tokens.length === 0) {
    await ctx.reply("حداقل یک @username یا شناسهٔ عددی بفرستید.", tagReplyOptions(draft.replyToMessageId));
    return true;
  }
  const resolved = await resolveTagExclusions(tokens);
  if ("error" in resolved && typeof resolved.error === "string") {
    await ctx.reply(resolved.error, tagReplyOptions(draft.replyToMessageId));
    return true;
  }
  draft.excludedTelegramIds = Array.from(new Set([...draft.excludedTelegramIds, ...resolved.ids])).slice(0, 50);
  draft.step = "selecting";
  draft.expiresAt = Date.now() + TAG_DRAFT_TTL_MS;
  tagDrafts.set(draftKey(ctx.chat.id, ctx.from.id), draft);
  const unresolved = resolved.unresolvedUsernames ? ` ${toEnglishDigits(resolved.unresolvedUsernames)} نام‌کاربریِ ناشناخته نادیده گرفته شد.` : "";
  await ctx.reply(toEnglishDigits(`${tagDraftSummary(draft)}${unresolved}`), tagReplyOptions(draft.replyToMessageId));
  return true;
}
