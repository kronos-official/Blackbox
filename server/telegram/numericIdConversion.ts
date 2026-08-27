import type { EntityKind, ResolvedEntity } from "./entityResolver";
import { buildEntityIdentityCard } from "./entityResolver";
import { findTelegramUserByReference } from "./repository";
import { kronosPersistentKeyboard, numericIdCancelKeyboard, numericIdConfirmKeyboard, numericIdEntityKeyboard, numericIdNativeKeyboard, type NumericIdEntityKind } from "./persistentKeyboard";
import { telegramPhotoFileId } from "./groupInfo";

type PendingConversion = { kind?: EntityKind; selectedId?: number; expiresAt: number };
type NumericContext = any;

const pending = new Map<number, PendingConversion>();
const EXPIRY_MS = 5 * 60_000;
const NATIVE_REQUEST_KIND: Record<number, NumericIdEntityKind> = { 7101: "user", 7102: "bot", 7103: "group", 7104: "channel" };

function privateChat(ctx: NumericContext) { return ctx.chat?.type === "private" && Boolean(ctx.from?.id); }
function labelForKind(kind: NumericIdEntityKind) { return kind === "channel" ? "کانال" : kind === "group" ? "گروه" : kind === "user" ? "کاربر" : "ربات"; }

export async function beginNumericIdConversion(ctx: NumericContext) {
  if (!privateChat(ctx)) return;
  pending.set(ctx.from.id, { expiresAt: Date.now() + EXPIRY_MS });
  await ctx.reply("مرکز استخراج آیدی Kronos Guard\n\nدستهٔ مقصد را انتخاب کنید تا پنجرهٔ رسمی انتخاب Telegram باز شود.", numericIdEntityKeyboard());
}

async function promptNativePicker(ctx: NumericContext, kind: NumericIdEntityKind) {
  pending.set(ctx.from.id, { kind, expiresAt: Date.now() + EXPIRY_MS });
  await ctx.reply(`انتخاب ${labelForKind(kind)}\n\nدکمهٔ زیر پنجرهٔ رسمی Telegram را باز می‌کند. مقصد را انتخاب کنید تا اطلاعات آن برای تأیید نهایی به Kronos Guard برگردد.`, numericIdNativeKeyboard(kind));
}

export async function beginNumericIdConversionForKind(ctx: NumericContext, kind: NumericIdEntityKind) {
  if (!privateChat(ctx)) return false;
  await promptNativePicker(ctx, kind);
  return true;
}

async function showNativeSelectionConfirmation(ctx: NumericContext, kind: NumericIdEntityKind, id: number) {
  const state = pending.get(ctx.from.id);
  if (!privateChat(ctx) || !state || state.expiresAt < Date.now() || state.kind !== kind || !Number.isSafeInteger(id) || id === 0) return false;
  pending.set(ctx.from.id, { kind, selectedId: id, expiresAt: Date.now() + EXPIRY_MS });
  await ctx.reply(`تأیید استخراج آیدی\n\nآیا می‌خواهید اطلاعات ${labelForKind(kind)} انتخاب‌شده به ربات ارسال شود؟\n\nپس از تأیید، Kronos Guard آیدی عددی واقعی و اطلاعات قابل‌دسترسی مقصد را در همین گفت‌وگو نمایش می‌دهد.`, numericIdConfirmKeyboard(kind, id));
  return true;
}

/** Handles Telegram message.users_shared and message.chat_shared service messages. */
export async function handleNativeNumericIdSelection(ctx: NumericContext) {
  if (!privateChat(ctx) || !ctx.from) return false;
  const usersShared = ctx.message?.users_shared;
  const chatShared = ctx.message?.chat_shared;
  if (usersShared) {
    const kind = NATIVE_REQUEST_KIND[Number(usersShared.request_id)];
    const id = Number(usersShared.user_ids?.[0]);
    if (!kind || (kind !== "user" && kind !== "bot")) return false;
    return showNativeSelectionConfirmation(ctx, kind, id);
  }
  if (chatShared) {
    const kind = NATIVE_REQUEST_KIND[Number(chatShared.request_id)];
    const id = Number(chatShared.chat_id);
    if (!kind || (kind !== "group" && kind !== "channel")) return false;
    return showNativeSelectionConfirmation(ctx, kind, id);
  }
  return false;
}

export async function handleNumericIdAction(ctx: NumericContext) {
  if (!privateChat(ctx) || typeof ctx.callbackQuery?.data !== "string") return false;
  const data = ctx.callbackQuery.data as string;
  if (!data.startsWith("numeric-id:")) return false;
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const action = data.slice("numeric-id:".length);
  if (action === "cancel") {
    pending.delete(userId);
    await ctx.editMessageText("عملیات استخراج آیدی لغو شد.");
    await ctx.reply("مرکز گفت‌وگو آماده است. برای شروع دوباره، دکمهٔ «استخراج آیدی» را انتخاب کنید.", kronosPersistentKeyboard());
    return true;
  }
  if (action === "back") {
    pending.set(userId, { expiresAt: Date.now() + EXPIRY_MS });
    await ctx.editMessageText("مرکز استخراج آیدی Kronos Guard\n\nدستهٔ مقصد را انتخاب کنید تا پنجرهٔ رسمی Telegram باز شود.", numericIdEntityKeyboard());
    return true;
  }
  if (!["channel", "group", "user", "bot"].includes(action)) return true;
  const kind = action as NumericIdEntityKind;
  await ctx.editMessageText(`انتخاب ${labelForKind(kind)} از پنجرهٔ رسمی Telegram انجام می‌شود.`, numericIdCancelKeyboard());
  await promptNativePicker(ctx, kind);
  return true;
}

