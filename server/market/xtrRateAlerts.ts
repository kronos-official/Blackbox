import { desc, eq } from "drizzle-orm";
import { xtrRateAlertHistory, xtrRateAlerts } from "../../drizzle/schema";
import { getDb } from "../db";
import { updateHeartbeatJob, createHeartbeatJob } from "../_core/heartbeat";
import { createUserNotification } from "../notifications";
import { getStarsReferenceMarketData } from "../marketplace/starsReferenceRate";
import { getTelegramBot } from "../telegram/bot";
import { withTelegramRetry } from "../telegram/retry";

export const XTR_ALERT_INTERVALS = [1, 5, 15, 60] as const;
export type XtrAlertInterval = (typeof XTR_ALERT_INTERVALS)[number];

const DEFAULT_INTERVAL_MINUTES: XtrAlertInterval = 15;
const DEFAULT_THRESHOLD_BPS = 500;
const MIN_THRESHOLD_BPS = 10;
const MAX_THRESHOLD_BPS = 10_000;

export type XtrRateAlertSettings = {
  enabled: boolean;
  intervalMinutes: XtrAlertInterval;
  thresholdBps: number;
  targetEnabled: boolean;
  targetPriceUsd: number | null;
  targetDirection: "above" | "below";
  privateDeliveryEnabled: boolean;
  scheduleCronTaskUid: string | null;
  lastObservedUsd: number | null;
  lastCheckedAt: Date | null;
  lastAlertedAt: Date | null;
};

function isInterval(value: number): value is XtrAlertInterval {
  return (XTR_ALERT_INTERVALS as readonly number[]).includes(value);
}

function asPrice(value: string | null | undefined) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value < 0.1 ? 6 : 4 }).format(value);
}

function formatToman(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
}

function areMarketAlertsRetired() {
  return true;
}

function toSettings(row: typeof xtrRateAlerts.$inferSelect | undefined): XtrRateAlertSettings {
  return {
    enabled: row?.enabled ?? false,
    intervalMinutes: isInterval(row?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES) ? row!.intervalMinutes as XtrAlertInterval : DEFAULT_INTERVAL_MINUTES,
    thresholdBps: row?.thresholdBps ?? DEFAULT_THRESHOLD_BPS,
    targetEnabled: row?.targetEnabled ?? false,
    targetPriceUsd: asPrice(row?.targetPriceUsd),
    targetDirection: row?.targetDirection === "below" ? "below" : "above",
    privateDeliveryEnabled: row?.privateDeliveryEnabled ?? false,
    scheduleCronTaskUid: row?.scheduleCronTaskUid ?? null,
    lastObservedUsd: asPrice(row?.lastObservedUsd),
    lastCheckedAt: row?.lastCheckedAt ?? null,
    lastAlertedAt: row?.lastAlertedAt ?? null,
  };
}

function alertCron(intervalMinutes: XtrAlertInterval) {
  return `0 */${intervalMinutes} * * * *`;
}

async function syncHeartbeat(telegramUserId: number, enabled: boolean, intervalMinutes: XtrAlertInterval, taskUid: string | null) {
  const patch = {
    cron: alertCron(intervalMinutes),
    path: "/api/scheduled/xtr-rate-alert",
    method: "POST" as const,
    payload: { telegramUserId },
    description: `Kronos Guard XTR rate alert for Telegram user ${telegramUserId}`,
    enable: enabled,
  };
  if (taskUid) {
    await updateHeartbeatJob(taskUid, patch, "");
    return taskUid;
  }
  if (!enabled) return null;
  const created = await createHeartbeatJob({ name: `kronos:xtr-rate-alert:${telegramUserId}`, ...patch }, "");
  return created.taskUid;
}

export async function getXtrRateAlertSettings(telegramUserId: number): Promise<XtrRateAlertSettings> {
  const db = await getDb();
  if (!db) return toSettings(undefined);
  const row = (await db.select().from(xtrRateAlerts).where(eq(xtrRateAlerts.telegramUserId, telegramUserId)).limit(1))[0];
  return toSettings(row);
}

