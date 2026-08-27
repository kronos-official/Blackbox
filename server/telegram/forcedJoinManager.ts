import { and, desc, eq } from "drizzle-orm";
import { Markup } from "telegraf";
import { forcedJoinChannels } from "../../drizzle/schema";
import { getDb } from "../db";
import { writeAuditLog } from "./repository";
import { withTelegramButtonStyle } from "./buttonStyle";

export type BotPrivateForcedJoinDraft = {
  channelChatId: number;
  inviteUrl: string;
  buttonLabel: string;
  durationDays: number | null;
};

export type ForcedJoinDraftStep = "channelChatId" | "inviteUrl" | "buttonLabel" | "durationDays" | "confirm";

export type StagedBotPrivateForcedJoinDraft = Partial<BotPrivateForcedJoinDraft> & {
  step: ForcedJoinDraftStep;
  expiresAt: number;
};

type StagedDraftResult =
  | { ok: true; draft: StagedBotPrivateForcedJoinDraft; prompt: string; complete: boolean }
  | { ok: false; draft: StagedBotPrivateForcedJoinDraft; error: string };

export const FORCED_JOIN_MANAGER_CALLBACKS = {
  open: "forced_join_manager:open",
  add: "forced_join_manager:add",
  list: "forced_join_manager:list",
  close: "forced_join_manager:close",
  confirm: "forced_join_manager:confirm",
  cancel: "forced_join_manager:cancel",
  removePrefix: "forced_join_manager:remove:",
} as const;

export function forcedJoinManagerKeyboard() {
  return Markup.inlineKeyboard([
    [
      withTelegramButtonStyle(Markup.button.callback("افزودن کانال", FORCED_JOIN_MANAGER_CALLBACKS.add), "primary"),
      withTelegramButtonStyle(Markup.button.callback("فهرست کانال‌ها", FORCED_JOIN_MANAGER_CALLBACKS.list), "primary"),
    ],
    [withTelegramButtonStyle(Markup.button.callback("بستن", FORCED_JOIN_MANAGER_CALLBACKS.close), "danger")],
  ]);
}

export function forcedJoinManagerMenuText() {
  return "عضویت اجباری\n\nاین بخش فقط برای مالک Kronos Guard است و فقط در گفت‌وگوی خصوصی ربات عمل می‌کند؛ هیچ پیام عضویت اجباری در گروه‌ها ارسال نمی‌شود.\n\nکانال‌ها را اضافه یا حذف کنید. کانال منقضی‌شده به‌صورت خودکار از الزام عضویت خارج می‌شود.";
}

export function forcedJoinAddPrompt() {
  return "گام 1 از 4 — لینک عمومی t.me، یوزرنیم @ یا شناسهٔ عددی کانال را بفرستید.\n\nنمونه: https://t.me/KronosChannel · @KronosChannel · -1001234567890\n\nربات شناسهٔ عددی مقصد را خودکار استخراج می‌کند. برای کانال خصوصی، شناسهٔ ‎-100…‎ را وارد کنید. ربات باید در مقصد عضو و مدیر باشد. برای لغو، «لغو» را بفرستید.";
}

export function forcedJoinDraftPrompt(step: ForcedJoinDraftStep) {
  if (step === "channelChatId") return forcedJoinAddPrompt();
  if (step === "inviteUrl") return "گام 2 از 4 — لینک عضویت کانال را بفرستید.\n\nنمونه: https://t.me/example یا https://t.me/+invite\n\nبرای لغو، «لغو» را بفرستید.";
  if (step === "buttonLabel") return "گام 3 از 4 — نامی را که روی دکمهٔ عضویت نمایش داده می‌شود بفرستید.\n\nنمونه: عضویت در اخبار Kronos\n\nحداکثر 64 نویسه. برای لغو، «لغو» را بفرستید.";
  if (step === "durationDays") return "گام 4 از 4 — مدت الزام عضویت را به روز بفرستید.\n\nیک عدد بین 1 تا 365، یا واژهٔ «دائمی» را بفرستید. برای لغو، «لغو» را بفرستید.";
  return "اطلاعات کانال آمادهٔ تأیید است.";
}

export function createStagedBotPrivateForcedJoinDraft(now = Date.now()): StagedBotPrivateForcedJoinDraft {
  return { step: "channelChatId", expiresAt: now + 10 * 60_000 };
}

