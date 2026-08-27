import { Markup } from "telegraf";
import type { Context } from "telegraf";
import { withTelegramButtonStyle } from "./buttonStyle";
import { isOwnerTelegramId } from "./authorization";
import { getTelegramMiniAppUrl } from "./persistentKeyboard";
import { sendInlineSelfUserPanel } from "./moderation";
import { sendInlineStatisticsMenu } from "./statistics";

export const INLINE_CONTROL_CENTER_PREFIX = "cc:";

const sectionLabels = {
  members: "👥 مدیریت اعضا",
  roles: "🛡 نقش و لقب",
  group: "🧰 ابزارهای گروه",
  security: "🔒 امنیت و قفل‌ها",
  stats: "📊 آمار و گزارش",
  owner: "👑 ابزارهای مالک",
  about: "ℹ️ راهنما و پشتیبانی",
} as const;

type Section = keyof typeof sectionLabels;

function callback(text: string, data: string, style: "primary" | "success" | "danger" = "primary") {
  return withTelegramButtonStyle(Markup.button.callback(text, `${INLINE_CONTROL_CENTER_PREFIX}${data}`), style);
}

export function inlineControlCenterKeyboard(showOwner = false, miniAppUrl = getTelegramMiniAppUrl()) {
  const rows: any[][] = [
    [callback(sectionLabels.members, "section:members"), callback(sectionLabels.roles, "section:roles")],
    [callback(sectionLabels.group, "section:group"), callback(sectionLabels.security, "section:security")],
    [callback(sectionLabels.stats, "section:stats"), callback(sectionLabels.about, "section:about")],
  ];
  if (showOwner) rows.push([callback(sectionLabels.owner, "section:owner")]);
  if (miniAppUrl) rows.push([withTelegramButtonStyle(Markup.button.webApp("🚀 باز کردن Mini App", miniAppUrl), "success")]);
  return Markup.inlineKeyboard(rows as any);
}

const sectionCommands: Record<Section, Array<[string, string]>> = {
  members: [
    ["📄 پنل کاربر", "اجرای سریع: «پنل کاربر» را بدون هدف برای پنل خودت، یا با ریپلای برای پنل عضو اجرا کن."],
    ["📌 وضعیت کاربر", "اجرای سریع: روی پیام عضو ریپلای کن و «وضعیت کاربر» را بفرست."],
    ["🔇 سکوت و رفع سکوت", "اجرای سریع: «سکوت» یا «رفع سکوت» را با ریپلای روی پیام عضو اجرا کن."],
    ["⛔ بن، رفع بن و اخراج", "اجرای سریع: بن، رفع بن یا اخراج را با ریپلای اجرا کن؛ دسترسی و تأیید همچنان اجباری است."],
    ["⚠️ اخطار", "اجرای سریع: با ریپلای روی پیام عضو، «اخطار» یا «حذف اخطار» را اجرا کن."],
  ],
  roles: [
    ["🏷 تنظیم لقب", "راهنما: «تنظیم لقب» را با ریپلای روی عضو عادی اجرا کن؛ لقب مدیران و مالکان Telegram تغییر نمی‌کند."],
    ["🛡 مقام‌های داخلی", "راهنما: تنظیم مدیر، مالک، ویژه و عزل مقام‌ها از مسیر کنترل دسترسی Kronos انجام می‌شود."],
    ["📋 فهرست مقام‌ها", "راهنما: فهرست مدیران، مالکان و کاربران ویژه را از راهنمای کامل یا Mini App باز کن."],
  ],
  group: [
    ["🔗 لینک دعوت", "راهنما: «لینک» را در گروه اجرا کن؛ ربات باید دسترسی ساخت لینک داشته باشد."],
    ["📣 تگ گروهی", "راهنما: «تگ» برای اطلاع‌رسانی کنترل‌شده به اعضای گروه است."],
    ["🧹 پاکسازی", "راهنما: پاکسازی فقط در محدودهٔ مجاز و با دسترسی مدیریتی اجرا می‌شود."],
    ["👋 خوشامد و خداحافظی", "راهنما: متن‌ها و پیش‌نمایش‌های ورود و خروج از فرمان‌های اختصاصی مدیریت می‌شوند."],
  ],
  security: [
    ["🛡 ضداسپم و ضدحمله", "راهنما: وضعیت ضدحمله و سیاست‌های ضداسپم را از تنظیمات گروه بررسی کن."],
    ["🔒 قفل محتوا", "راهنما: پروفایل قفل را انتخاب کن؛ قبل از اعمال، وضعیت فعلی قابل بازگردانی است."],
    ["✅ عضویت اجباری", "راهنما: کانال‌های اجباری و بررسی زندهٔ عضویت از مرکز مدیریت مالک کنترل می‌شوند."],
  ],
  stats: [
    ["📊 آمار امروز", "راهنما: «آمار امروز» گزارش پیام‌ها، رسانه‌ها، ورود و عملیات مدیریتی را نمایش می‌دهد."],
    ["📈 گزارش بازه‌ای", "راهنما: گزارش هفتگی و بازه‌ای از سامانهٔ آماری ثبت‌شدهٔ Kronos Guard خوانده می‌شود."],
    ["🔄 تازه‌سازی داده‌ها", "راهنما: پنل‌ها و گزارش‌ها دادهٔ تازه را با کنترل محدودیت درخواست دریافت می‌کنند."],
  ],
  owner: [
    ["📣 کانال‌های اجباری", "راهنما: مدیریت کانال‌های عضویت اجباری فقط برای مالک واقعی ربات فعال است."],
    ["💳 پرداخت و رسید", "راهنما: بررسی پرداخت و رسید فقط برای مالک واقعی ربات در دسترس است."],
    ["📢 پیام سراسری", "راهنما: ارسال پیام سراسری نیازمند تأیید و دسترسی مالک واقعی ربات است."],
  ],
  about: [
    ["📚 راهنمای کامل", "راهنما: همهٔ دستورات و قابلیت‌ها در پیام راهنمای کامل فهرست شده‌اند."],
    ["🌐 زبان رابط", "راهنما: زبان رابط از بخش زبان انتخاب می‌شود و متن‌ها با RTL فارسی‌اول نمایش داده می‌شوند."],
    ["🎧 پشتیبانی", "راهنما: برای پشتیبانی مستقیم یا ثبت تیکت ساختاریافته از دکمهٔ پشتیبانی استفاده کن."],
  ],
};

