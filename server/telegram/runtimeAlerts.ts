import { Telegraf } from "telegraf";
import { OWNER_TELEGRAM_ID } from "./constants";
import { alertOwner } from "./alerts";

/** Sends a deduplicated owner alert when bot initialization cannot complete. */
export async function notifyBotInitializationFailure(error: unknown, token = process.env.TELEGRAM_BOT_TOKEN) {
  if (!token) return false;
  try {
    const telegram = new Telegraf(token).telegram;
    await alertOwner(telegram, {
      alertType: "database_problem",
      severity: "critical",
      title: "راه‌اندازی Kronos Guard ناموفق بود",
      body: `ربات هنگام آماده‌سازی اولیه در دسترس نشد. جزئیات: ${error instanceof Error ? error.message.slice(0, 400) : "خطای ناشناخته"}`,
      dedupeKey: `bot-initialization-${new Date().toISOString().slice(0, 13)}`,
      relatedEntityType: "telegram_owner",
      relatedEntityId: OWNER_TELEGRAM_ID,
    });
    return true;
  } catch (notificationError) {
    console.error("[Kronos Guard] could not deliver bot initialization alert", notificationError);
    return false;
  }
}
