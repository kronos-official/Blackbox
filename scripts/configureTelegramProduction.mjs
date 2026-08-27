const baseUrl = process.env.TELEGRAM_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!baseUrl || !/^https:\/\/[^/?#]+$/.test(baseUrl) || !token || !secret || secret.length < 32) {
  throw new Error("TELEGRAM_PUBLIC_BASE_URL, TELEGRAM_BOT_TOKEN, and a strong TELEGRAM_WEBHOOK_SECRET are required");
}

async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`${method} failed: ${data.description ?? response.status}`);
  return data.result;
}

const webhookUrl = `${baseUrl}/api/telegram/webhook`;
const commandMenu = [
  { command: "start", description: "شروع و معرفی ربات" },
  { command: "help", description: "راهنمای کامل ربات" }, { command: "language", description: "انتخاب زبان" }, { command: "channel", description: "ثبت کانال در بازارچه" },
  { command: "ban", description: "مسدود کردن کاربر" }, { command: "kick", description: "اخراج کاربر" }, { command: "mute", description: "سکوت کاربر" }, { command: "warn", description: "ثبت اخطار" }, { command: "delete", description: "پاک‌سازی محدود پیام‌ها" }, { command: "clear", description: "پاک‌سازی محدود پیام‌ها" },
  { command: "unban", description: "رفع مسدودیت" }, { command: "unmute", description: "رفع سکوت" }, { command: "owner", description: "بررسی دسترسی مالک" },
  { command: "setup", description: "تنظیم وب‌هوک و مینی‌اپ" }, { command: "payapprove", description: "تأیید پرداخت دستی" }, { command: "payreject", description: "رد پرداخت دستی" },
];
await telegram("setWebhook", {
  url: webhookUrl,
  secret_token: secret,
  allowed_updates: ["message", "callback_query", "chat_member", "my_chat_member", "pre_checkout_query"],
  drop_pending_updates: false,
});
await telegram("setChatMenuButton", {
  menu_button: { type: "web_app", text: "Kronos Guard", web_app: { url: `${baseUrl}/dashboard` } },
});
await telegram("setMyCommands", { commands: commandMenu });
const webhookInfo = await telegram("getWebhookInfo", {});
if (webhookInfo.url !== webhookUrl) throw new Error("Telegram reported an unexpected webhook URL");
console.log(JSON.stringify({ webhookUrl: webhookInfo.url, pendingUpdateCount: webhookInfo.pending_update_count ?? 0, lastErrorMessage: webhookInfo.last_error_message ?? null }));