export function inlineControlCenterSectionKeyboard(section: Section, showOwner: boolean) {
  const rows = sectionCommands[section].map(([label], index) => [callback(label, `info:${section}:${index}`)]);
  rows.push([callback("↩️ بازگشت به کنترل سنتر", "home")]);
  return Markup.inlineKeyboard(rows as any);
}

export function inlineControlCenterSectionText(section: Section) {
  return `<b>${sectionLabels[section]}</b>\n\nیک گزینه را انتخاب کن تا راهنمای سریع و مسیر اجرای آن را ببینی.`;
}

export function inlineControlCenterInfo(section: Section, index: number) {
  return sectionCommands[section]?.[index]?.[1] ?? "این گزینه در حال حاضر در دسترس نیست.";
}

export function isInlineControlCenterCallback(data: unknown): data is string {
  return typeof data === "string" && data.startsWith(INLINE_CONTROL_CENTER_PREFIX);
}

export async function sendInlineControlCenter(ctx: Pick<Context, "reply" | "from">) {
  await ctx.reply("<b>◈ کنترل سنتر Kronos Guard</b>\n\nقابلیت موردنظر را از دکمه‌های زیر انتخاب کن.", {
    parse_mode: "HTML",
    ...inlineControlCenterKeyboard(isOwnerTelegramId(ctx.from?.id)),
  });
}

export async function handleInlineControlCenterCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
  if (!isInlineControlCenterCallback(data)) return false;
  const payload = data.slice(INLINE_CONTROL_CENTER_PREFIX.length);
  const isOwner = isOwnerTelegramId(ctx.from?.id);
  if (payload === "home") {
    await ctx.answerCbQuery();
    await ctx.editMessageText("<b>◈ کنترل سنتر Kronos Guard</b>\n\nقابلیت موردنظر را از دکمه‌های زیر انتخاب کن.", { parse_mode: "HTML", ...inlineControlCenterKeyboard(isOwner) });
    return true;
  }
  const sectionMatch = payload.match(/^section:(members|roles|group|security|stats|owner|about)$/);
  if (sectionMatch) {
    const section = sectionMatch[1] as Section;
    if (section === "owner" && !isOwner) {
      await ctx.answerCbQuery("این بخش فقط برای مالک ربات فعال است.", { show_alert: true });
      return true;
    }
    await ctx.answerCbQuery();
    await ctx.editMessageText(inlineControlCenterSectionText(section), { parse_mode: "HTML", ...inlineControlCenterSectionKeyboard(section, isOwner) });
    return true;
  }
  const infoMatch = payload.match(/^info:(members|roles|group|security|stats|owner|about):(\d+)$/);
  if (infoMatch) {
    const section = infoMatch[1] as Section;
    const index = Number(infoMatch[2]);
    if (section === "owner" && !isOwner) {
      await ctx.answerCbQuery("این بخش فقط برای مالک ربات فعال است.", { show_alert: true });
      return true;
    }
    if (section === "members" && index === 0) {
      await ctx.answerCbQuery("در حال آماده‌سازی پنل شما…");
      await sendInlineSelfUserPanel(ctx);
      return true;
    }
    if (section === "stats" && index === 0) {
      await ctx.answerCbQuery("در حال آماده‌سازی منوی آمار…");
      await sendInlineStatisticsMenu(ctx);
      return true;
    }
    await ctx.answerCbQuery();
    await ctx.reply(inlineControlCenterInfo(section, index), { ...inlineControlCenterSectionKeyboard(section, isOwner) });
    return true;
  }
  await ctx.answerCbQuery("گزینهٔ کنترل سنتر شناخته نشد.", { show_alert: true });
  return true;
}
