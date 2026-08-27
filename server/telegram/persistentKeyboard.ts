import { Markup } from "telegraf";
import type { Context } from "telegraf";
import { supportedLocales, type SupportedLocale } from "./i18n";
import { withTelegramButtonStyle } from "./buttonStyle";

export const PERSISTENT_KEYBOARD_ACTIONS = {
  numericId: "استخراج آیدی",
  // Kept routable for clients that still cache an older Telegram keyboard; none are rendered by the new keyboard.
  profile: "پروفایل",
  dashboard: "کنترل سنتر",
  help: "راهنمای کامل",
  membership: "وضعیت دسترسی",
  language: "زبان رابط",
  forcedJoin: "عضویت اجباری",
  about: "دربارهٔ ما",
  support: "پشتیبانی",
} as const;

export type PersistentKeyboardAction = (typeof PERSISTENT_KEYBOARD_ACTIONS)[keyof typeof PERSISTENT_KEYBOARD_ACTIONS];
export type NumericIdEntityKind = "channel" | "group" | "user" | "bot";

const LANGUAGE_LABELS: Record<SupportedLocale, string> = {
  fa: "فارسی", en: "English", ar: "العربية", tr: "Türkçe", ru: "Русский", es: "Español",
  fr: "Français", pt: "Português", it: "Italiano", de: "Deutsch", pl: "Polski", vi: "Tiếng Việt",
};

