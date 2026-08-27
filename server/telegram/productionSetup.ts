import { OWNER_TELEGRAM_ID } from "./constants";

export function productionTelegramUrls(rawDomain: string) {
  const candidate = rawDomain.trim().replace(/\/+$/, "");
  const url = new URL(candidate);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("A clean public HTTPS domain is required");
  }
  if (url.hostname === "localhost" || /^127\./.test(url.hostname) || /^10\./.test(url.hostname) || /^192\.168\./.test(url.hostname)) {
    throw new Error("A public HTTPS domain is required");
  }
  return { baseUrl: url.origin, webhookUrl: `${url.origin}/api/telegram/webhook`, miniAppUrl: `${url.origin}/dashboard` };
}

export type TelegramProductionClient = {
  setWebhook: (url: string, options: { secret_token: string; allowed_updates: string[] }) => Promise<unknown>;
  setChatMenuButton: (options: { menu_button: { type: "web_app"; text: string; web_app: { url: string } } }) => Promise<unknown>;
  setMyCommands: (commands: TelegramCommandMenuEntry[]) => Promise<unknown>;
};

export type TelegramCommandMenuEntry = { command: string; description: string };

const ADMINISTRATOR_STATUSES = new Set(["administrator", "creator"]);
const NON_ADMINISTRATOR_STATUSES = new Set(["member", "restricted"]);

export type BotMembershipAnnouncement = "permission" | "activation" | false;

/** Returns a transition announcement only when the bot enters a meaningful lifecycle state. */
export function shouldAnnounceBotMembershipTransition(previousStatus: string | undefined, nextStatus: string): BotMembershipAnnouncement {
  if (previousStatus === nextStatus) return false;
  if (ADMINISTRATOR_STATUSES.has(nextStatus) && !ADMINISTRATOR_STATUSES.has(previousStatus ?? "")) return "activation";
  if (NON_ADMINISTRATOR_STATUSES.has(nextStatus) && (previousStatus === "left" || previousStatus === "kicked" || previousStatus === undefined || ADMINISTRATOR_STATUSES.has(previousStatus))) return "permission";
  return false;
}

function safeChatTitle(chatTitle: string) {
  return chatTitle.replace(/[\\r\\n]+/g, " ").trim().slice(0, 128) || "این گروه";
}

export function groupPermissionRequiredMessage(chatTitle: string) {
  const title = safeChatTitle(chatTitle);
  return `⚙️ راه‌اندازی ربات در «${title}»\n\nربات به گروه اضافه شد، اما برای شروع فعالیت کامل هنوز دسترسی مدیریتی کافی ندارد. مالک یا مدیر گروه باید ربات را به‌عنوان مدیر ارتقا دهد و مجوزهای لازم برای مدیریت پیام‌ها و اعضا را فعال کند.\n\nپس از اعطای دسترسی، راه‌اندازی به‌صورت خودکار تکمیل می‌شود.`;
}

export function groupActivationMessage(chatTitle: string) {
  const title = safeChatTitle(chatTitle);
  const rtl = "\u200F";
  const isolate = (value: string) => `\u2068${value}\u2069`;
  return `${rtl}✦ <b>«${isolate(title)}» آماده است</b>\n\n${rtl}<i>${isolate("𝐾𝑟𝑜𝑛𝑜𝑠 𝐺𝑢𝑎𝑟𝑑")} با دسترسی مدیریتی فعال شد.</i>\n\n${rtl}👤 <b>اعضا</b> · اخطار، سکوت و بن\n${rtl}🛡️ <b>امنیت</b> · قفل محتوا و ضداسپم\n${rtl}⚙️ <b>کنترل</b> · نقش‌ها، تگ و ${isolate("𝑀𝑖𝑛𝑖 𝐴𝑝𝑝")}\n\n${rtl}<blockquote>برای همگام‌سازی خودکار مالک و مدیران گروه، دکمهٔ زیر را بزنید.</blockquote>\n\n${rtl}⌁ <a href="https://t.me/kronosteam_official">${isolate("𝐾𝑟𝑜𝑛𝑜𝑠 𝑆𝑢𝑝𝑝𝑜𝑟𝑡")}</a>`;
}

export function groupActivationKeyboard() {
  return { inline_keyboard: [[{ text: "راه‌اندازی خودکار مدیران", callback_data: "group-role-bootstrap" }]] };
}

export function groupActivationMessageOptions() {
  return { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true }, reply_markup: groupActivationKeyboard() };
}

export const telegramCommandMenu: TelegramCommandMenuEntry[] = [
  { command: "start", description: "شروع و معرفی ربات" },
  { command: "help", description: "راهنمای کامل ربات" },
  { command: "language", description: "انتخاب زبان" },
  { command: "channel", description: "ثبت کانال در بازارچه" },
  { command: "ban", description: "مسدود کردن کاربر" },
  { command: "kick", description: "اخراج کاربر" },
  { command: "mute", description: "سکوت کاربر" },
  { command: "warn", description: "ثبت اخطار" },
  { command: "delete", description: "پاک‌سازی محدود پیام‌ها" },
  { command: "clear", description: "پاک‌سازی محدود پیام‌ها" },
  { command: "unban", description: "رفع مسدودیت" },
  { command: "unmute", description: "رفع سکوت" },
  { command: "tag", description: "بازکردن پنل تگ کنترل‌شده" },
  { command: "owner", description: "بررسی دسترسی مالک" },
  { command: "setup", description: "تنظیم وب‌هوک و مینی‌اپ" },
  { command: "payapprove", description: "تأیید پرداخت دستی" },
  { command: "payreject", description: "رد پرداخت دستی" },
];

export async function configureTelegramProduction(input: { actorTelegramId: number | undefined; rawDomain: string | undefined; webhookSecret: string | undefined; client: TelegramProductionClient }) {
  if (input.actorTelegramId !== OWNER_TELEGRAM_ID) throw new Error("owner-only");
  if (!input.rawDomain) throw new Error("missing-domain");
  if (!input.webhookSecret || input.webhookSecret.length < 32) throw new Error("missing-webhook-secret");
  const urls = productionTelegramUrls(input.rawDomain);
  await input.client.setWebhook(urls.webhookUrl, { secret_token: input.webhookSecret, allowed_updates: ["message", "callback_query", "chat_member", "my_chat_member", "pre_checkout_query"] });
  await input.client.setChatMenuButton({ menu_button: { type: "web_app", text: "Kronos Guard", web_app: { url: urls.miniAppUrl } } });
  await input.client.setMyCommands(telegramCommandMenu);
  return urls;
}
