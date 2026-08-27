import { hasKronosModerationAccess } from "./authorization";
import type { AccessLevel } from "./constants";

const GROUP_COMMAND_EXACTS = new Set([
  "لینک",
  "لینک گروه",
  "گپ",
  "اطلاعات گپ",
  "پروفایل گپ",
  "مشخصات گپ",
  "وضعیت گروه",
  "وضعیت قفل",
  "لیست مدیران",
  "لیست مالکان",
  "لیست ویژه",
  "لیست کاربران ویژه",
  "list moderators",
  "list owners",
  "list vip",
  "لقب",
  "welcome preview",
  "خوشامد پیش‌نمایش",
  "goodbye preview",
  "خداحافظ پیش‌نمایش",
  "welcome reset",
  "خوشامد بازنشانی",
  "goodbye reset",
  "خداحافظ بازنشانی",
]);

const GROUP_COMMAND_PREFIXES = [
  "تنظیم مدیر",
  "تنظیم ویژه",
  "تنظیم مالک",
  "تنظیم لقب",
  "افزودن مدیر",
  "افزودن ویژه",
  "افزودن مالک",
  "حذف مدیر",
  "حذف ویژه",
  "حذف مالک",
  "حذف لقب",
  "زمان حذف خودکار",
  "عزل",
  "حذف اخطار",
  "حذف سکوت",
  "رفع بن",
  "حذف بن",
  "رفع مسدودیت",
  "بن",
  "مسدود",
  "سکوت",
  "محدود",
  "اخطار",
  "قفل",
  "باز کردن",
  "پاکسازی",
  "حذف ",
  "حذف",
  "clear ",
  "delete ",
  "mute ",
  "ban ",
  "warn ",
];

export function isGroupSetupCommand(text: string): boolean {
  const normalized = text.trim().toLocaleLowerCase("fa-IR");
  return normalized === "setup" || normalized === "راه‌اندازی" || normalized === "راه اندازی" || normalized === "راهاندازی";
}

/** Group activation changes durable bot state, so it requires bot-managed moderation authority. */
export function isGroupSetupAccessLevelAllowed(access: AccessLevel): boolean {
  return hasKronosModerationAccess(access);
}

export function isLikelyManagedGroupCommand(text: string): boolean {
  const normalized = text.trim().toLocaleLowerCase("fa-IR");
  if (!normalized) return false;
  if (isGroupSetupCommand(normalized)) return true;
  if (GROUP_COMMAND_EXACTS.has(normalized)) return true;
  return GROUP_COMMAND_PREFIXES.some(prefix => normalized === prefix.trim() || normalized.startsWith(prefix));
}

export const UNKNOWN_GROUP_ACTOR_REPLY = "⛔ شناسهٔ فرستندهٔ این پیام برای احراز مقام قابل تشخیص نیست. لطفاً ناشناس‌بودن ارسال پیام را خاموش کنید و دوباره فرمان را بفرستید.";
export const GROUP_COMMAND_UNAVAILABLE_REPLY = "⚠️ اجرای این فرمان ممکن نیست؛ Kronos Guard در این گروه دسترسی مدیریتی فعال ندارد. ابتدا ربات را مدیر کنید و دسترسی‌های لازم را برگردانید، سپس «راه‌اندازی» را بفرستید.";
export const GROUP_COMMAND_REMOVED_REPLY = "⚠️ اجرای این فرمان ممکن نیست؛ Kronos Guard دیگر در این گروه فعال نیست. ربات را دوباره به گروه اضافه و مدیر کنید، سپس «راه‌اندازی» را بفرستید.";

const GROUP_STATUS_COMMANDS = new Set(["وضعیت گروه"]);

export function groupCommandAvailabilityReply(status: string) {
  return status === "removed" ? GROUP_COMMAND_REMOVED_REPLY : GROUP_COMMAND_UNAVAILABLE_REPLY;
}

/**
 * The status and setup commands remain available so an administrator can inspect
 * the incident or reactivate the bot after its Telegram privileges are restored.
 */
export function shouldRejectUnavailableManagedGroupCommand(input: { groupStatus: string; text?: string }): boolean {
  const normalized = input.text?.trim().toLocaleLowerCase("fa-IR") ?? "";
  if (!isLikelyManagedGroupCommand(normalized)) return false;
  if (isGroupSetupCommand(normalized) || GROUP_STATUS_COMMANDS.has(normalized)) return false;
  return input.groupStatus === "permission_lost" || input.groupStatus === "removed";
}

/** Returns true only for a managed command in a group update whose sender is unavailable. */
export function shouldRejectMissingGroupActor(input: { chatType?: string; actorId?: number; text?: string }): boolean {
  return (input.chatType === "group" || input.chatType === "supergroup") && !input.actorId && isLikelyManagedGroupCommand(input.text ?? "");
}
