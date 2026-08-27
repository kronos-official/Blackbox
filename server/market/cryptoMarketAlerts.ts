import { and, asc, desc, eq } from "drizzle-orm";
import { cryptoMarketAlertHistory, cryptoMarketAlerts, cryptoMarketAlertSchedulers } from "../../drizzle/schema";
import { createHeartbeatJob, updateHeartbeatJob } from "../_core/heartbeat";
import { getDb } from "../db";
import { createUserNotification, getUserPrivateDelivery } from "../notifications";
import { getTelegramBot } from "../telegram/bot";
import { withTelegramRetry } from "../telegram/retry";
import { getCryptoMarketAsset } from "./cryptoMarket";

export const CRYPTO_MARKET_ALERT_INTERVALS = [1, 5, 15, 60] as const;
export type CryptoMarketAlertInterval = (typeof CRYPTO_MARKET_ALERT_INTERVALS)[number];
export const MAX_ENABLED_CRYPTO_MARKET_ALERTS = 12;

type AlertDirection = "above" | "below";

export type CryptoMarketAlertInput = {
  assetId: string;
  assetName: string;
  assetSymbol: string;
  enabled: boolean;
  intervalMinutes: CryptoMarketAlertInterval;
  targetPriceUsd: number;
  targetDirection: AlertDirection;
  privateDeliveryEnabled: boolean;
};

function isInterval(value: number): value is CryptoMarketAlertInterval {
  return (CRYPTO_MARKET_ALERT_INTERVALS as readonly number[]).includes(value);
}