/**
 * Telegram channel and supergroup IDs are negative and use the -100 prefix.
 * Accept the common pasted form without only its leading minus sign, but never
 * persist an arbitrary positive chat ID because it cannot be checked reliably.
 */
export function normalizeForcedJoinChannelChatId(value: number | string): number | null {
  const raw = String(value).trim();
  if (!/^-?\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return null;
  if (raw.startsWith("-100") && parsed < 0) return parsed;
  if (raw.startsWith("100") && parsed > 0) return -parsed;
  return null;
}

function parseDuration(raw: string): number | null | undefined {
  const normalized = raw.trim().toLocaleLowerCase("en-US");
  if (["دائمی", "permanent", "forever", "0"].includes(normalized)) return null;
  const durationDays = Number(normalized);
  return Number.isInteger(durationDays) && durationDays >= 1 && durationDays <= 365 ? durationDays : undefined;
}

export function advanceStagedBotPrivateForcedJoinDraft(draft: StagedBotPrivateForcedJoinDraft, rawInput: string): StagedDraftResult {
  const raw = rawInput.trim();
  if (draft.step === "channelChatId") {
    const channelChatId = normalizeForcedJoinChannelChatId(raw);
    if (channelChatId === null) return { ok: false, draft, error: "مقصد کانال را با لینک عمومی t.me، یوزرنیم @ یا شناسهٔ ‎-100…‎ وارد کنید." };
    const next = { ...draft, channelChatId, step: "inviteUrl" as const };
    return { ok: true, draft: next, prompt: forcedJoinDraftPrompt(next.step), complete: false };
  }
  if (draft.step === "inviteUrl") {
    if (!/^https:\/\/t\.me\/(?:\+|[A-Za-z0-9_])/.test(raw) || raw.length > 1024) return { ok: false, draft, error: "لینک کانال باید یک لینک معتبر https://t.me/... باشد." };
    const next = { ...draft, inviteUrl: raw, step: "buttonLabel" as const };
    return { ok: true, draft: next, prompt: forcedJoinDraftPrompt(next.step), complete: false };
  }
  if (draft.step === "buttonLabel") {
    if (!raw || raw.length > 64) return { ok: false, draft, error: "نام دکمه باید بین 1 تا 64 نویسه باشد." };
    const next = { ...draft, buttonLabel: raw, step: "durationDays" as const };
    return { ok: true, draft: next, prompt: forcedJoinDraftPrompt(next.step), complete: false };
  }
  if (draft.step === "durationDays") {
    const durationDays = parseDuration(raw);
    if (durationDays === undefined) return { ok: false, draft, error: "مدت باید عددی بین 1 تا 365 روز یا واژهٔ «دائمی» باشد." };
    const next = { ...draft, durationDays, step: "confirm" as const };
    return { ok: true, draft: next, prompt: forcedJoinDraftPrompt(next.step), complete: true };
  }
  return { ok: false, draft, error: "این فرم آمادهٔ تأیید است. از دکمه‌های تأیید یا لغو استفاده کنید." };
}

export function finalizedBotPrivateForcedJoinDraft(draft: StagedBotPrivateForcedJoinDraft): BotPrivateForcedJoinDraft | null {
  if (draft.step !== "confirm" || draft.channelChatId === undefined || !draft.inviteUrl || !draft.buttonLabel || draft.durationDays === undefined) return null;
  return { channelChatId: draft.channelChatId, inviteUrl: draft.inviteUrl, buttonLabel: draft.buttonLabel, durationDays: draft.durationDays };
}

export function stagedForcedJoinConfirmationText(draft: BotPrivateForcedJoinDraft) {
  const duration = draft.durationDays === null ? "دائمی" : `${draft.durationDays} روز`;
  return `خلاصهٔ کانال عضویت اجباری\n\nشناسه: ${draft.channelChatId}\nلینک: ${draft.inviteUrl}\nنام دکمه: ${draft.buttonLabel}\nمدت الزام: ${duration}\n\nاطلاعات درست است؟`;
}

export function stagedForcedJoinConfirmationKeyboard() {
  return Markup.inlineKeyboard([
    [
      withTelegramButtonStyle(Markup.button.callback("تأیید و ذخیره", FORCED_JOIN_MANAGER_CALLBACKS.confirm), "success"),
      withTelegramButtonStyle(Markup.button.callback("لغو", FORCED_JOIN_MANAGER_CALLBACKS.cancel), "danger"),
    ],
  ]);
}

export function formatBotPrivateForcedJoinList(channels: Awaited<ReturnType<typeof listBotPrivateForcedJoinChannels>>) {
  if (channels.length === 0) return "در حال حاضر هیچ کانال عضویت اجباری فعالی یا ثبت‌شده‌ای ندارید.";
  const lines = channels.map(channel => {
    const expiry = channel.expiresAt ? channel.expiresAt.toLocaleDateString("fa-IR") : "دائمی";
    const status = channel.status === "active" ? "فعال" : channel.status === "expired" ? "منقضی" : "متوقف";
    return `• ${channel.buttonLabel ?? channel.title}\n  شناسه: ${channel.channelChatId}\n  وضعیت: ${status} | پایان: ${expiry}`;
  });
  return `کانال‌های عضویت اجباری\n\n${lines.join("\n\n")}`;
}

export function forcedJoinRemovalKeyboard(channels: Awaited<ReturnType<typeof listBotPrivateForcedJoinChannels>>) {
  const buttons = channels.slice(0, 20).map(channel => withTelegramButtonStyle(
    Markup.button.callback(`حذف: ${(channel.buttonLabel ?? channel.title).slice(0, 28)}`, `${FORCED_JOIN_MANAGER_CALLBACKS.removePrefix}${channel.id}`),
    "danger",
  ));
  return Markup.inlineKeyboard([...buttons.map(button => [button]), [withTelegramButtonStyle(Markup.button.callback("بازگشت", FORCED_JOIN_MANAGER_CALLBACKS.open), "primary")]]);
}

export async function listBotPrivateForcedJoinChannels() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable for forced-join channel listing");
  return db
    .select()
    .from(forcedJoinChannels)
    .where(eq(forcedJoinChannels.scope, "global"))
    .orderBy(desc(forcedJoinChannels.createdAt));
}

