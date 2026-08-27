import type { Telegram } from "telegraf";
import { OWNER_TELEGRAM_ID } from "./constants";
import { createOwnerAlertRecord, markOwnerAlertDelivery } from "./repository";
import { withTelegramRetry } from "./retry";

/** Prevents concurrent deliveries of the same durable dedupe key inside one webhook worker. */
const ownerAlertDeliveriesInFlight = new Set<string>();

export type OwnerAlertInput = {
  alertType: "raid" | "spam_wave" | "forced_join_expired" | "bot_permission_lost" | "webhook_problem" | "database_problem" | "scheduler_failure" | "payment_approval";
  severity: "warning" | "critical";
  title: string;
  body: string;
  dedupeKey: string;
  relatedEntityType?: string;
  relatedEntityId?: number;
};

/** Records critical incidents and sends a concise private owner notification exactly once per dedupe key. */
export async function alertOwner(telegram: Telegram | undefined, input: OwnerAlertInput) {
  if (ownerAlertDeliveriesInFlight.has(input.dedupeKey)) return;
  ownerAlertDeliveriesInFlight.add(input.dedupeKey);
  let alert: Awaited<ReturnType<typeof createOwnerAlertRecord>>;
  try {
    alert = await createOwnerAlertRecord(input);
    if (!telegram || !alert || alert.status === "sent" || alert.status === "acknowledged") return;
    const deliveryAlert = alert;
    await withTelegramRetry(() =>
      telegram.sendMessage(
        OWNER_TELEGRAM_ID,
        `⚠️ ${input.title}\n\n${input.body}\n\nشناسه رخداد: ${deliveryAlert.id}`
      )
    );
    await markOwnerAlertDelivery(deliveryAlert.id, "sent");
  } catch (error) {
    console.error("[Kronos Guard] owner alert delivery failed", error);
    if (alert) await markOwnerAlertDelivery(alert.id, "failed");
  } finally {
    ownerAlertDeliveriesInFlight.delete(input.dedupeKey);
  }
}