export async function saveXtrRateAlertSettings(telegramUserId: number, input: Pick<XtrRateAlertSettings, "enabled" | "intervalMinutes" | "thresholdBps" | "targetEnabled" | "targetPriceUsd" | "targetDirection" | "privateDeliveryEnabled">) {
  if (!isInterval(input.intervalMinutes)) throw new Error("بازهٔ بررسی باید 1، 5، 15 یا 60 دقیقه باشد.");
  if (!Number.isInteger(input.thresholdBps) || input.thresholdBps < MIN_THRESHOLD_BPS || input.thresholdBps > MAX_THRESHOLD_BPS) {
    throw new Error("آستانهٔ تغییر باید بین 0.1 تا 100 درصد باشد.");
  }
  if (input.targetEnabled && (!input.targetPriceUsd || !Number.isFinite(input.targetPriceUsd) || input.targetPriceUsd <= 0)) {
    throw new Error("برای هشدار هدف، قیمت USD معتبر وارد کنید.");
  }
  const db = await getDb();
  if (!db) throw new Error("اتصال پایگاه‌داده در دسترس نیست.");
  const existing = (await db.select().from(xtrRateAlerts).where(eq(xtrRateAlerts.telegramUserId, telegramUserId)).limit(1))[0];
  const taskUid = await syncHeartbeat(telegramUserId, input.enabled, input.intervalMinutes, existing?.scheduleCronTaskUid ?? null);
  const update = {
    enabled: input.enabled,
    intervalMinutes: input.intervalMinutes,
    thresholdBps: input.thresholdBps,
    targetEnabled: input.targetEnabled,
    targetPriceUsd: input.targetEnabled && input.targetPriceUsd ? String(input.targetPriceUsd) : null,
    targetDirection: input.targetDirection,
    privateDeliveryEnabled: input.privateDeliveryEnabled,
    scheduleCronTaskUid: taskUid,
    updatedAt: new Date(),
  };
  await db.insert(xtrRateAlerts).values({ telegramUserId, ...update }).onDuplicateKeyUpdate({ set: update });
  return getXtrRateAlertSettings(telegramUserId);
}