function asPrice(value: string | null | undefined) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function toAlert(row: typeof cryptoMarketAlerts.$inferSelect) {
  return {
    id: row.id,
    assetId: row.assetId,
    assetName: row.assetName,
    assetSymbol: row.assetSymbol,
    enabled: row.enabled,
    intervalMinutes: isInterval(row.intervalMinutes) ? row.intervalMinutes : 15 as CryptoMarketAlertInterval,
    targetPriceUsd: asPrice(row.targetPriceUsd) ?? 0,
    targetDirection: row.targetDirection === "below" ? "below" as const : "above" as const,
    privateDeliveryEnabled: row.privateDeliveryEnabled,
    lastObservedUsd: asPrice(row.lastObservedUsd),
    lastCheckedAt: row.lastCheckedAt,
    lastAlertedAt: row.lastAlertedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function cronFor(intervalMinutes: CryptoMarketAlertInterval) {
  return `0 */${intervalMinutes} * * * *`;
}

function isDue(lastCheckedAt: Date | null, intervalMinutes: number, now: Date) {
  return !lastCheckedAt || now.getTime() - lastCheckedAt.getTime() >= intervalMinutes * 60_000 - 5_000;
}

function areMarketAlertsRetired() {
  return true;
}

async function syncUserScheduler(telegramUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("اتصال پایگاه‌داده در دسترس نیست.");
  const alerts = await db.select().from(cryptoMarketAlerts)
    .where(and(eq(cryptoMarketAlerts.telegramUserId, telegramUserId), eq(cryptoMarketAlerts.enabled, true)));
  const intervalMinutes = alerts.length
    ? Math.min(...alerts.map(alert => isInterval(alert.intervalMinutes) ? alert.intervalMinutes : 15)) as CryptoMarketAlertInterval
    : 15 as CryptoMarketAlertInterval;
  const existing = (await db.select().from(cryptoMarketAlertSchedulers).where(eq(cryptoMarketAlertSchedulers.telegramUserId, telegramUserId)).limit(1))[0];
  const enabled = alerts.length > 0;
  const patch = {
    cron: cronFor(intervalMinutes),
    path: "/api/scheduled/crypto-market-alerts",
    method: "POST" as const,
    payload: { telegramUserId },
    description: `Kronos Guard crypto market alerts for Telegram user ${telegramUserId}`,
    enable: enabled,
  };
  let taskUid = existing?.scheduleCronTaskUid ?? null;
  if (taskUid) {
    await updateHeartbeatJob(taskUid, patch, "");
  } else if (enabled) {
    taskUid = (await createHeartbeatJob({ name: `kronos:crypto-market-alerts:${telegramUserId}`, ...patch }, "")).taskUid;
  }
  const scheduler = { intervalMinutes, scheduleCronTaskUid: taskUid, enabled, updatedAt: new Date() };
  await db.insert(cryptoMarketAlertSchedulers).values({ telegramUserId, ...scheduler }).onDuplicateKeyUpdate({ set: scheduler });
  return { enabled, intervalMinutes, scheduleCronTaskUid: taskUid, activeAlerts: alerts.length };
}

export async function listCryptoMarketAlerts(telegramUserId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(cryptoMarketAlerts)
    .where(eq(cryptoMarketAlerts.telegramUserId, telegramUserId))
    .orderBy(asc(cryptoMarketAlerts.createdAt));
  return rows.map(toAlert);
}

export async function saveCryptoMarketAlert(telegramUserId: number, input: CryptoMarketAlertInput) {
  if (input.assetId.trim().toLowerCase() === "telegram-stars") throw new Error("هشدار Telegram Stars در بخش اختصاصی XTR مدیریت می‌شود.");
  if (!isInterval(input.intervalMinutes)) throw new Error("بازهٔ بررسی باید 1، 5، 15 یا 60 دقیقه باشد.");
  if (!Number.isFinite(input.targetPriceUsd) || input.targetPriceUsd <= 0) throw new Error("قیمت هدف USD معتبر وارد کنید.");
  const assetId = input.assetId.trim().toLowerCase();
  const assetName = input.assetName.trim().slice(0, 160);
  const assetSymbol = input.assetSymbol.trim().toUpperCase().slice(0, 32);
  if (!/^[a-z0-9-]{1,128}$/i.test(assetId) || !assetName || !assetSymbol) throw new Error("شناسه و مشخصات دارایی معتبر نیست.");
  const db = await getDb();
  if (!db) throw new Error("اتصال پایگاه‌داده در دسترس نیست.");
  const existing = (await db.select().from(cryptoMarketAlerts).where(and(eq(cryptoMarketAlerts.telegramUserId, telegramUserId), eq(cryptoMarketAlerts.assetId, assetId))).limit(1))[0];
  if (input.enabled && !existing?.enabled) {
    const enabledRows = await db.select({ id: cryptoMarketAlerts.id }).from(cryptoMarketAlerts)
      .where(and(eq(cryptoMarketAlerts.telegramUserId, telegramUserId), eq(cryptoMarketAlerts.enabled, true)));
    if (enabledRows.length >= MAX_ENABLED_CRYPTO_MARKET_ALERTS) throw new Error(`حداکثر ${MAX_ENABLED_CRYPTO_MARKET_ALERTS} هشدار فعال برای هر کاربر مجاز است.`);
  }
  const targetChanged = existing && (existing.targetPriceUsd !== String(input.targetPriceUsd) || existing.targetDirection !== input.targetDirection || existing.enabled !== input.enabled);
  const patch = {
    assetName,
    assetSymbol,
    enabled: input.enabled,
    intervalMinutes: input.intervalMinutes,
    targetPriceUsd: String(input.targetPriceUsd),
    targetDirection: input.targetDirection,
    privateDeliveryEnabled: input.privateDeliveryEnabled,
    lastObservedUsd: targetChanged ? null : existing?.lastObservedUsd ?? null,
    lastCheckedAt: targetChanged ? null : existing?.lastCheckedAt ?? null,
    updatedAt: new Date(),
  };
  await db.insert(cryptoMarketAlerts).values({ telegramUserId, assetId, ...patch }).onDuplicateKeyUpdate({ set: patch });
  const scheduler = await syncUserScheduler(telegramUserId);
  const row = (await db.select().from(cryptoMarketAlerts).where(and(eq(cryptoMarketAlerts.telegramUserId, telegramUserId), eq(cryptoMarketAlerts.assetId, assetId))).limit(1))[0];
  return { alert: row ? toAlert(row) : null, scheduler };
}

export async function removeCryptoMarketAlert(telegramUserId: number, assetId: string) {
  const db = await getDb();
  if (!db) throw new Error("اتصال پایگاه‌داده در دسترس نیست.");
  const normalized = assetId.trim().toLowerCase();
  const existing = (await db.select({ id: cryptoMarketAlerts.id }).from(cryptoMarketAlerts)
    .where(and(eq(cryptoMarketAlerts.telegramUserId, telegramUserId), eq(cryptoMarketAlerts.assetId, normalized))).limit(1))[0];
  if (!existing) return { removed: false, scheduler: await syncUserScheduler(telegramUserId) };
  await db.delete(cryptoMarketAlerts).where(eq(cryptoMarketAlerts.id, existing.id));
  return { removed: true, scheduler: await syncUserScheduler(telegramUserId) };
}

export async function listCryptoMarketAlertHistory(telegramUserId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(cryptoMarketAlertHistory)
    .where(eq(cryptoMarketAlertHistory.telegramUserId, telegramUserId))
    .orderBy(desc(cryptoMarketAlertHistory.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

function crossedTarget(alert: typeof cryptoMarketAlerts.$inferSelect, previousUsd: number | null, currentUsd: number) {
  const target = asPrice(alert.targetPriceUsd);
  if (!target || previousUsd === null) return false;
  return alert.targetDirection === "below" ? previousUsd > target && currentUsd <= target : previousUsd < target && currentUsd >= target;
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: value < 0.1 ? 6 : 4 }).format(value);
}

function formatToman(value: number | null) {
  return value === null ? "در دسترس نیست" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(value));
}

async function deliverPrivateAlert(telegramUserId: number, requested: boolean, title: string, body: string) {
  if (!requested || !(await getUserPrivateDelivery(telegramUserId))) return false;
  const telegram = getTelegramBot()?.telegram;
  if (!telegram) return false;
  return withTelegramRetry(() => telegram.sendMessage(telegramUserId, `${title}\n\n${body}`)).then(() => true).catch(() => false);
}

async function runOneAlert(alert: typeof cryptoMarketAlerts.$inferSelect, now: Date) {
  if (!isDue(alert.lastCheckedAt, alert.intervalMinutes, now)) return { alertId: alert.id, skipped: "not_due" as const };
  const db = await getDb();
  if (!db) throw new Error("Database unavailable for market alert");
  let quote: Awaited<ReturnType<typeof getCryptoMarketAsset>>;
  try {
    quote = await getCryptoMarketAsset(alert.assetId, now.getTime());
  } catch {
    await db.update(cryptoMarketAlerts).set({ lastCheckedAt: now, updatedAt: now }).where(eq(cryptoMarketAlerts.id, alert.id));
    return { alertId: alert.id, skipped: "quote_unavailable" as const };
  }
  if (quote.isStale) {
    await db.update(cryptoMarketAlerts).set({ lastCheckedAt: now, updatedAt: now }).where(eq(cryptoMarketAlerts.id, alert.id));
    return { alertId: alert.id, skipped: "stale_quote" as const };
  }
  const previousUsd = asPrice(alert.lastObservedUsd);
  const next = { lastObservedUsd: String(quote.data.priceUsd), lastCheckedAt: now, updatedAt: now };
  const triggered = crossedTarget(alert, previousUsd, quote.data.priceUsd);
  // Persist the observed point before delivery so duplicate scheduler invocations cannot notify twice.
  await db.update(cryptoMarketAlerts).set(triggered ? { ...next, lastAlertedAt: now } : next).where(eq(cryptoMarketAlerts.id, alert.id));
  if (!triggered) return { alertId: alert.id, triggered: false, priceUsd: quote.data.priceUsd };
  const triggerType = alert.targetDirection === "below" ? "target_below" as const : "target_above" as const;
  const target = asPrice(alert.targetPriceUsd)!;
  const direction = alert.targetDirection === "below" ? "رو به پایین" : "رو به بالا";
  const title = `هشدار ${alert.assetSymbol} | عبور ${direction} از قیمت هدف`;
  const body = `دارایی | ${alert.assetName} (${alert.assetSymbol})\nمنبع | ${quote.source}\nهدف | $${formatUsd(target)}\nقیمت فعلی | $${formatUsd(quote.data.priceUsd)} | ${formatToman(quote.data.priceToman)} تومان\nزمان منبع | ${new Date(quote.updatedAt).toLocaleString("en-US", { timeZone: "Asia/Tehran", hour12: false })}\nیادآوری | این هشدار فقط اطلاعات بازار است و توصیهٔ سرمایه‌گذاری نیست.`;
  await createUserNotification({ telegramUserId: alert.telegramUserId, eventType: "market.asset_target_crossed", title, body, relatedRole: "system" });
  const privateDelivered = await deliverPrivateAlert(alert.telegramUserId, alert.privateDeliveryEnabled, title, body);
  await db.insert(cryptoMarketAlertHistory).values({
    telegramUserId: alert.telegramUserId,
    alertId: alert.id,
    assetId: alert.assetId,
    assetName: alert.assetName,
    assetSymbol: alert.assetSymbol,
    triggerType,
    priceUsd: String(quote.data.priceUsd),
    priceToman: quote.data.priceToman === null ? null : String(quote.data.priceToman),
    previousUsd: previousUsd === null ? null : String(previousUsd),
    targetPriceUsd: alert.targetPriceUsd,
    source: quote.source,
    privateDeliveryRequested: alert.privateDeliveryEnabled,
    privateDelivered,
  });
  return { alertId: alert.id, triggered: true, triggerType, priceUsd: quote.data.priceUsd, privateDelivered };
}

export async function runCryptoMarketAlerts(taskUid: string) {
  // The market panel has been intentionally simplified to quotes and charts. Existing
  // scheduler callbacks must remain idempotent and must never deliver a new alert.
  if (areMarketAlertsRetired()) return { skipped: "market_alerts_retired" as const, taskUid };

  const db = await getDb();
  if (!db) throw new Error("Database unavailable for crypto market alerts");
  const scheduler = (await db.select().from(cryptoMarketAlertSchedulers).where(eq(cryptoMarketAlertSchedulers.scheduleCronTaskUid, taskUid)).limit(1))[0];
  if (!scheduler) return { skipped: "orphan_or_unrecognized_task" as const };
  if (!scheduler.enabled) return { skipped: "scheduler_disabled" as const };
  const alerts = await db.select().from(cryptoMarketAlerts)
    .where(and(eq(cryptoMarketAlerts.telegramUserId, scheduler.telegramUserId), eq(cryptoMarketAlerts.enabled, true)))
    .orderBy(asc(cryptoMarketAlerts.id));
  if (!alerts.length) return { skipped: "no_enabled_alerts" as const };
  const now = new Date();
  const results = [] as Array<Awaited<ReturnType<typeof runOneAlert>> | { alertId: number; skipped: "alert_failed" }>;
  for (const alert of alerts.slice(0, MAX_ENABLED_CRYPTO_MARKET_ALERTS)) {
    try { results.push(await runOneAlert(alert, now)); } catch (error) {
      console.warn("[Kronos Guard] crypto market alert run failed", { alertId: alert.id, message: error instanceof Error ? error.message : "unknown" });
      results.push({ alertId: alert.id, skipped: "alert_failed" });
    }
  }
  return { schedulerId: scheduler.id, checked: results.length, results };
}