/** Kept for callback compatibility with previously delivered keyboards; native selection is authoritative. */
export async function handleKnownNumericIdAction(_ctx: NumericContext) { return false; }

export async function handleNumericIdConfirmation(ctx: NumericContext) {
  if (!privateChat(ctx) || typeof ctx.callbackQuery?.data !== "string") return false;
  const data = ctx.callbackQuery.data as string;
  if (!data.startsWith("numeric-confirm:")) return false;
  await ctx.answerCbQuery();
  const [, decision, kindRaw, idRaw] = data.split(":");
  if (!["yes", "no"].includes(decision) || !["channel", "group", "user", "bot"].includes(kindRaw)) return true;
  const kind = kindRaw as NumericIdEntityKind;
  const id = Number(idRaw);
  const state = pending.get(ctx.from.id);
  if (!state || state.expiresAt < Date.now() || state.kind !== kindRaw || state.selectedId !== id || !Number.isFinite(id)) return true;
  if (decision === "no") {
    await promptNativePicker(ctx, kind);
    return true;
  }
  pending.delete(ctx.from.id);
  const entity = await resolveEntity(ctx, String(id), kindRaw as EntityKind);
  if (entity) await sendResolvedEntity(ctx, entity);
  else await ctx.reply("اطلاعات این مقصد در حال حاضر از Telegram دریافت نشد. فهرست را دوباره بررسی کنید و مقصد دیگری را انتخاب نمایید.", numericIdCancelKeyboard());
  return true;
}

/** Manual username/link entry is disabled; the only accepted text action is the native keyboard cancellation. */
export async function handleNumericIdText(ctx: NumericContext) {
  if (!privateChat(ctx) || ctx.message?.text !== "لغو عملیات" || !ctx.from) return false;
  pending.delete(ctx.from.id);
    await ctx.reply("عملیات استخراج آیدی لغو شد. برای شروع دوباره، دکمهٔ «استخراج آیدی» را انتخاب کنید.", kronosPersistentKeyboard());
  return true;
}

export async function resolveEntity(ctx: NumericContext, reference: string, kind: EntityKind): Promise<ResolvedEntity | null> {
  const numericId = /^-?\d+$/.test(reference) ? Number(reference) : undefined;
  const sharedIdFallback = numericId !== undefined && Number.isSafeInteger(numericId) && numericId !== 0
    ? { id: numericId, kind, name: "اطلاعات تکمیلی در دسترس نیست", username: null, bio: null, photoFileId: null, source: "telegram" as const }
    : null;
  if (kind === "user" || kind === "bot") {
    const user = await findTelegramUserByReference(numericId !== undefined ? { telegramUserId: numericId } : { username: reference });
    try {
      const chat = await ctx.telegram.getChat(numericId !== undefined ? numericId : `@${reference}`);
      if (chat.type !== "private") return null;
      const chatUsername = "username" in chat ? chat.username ?? null : null;
      const chatName = ["first_name" in chat ? chat.first_name : "", "last_name" in chat ? chat.last_name : ""].filter(Boolean).join(" ");
      const chatBio = "bio" in chat ? chat.bio ?? null : null;
      return { id: chat.id, kind, name: chatName || chatUsername || user?.firstName || "بدون نام", username: chatUsername ?? user?.username ?? null, bio: chatBio, photoFileId: "photo" in chat ? telegramPhotoFileId(chat.photo) : null, source: "telegram" };
    } catch {
      if (user && (kind !== "bot" || user.isBot) && (kind !== "user" || !user.isBot)) {
        return { id: user.telegramUserId, kind, name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "بدون نام", username: user.username, bio: null, photoFileId: null, source: "directory" };
      }
      return sharedIdFallback;
    }
  }
  try {
    const chat = await ctx.telegram.getChat(numericId !== undefined ? numericId : `@${reference}`);
    const chatType = chat.type === "channel" ? "channel" : "group";
    if (chatType !== kind) return null;
    return { id: chat.id, kind, name: "title" in chat ? chat.title : "بدون نام", username: "username" in chat ? chat.username ?? null : null, bio: "description" in chat ? chat.description ?? null : null, photoFileId: "photo" in chat ? telegramPhotoFileId(chat.photo) : null, source: "telegram" };
  } catch {
    return sharedIdFallback;
  }
}

async function sendResolvedEntity(ctx: NumericContext, entity: ResolvedEntity) {
  const caption = buildEntityIdentityCard(entity);
  if (entity.photoFileId) await ctx.replyWithPhoto(entity.photoFileId, { caption, parse_mode: "HTML" }).catch(() => ctx.reply(caption, { parse_mode: "HTML" }));
  else await ctx.reply(caption, { parse_mode: "HTML" });
}

export function resetNumericIdConversionForTests() { pending.clear(); }