export async function listXtrRateAlertHistory(telegramUserId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(xtrRateAlertHistory)
    .where(eq(xtrRateAlertHistory.telegramUserId, telegramUserId))
    .orderBy(desc(xtrRateAlertHistory.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

function hasTargetCrossed(alert: typeof xtrRateAlerts.$inferSelect, previousUsd: number | null, currentUsd: number) {
  const target = asPrice(alert.targetPriceUsd);
  if (!alert.targetEnabled || !target || previousUsd === null) return false;
  return alert.targetDirection === "below"
    ? previousUsd > target && currentUsd <= target
    : previousUsd < target && currentUsd >= target;
}

async function deliverPrivateXtrAlert(telegramUserId: number, enabled: boolean, title: string, body: string): Promise<boolean> {
  if (!enabled) return false;
  const telegram = getTelegramBot()?.telegram;
  if (!telegram) return false;
  return withTelegramRetry(() => telegram.sendMessage(telegramUserId, `${title}\n\n${body}`)).then(() => true).catch(() => false);
}

async function recordXtrAlertHistory(input: {
  alert: typeof xtrRateAlerts.$inferSelect;
  triggerType: "change" | "target_above" | "target_below";
  priceUsd: number;
  priceToman: number;
  previousUsd: number | null;
  changeBps: number | null;
  privateDelivered: boolean;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(xtrRateAlertHistory).values({
    telegramUserId: input.alert.telegramUserId,
    alertId: input.alert.id,
    triggerType: input.triggerType,
    priceUsd: String(input.priceUsd),
    priceToman: String(input.priceToman),
    previousUsd: input.previousUsd === null ? null : String(input.previousUsd),
    targetPriceUsd: input.alert.targetEnabled ? input.alert.targetPriceUsd : null,
    changeBps: input.changeBps,
    source: "fragment",
    privateDeliveryRequested: input.alert.privateDeliveryEnabled,
    privateDelivered: input.privateDelivered,
  });
}

export async function runXtrRateAlert(taskUid: string) {
  // The public market surface no longer offers price alerts. Keep this callback as a
  // harmless compatibility endpoint for previously-issued Heartbeat task UIDs.
  if (areMarketAlertsRetired()) return { skipped: "market_alerts_retired" as const, taskUid };

  const db = await getDb();
  if (!db) throw new Error("Database unavailable for XTR rate alert");
  const alert = (await db.select().from(xtrRateAlerts).where(eq(xtrRateAlerts.scheduleCronTaskUid, taskUid)).limit(1))[0];
  if (!alert) return { skipped: "orphan_or_unrecognized_task" as const };
  if (!alert.enabled) return { skipped: "alert_disabled" as const };

  const now = new Date();
  const market = await getStarsReferenceMarketData(now.getTime());
  const previousUsd = asPrice(alert.lastObservedUsd);
  const changeBps = previousUsd ? Math.round(((market.starUsdReference - previousUsd) / previousUsd) * 10_000) : null;
  const next = { lastObservedUsd: String(market.starUsdReference), lastCheckedAt: now, updatedAt: now };

  const targetCrossed = hasTargetCrossed(alert, previousUsd, market.starUsdReference);
  const rateChangeTriggered = changeBps !== null && Math.abs(changeBps) >= alert.thresholdBps;
  if (!targetCrossed && !rateChangeTriggered) {
    await db.update(xtrRateAlerts).set(next).where(eq(xtrRateAlerts.id, alert.id));
    return { triggered: false, priceUsd: market.starUsdReference, changeBps };
  }

  const triggerType = targetCrossed ? (alert.targetDirection === "below" ? "target_below" : "target_above") : "change";
  const target = asPrice(alert.targetPriceUsd);
  const direction = changeBps && changeBps > 0 ? "افزایش" : "کاهش";
  const changePercent = changeBps === null ? null : Math.abs(changeBps) / 100;
  const title = targetCrossed
    ? `هشدار XTR | عبور ${alert.targetDirection === "below" ? "رو به پایین" : "رو به بالا"} از قیمت هدف`
    : `هشدار XTR | ${direction} ${changePercent!.toFixed(2)}%`;
  const body = targetCrossed
    ? `منبع | Fragment\nهدف | $${formatUsd(target!)}\nقیمت فعلی | $${formatUsd(market.starUsdReference)} | ${formatToman(market.starTomanReference)} تومان\nیادآوری | نرخ مرجع بازار است و قیمت تضمینی نیست.`
    : `منبع | Fragment\nتغییر | ${changePercent!.toFixed(2)}% ${direction}\nقیمت فعلی | $${formatUsd(market.starUsdReference)} | ${formatToman(market.starTomanReference)} تومان\nیادآوری | نرخ مرجع بازار است و قیمت تضمینی نیست.`;
  await createUserNotification({ telegramUserId: alert.telegramUserId, eventType: targetCrossed ? "market.xtr_target_crossed" : "market.xtr_rate_change", title, body, relatedRole: "system" });
  const privateDelivered = await deliverPrivateXtrAlert(alert.telegramUserId, alert.privateDeliveryEnabled, title, body);
  await recordXtrAlertHistory({ alert, triggerType, priceUsd: market.starUsdReference, priceToman: market.starTomanReference, previousUsd, changeBps, privateDelivered });
  await db.update(xtrRateAlerts).set({ ...next, lastAlertedAt: now }).where(eq(xtrRateAlerts.id, alert.id));
  return { triggered: true, triggerType, priceUsd: market.starUsdReference, changeBps, privateDelivered };
}

export function resetXtrRateAlertsForTests() {}