export function getTelegramMiniAppUrl(publicBaseUrl = process.env.TELEGRAM_PUBLIC_BASE_URL): string | null {
  if (!publicBaseUrl) return null;
  try {
    const url = new URL(publicBaseUrl.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (url.hostname === "localhost" || /^127\./.test(url.hostname) || /^10\./.test(url.hostname) || /^192\.168\./.test(url.hostname)) return null;
    return `${url.origin}/dashboard`;
  } catch {
    return null;
  }
}

export const QUICK_HELP_MESSAGE = "✦ راهنمای کامل Kronos Guard\n\n◈ مدیریت اعضا\n• وضعیت کاربر / پنل کاربر\n• بن، رفع بن، اخراج\n• سکوت، لغو سکوت\n• اخطار، حذف اخطار\n\n◆ نقش و لقب\n• تنظیم مدیر، تنظیم مالک، تنظیم ویژه\n• عزل مقام، مدیران، مالکان، ویژه\n• تنظیم لقب، حذف لقب، لقب\n\n▣ ابزارهای گروه\n• تگ — اطلاع‌رسانی کنترل‌شده\n• لینک — ساخت، نمایش و ابطال لینک دعوت\n• آمار — گزارش بازه‌ای و زمان‌بندی سفارشی\n• وضعیت گروه، وضعیت قفل‌ها و پاکسازی\n• ضدحمله روشن | ضدحمله خاموش | ضدحمله وضعیت — محدودسازی موقتِ موج ورود مشکوک\n• قفل محتوا و عضویت اجباری\n\n◆ قالب‌های ورود و خروج\n• خوشامد متن <متن> | خداحافظ متن <متن>\n• خوشامد پیش‌نمایش | خداحافظ پیش‌نمایش\n• خوشامد بازنشانی | خداحافظ بازنشانی\n\n◈ کنترل سنتر کارکنان\n• گروه، شناسهٔ عددی عضو و مقام داخلی را انتخاب کن.\n• ابتدا «بازبینی تغییر» را بزن؛ سپس خلاصه را با «تأیید و ثبت» نهایی کن.\n• این عملیات فقط برای مالک ربات یا مدیر مجاز همان گروه در کنترل سنتر در دسترس است.\n\n◆ پروفایل‌های قفل\n• فضای باز: همهٔ قفل‌های محتوا را غیرفعال می‌کند.\n• سپر رسانه: رسانه، فوروارد و لینک را محدود می‌کند.\n• نگهبان سخت‌گیر: دامنهٔ گسترده‌تری از محتوای پرریسک و فرمان‌ها را محدود می‌کند.\n• پیش از اعمال، وضعیت فعلی ذخیره می‌شود؛ از «بازگردانی وضعیت قبلی» برای برگشت امن استفاده کن.\n\n⌁ ابزارهای عمومی\n• استخراج آیدی — انتخاب کاربر، گروه، کانال یا ربات از پنجرهٔ رسمی Telegram\n• /start، /help، /language، /panel، /about، /support\n\n⌘ فقط مالک\n• /owner و /setup\n• /channel، /payapprove و /payreject\n• مدیریت پرداخت، رسید، عضویت اجباری و پیام سراسری از کنترل سنتر\n\nبرای اقدام روی یک عضو، ریپلای مستقیم روی پیام او دقیق‌ترین روش است. ربات نیز باید مجوز لازم گروه را داشته باشد.";

export function miniAppLaunchKeyboard(miniAppUrl = getTelegramMiniAppUrl()) {
  if (!miniAppUrl) throw new Error("TELEGRAM_PUBLIC_BASE_URL must be a valid public HTTPS root URL");
  return Markup.inlineKeyboard([[withTelegramButtonStyle(Markup.button.webApp("باز کردن Mini App", miniAppUrl), "primary")]]);
}

export function kronosPersistentKeyboard() {
  return Markup.keyboard([
    [PERSISTENT_KEYBOARD_ACTIONS.numericId],
  ]).resize().persistent().placeholder("Kronos Guard — استخراج امن آیدی");
}

export function numericIdEntityKeyboard() {
  return Markup.inlineKeyboard([
    [
      withTelegramButtonStyle(Markup.button.callback("👤 کاربران", "numeric-id:user"), "primary"),
      withTelegramButtonStyle(Markup.button.callback("📣 کانال‌ها", "numeric-id:channel"), "primary"),
    ],
    [
      withTelegramButtonStyle(Markup.button.callback("👥 گروه‌ها", "numeric-id:group"), "primary"),
      withTelegramButtonStyle(Markup.button.callback("🤖 ربات‌ها", "numeric-id:bot"), "primary"),
    ],
    [withTelegramButtonStyle(Markup.button.callback("لغو عملیات", "numeric-id:cancel"), "danger")],
  ]);
}

export const NUMERIC_ID_NATIVE_REQUEST_IDS = { user: 7101, bot: 7102, group: 7103, channel: 7104 } as const;

export function numericIdNativeKeyboard(kind: NumericIdEntityKind) {
  const button = kind === "user"
    ? Markup.button.userRequest("انتخاب کاربر از Telegram", NUMERIC_ID_NATIVE_REQUEST_IDS.user, { user_is_bot: false, max_quantity: 1 })
    : kind === "bot"
      ? Markup.button.botRequest("انتخاب ربات از Telegram", NUMERIC_ID_NATIVE_REQUEST_IDS.bot, { max_quantity: 1 })
      : kind === "group"
        ? Markup.button.groupRequest("انتخاب گروه از Telegram", NUMERIC_ID_NATIVE_REQUEST_IDS.group, {})
        : Markup.button.channelRequest("انتخاب کانال از Telegram", NUMERIC_ID_NATIVE_REQUEST_IDS.channel, {});
  return Markup.keyboard([[button], ["لغو عملیات"]]).resize().oneTime().placeholder("انتخاب مقصد در Telegram");
}

export function numericIdConfirmKeyboard(kind: NumericIdEntityKind, id: number) {
  return Markup.inlineKeyboard([
    [
      withTelegramButtonStyle(Markup.button.callback("ارسال", `numeric-confirm:yes:${kind}:${id}`), "success"),
      withTelegramButtonStyle(Markup.button.callback("انصراف", `numeric-confirm:no:${kind}:${id}`), "danger"),
    ],
    [withTelegramButtonStyle(Markup.button.callback("بازگشت به فهرست", `numeric-id:${kind}`), "primary")],
  ]);
}

export function numericIdCandidatesKeyboard(kind: NumericIdEntityKind, candidates: Array<{ id: number; label: string }>) {
  return Markup.inlineKeyboard([
    ...candidates.map(candidate => [Markup.button.callback(candidate.label.slice(0, 55), `numeric-known:${kind}:${candidate.id}`)]),
    [withTelegramButtonStyle(Markup.button.callback("بازگشت به دسته‌ها", "numeric-id:back"), "primary")],
    [withTelegramButtonStyle(Markup.button.callback("لغو عملیات", "numeric-id:cancel"), "danger")],
  ]);
}

export function numericIdCancelKeyboard() {
  return Markup.inlineKeyboard([[withTelegramButtonStyle(Markup.button.callback("لغو عملیات", "numeric-id:cancel"), "danger")]]);
}

export function supportOptionsKeyboard() {
  const miniAppUrl = getTelegramMiniAppUrl();
  if (!miniAppUrl) throw new Error("TELEGRAM_PUBLIC_BASE_URL must be a valid public HTTPS root URL");
  return Markup.inlineKeyboard([
    [withTelegramButtonStyle(Markup.button.url("ارتباط مستقیم با پشتیبانی", "https://t.me/kronosteam_official"), "primary")],
    [withTelegramButtonStyle(Markup.button.webApp("ارسال تیکت از Mini App", miniAppUrl), "primary")],
  ]);
}

export function languageSelectorKeyboard() {
  const buttons = supportedLocales.map(locale => Markup.button.callback(LANGUAGE_LABELS[locale], `language:${locale}`));
  const rows: typeof buttons[] = [];
  for (let index = 0; index < buttons.length; index += 2) rows.push(buttons.slice(index, index + 2));
  return Markup.inlineKeyboard(rows);
}

export type PersistentKeyboardContext = Pick<Context, "chat" | "from" | "reply">;

type PersistentKeyboardHandlerDependencies = {
  getLocale: (telegramUserId: number) => Promise<string | null | undefined>;
  languagePrompt: (locale: string | null | undefined) => string;
  keyboard: typeof kronosPersistentKeyboard;
  languageSelector: typeof languageSelectorKeyboard;
  beginNumericIdConversion?: (ctx: PersistentKeyboardContext) => Promise<void>;
};

function isPrivateChat(ctx: PersistentKeyboardContext) { return ctx.chat?.type === "private"; }

export function createPersistentKeyboardHandlers(dependencies: PersistentKeyboardHandlerDependencies) {
  const respond = async (ctx: PersistentKeyboardContext, message: string) => {
    if (!isPrivateChat(ctx)) return;
    await ctx.reply(message, dependencies.keyboard());
  };
  const begin = async (ctx: PersistentKeyboardContext) => {
    if (!isPrivateChat(ctx)) return;
    if (dependencies.beginNumericIdConversion) return dependencies.beginNumericIdConversion(ctx);
    await ctx.reply("دستهٔ مقصد را انتخاب کنید تا پنجرهٔ رسمی Telegram باز شود.", numericIdEntityKeyboard());
  };

  return {
    [PERSISTENT_KEYBOARD_ACTIONS.numericId]: (ctx: PersistentKeyboardContext) => begin(ctx),
    [PERSISTENT_KEYBOARD_ACTIONS.profile]: (ctx: PersistentKeyboardContext) => respond(ctx, "برای مدیریت حرفه‌ای و مشاهدهٔ اطلاعات کامل، Mini App Kronos Guard را باز کنید."),
    [PERSISTENT_KEYBOARD_ACTIONS.dashboard]: (ctx: PersistentKeyboardContext) => respond(ctx, "کنترل سنتر از دکمهٔ Menu در پایین گفت‌وگو باز می‌شود."),
    [PERSISTENT_KEYBOARD_ACTIONS.help]: (ctx: PersistentKeyboardContext) => respond(ctx, QUICK_HELP_MESSAGE),
    [PERSISTENT_KEYBOARD_ACTIONS.membership]: (ctx: PersistentKeyboardContext) => respond(ctx, "وضعیت عضویت اجباری پیش از دسترسی به‌صورت زنده بررسی می‌شود."),
    [PERSISTENT_KEYBOARD_ACTIONS.language]: async (ctx: PersistentKeyboardContext) => {
      if (!isPrivateChat(ctx)) return;
      const locale = await dependencies.getLocale(ctx.from?.id ?? 0);
      await ctx.reply(dependencies.languagePrompt(locale), dependencies.languageSelector());
    },
    [PERSISTENT_KEYBOARD_ACTIONS.forcedJoin]: (ctx: PersistentKeyboardContext) => respond(ctx, "مرکز عضویت اجباری برای مالک اصلی فعال است."),
    [PERSISTENT_KEYBOARD_ACTIONS.about]: (ctx: PersistentKeyboardContext) => respond(ctx, "دربارهٔ ما را از Mini App Kronos Guard باز کنید تا داستان تیم، مأموریت و معماری محصول را ببینید."),
    [PERSISTENT_KEYBOARD_ACTIONS.support]: async (ctx: PersistentKeyboardContext) => {
      if (!isPrivateChat(ctx)) return;
      await ctx.reply("پشتیبانی Kronos Guard\n\nبرای ارتباط مستقیم یا ثبت تیکت ساختاریافته یکی از گزینه‌ها را انتخاب کنید.", supportOptionsKeyboard());
    },
  } satisfies Record<PersistentKeyboardAction, (ctx: PersistentKeyboardContext) => Promise<void>>;
}