export async function saveBotPrivateForcedJoinChannel(draft: BotPrivateForcedJoinDraft, ownerTelegramId: number, verifiedTitle?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable for forced-join channel save");
  const now = new Date();
  const expiresAt = draft.durationDays === null ? null : new Date(now.getTime() + draft.durationDays * 86_400_000);
  const values = {
    channelChatId: draft.channelChatId,
    title: verifiedTitle?.slice(0, 512) || draft.buttonLabel,
    buttonLabel: draft.buttonLabel,
    inviteUrl: draft.inviteUrl,
    username: null,
    scope: "global" as const,
    groupId: null,
    status: "active" as const,
    ownerTelegramId,
    startsAt: now,
    expiresAt,
  };
  const existing = (await db.select({ id: forcedJoinChannels.id }).from(forcedJoinChannels).where(and(eq(forcedJoinChannels.channelChatId, draft.channelChatId), eq(forcedJoinChannels.scope, "global"))).limit(1))[0];
  if (existing) await db.update(forcedJoinChannels).set(values).where(eq(forcedJoinChannels.id, existing.id));
  else await db.insert(forcedJoinChannels).values(values);

  await writeAuditLog({ category: "forced_join", event: existing ? "bot_private_channel_updated" : "bot_private_channel_created", actorTelegramId: ownerTelegramId, details: { channelChatId: draft.channelChatId, buttonLabel: draft.buttonLabel, expiresAt: expiresAt?.toISOString() ?? null } });
  return { created: !existing, expiresAt };
}

export async function removeBotPrivateForcedJoinChannel(channelId: number, ownerTelegramId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable for forced-join channel removal");
  const existing = (await db.select({ id: forcedJoinChannels.id, title: forcedJoinChannels.title }).from(forcedJoinChannels).where(and(eq(forcedJoinChannels.id, channelId), eq(forcedJoinChannels.scope, "global"))).limit(1))[0];
  if (!existing) return { removed: false, title: null };
  await db.delete(forcedJoinChannels).where(eq(forcedJoinChannels.id, existing.id));
  await writeAuditLog({ category: "forced_join", event: "bot_private_channel_removed", actorTelegramId: ownerTelegramId, details: { channelId: existing.id, title: existing.title } });
  return { removed: true, title: existing.title };
}
