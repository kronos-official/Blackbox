import type { Express, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { projectSchedules } from "../../drizzle/schema";
import { getDb } from "../db";
import { sdk } from "../_core/sdk";
import { alertOwner } from "./alerts";
import { getTelegramBot } from "./bot";
import { reconcileForcedJoinExpiry } from "./forcedJoin";
import { runXtrRateAlert } from "../market/xtrRateAlerts";
import { runCryptoMarketAlerts } from "../market/cryptoMarketAlerts";
import { reconcileBotMaintenance, reconcileExpiredRaidMode, reconcileOutboundMessageAutoDeletion, reconcileTemporaryPunishments } from "./scheduledMaintenance";
import { deliverScheduledStatisticsReport } from "./statistics";

async function notifySchedulerFailure(title: string, error: unknown) {
  const telegram = getTelegramBot()?.telegram;
  if (!telegram) return;
  try {
    await alertOwner(telegram, {
      alertType: "scheduler_failure",
      severity: "critical",
      title,
      body: `یک عملیات زمان‌بندی‌شدهٔ Kronos Guard ناموفق بود. جزئیات: ${error instanceof Error ? error.message.slice(0, 400) : "خطای ناشناخته"}`,
      dedupeKey: `scheduler-failure:${title}:${new Date().toISOString().slice(0, 13)}`,
    });
  } catch (notificationError) {
    console.error("[Kronos Guard] scheduler failure alert could not be delivered", notificationError);
  }
}

export function registerTelegramScheduledRoutes(app: Express) {
  app.post("/api/scheduled/forced-join-reconcile", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      const db = await getDb();
      if (!db) throw new Error("Database unavailable for scheduler authorization");
      const schedule = (await db.select().from(projectSchedules).where(and(eq(projectSchedules.scheduleKey, "forced_join_expiry"), eq(projectSchedules.scheduleCronTaskUid, user.taskUid))).limit(1))[0];
      if (!schedule) return res.json({ ok: true, skipped: "orphan_or_unrecognized_task" });
      if (!schedule.enabled) return res.json({ ok: true, skipped: "schedule_disabled" });
      const results = await Promise.allSettled([
        reconcileForcedJoinExpiry(),
        reconcileTemporaryPunishments(),
        reconcileExpiredRaidMode(),
        reconcileBotMaintenance(),
      ]);
      const [forcedJoin, temporaryPunishments, raidMode, maintenance] = results;
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      return res.json({
        ok: true,
        taskUid: user.taskUid,
        forcedJoin: forcedJoin.status === "fulfilled" ? forcedJoin.value : undefined,
        temporaryPunishments: temporaryPunishments.status === "fulfilled" ? temporaryPunishments.value : undefined,
        raidMode: raidMode.status === "fulfilled" ? raidMode.value : undefined,
        maintenance: maintenance.status === "fulfilled" ? maintenance.value : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Kronos Guard] forced-join scheduler callback failed", { message, path: req.path, taskUid: req.body?.taskUid ?? null });
      await notifySchedulerFailure("خطای زمان‌بند نگهداری ربات", error);
      return res.status(500).json({ error: "scheduler_unavailable", context: { path: req.path }, timestamp: new Date().toISOString() });
    }
  });

  app.post("/api/scheduled/statistics-report", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      const telegram = getTelegramBot()?.telegram;
      if (!telegram) throw new Error("Telegram bot runtime is unavailable for scheduled statistics delivery");
      const delivery = await deliverScheduledStatisticsReport(user.taskUid, telegram);
      return res.json({ ok: true, taskUid: user.taskUid, delivery });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const telegram = getTelegramBot()?.telegram;
      if (telegram) {
        await alertOwner(telegram, {
          alertType: "scheduler_failure",
          severity: "critical",
          title: "خطای زمان‌بند آمار",
          body: "ارسال خودکار گزارش آماری ناموفق بود. وضعیت زمان‌بند و دسترسی ربات به گروه را بررسی کنید.",
          dedupeKey: `statistics-scheduler-${new Date().toISOString().slice(0, 13)}`,
        });
      }
      return res.status(500).json({ error: message, context: { path: req.path }, timestamp: new Date().toISOString() });
    }
  });

  app.post("/api/scheduled/outbound-message-auto-delete", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      const db = await getDb();
      if (!db) throw new Error("Database unavailable for scheduler authorization");
      const schedule = (await db.select().from(projectSchedules).where(and(eq(projectSchedules.scheduleKey, "outbound_message_auto_delete"), eq(projectSchedules.scheduleCronTaskUid, user.taskUid))).limit(1))[0];
      if (!schedule) return res.json({ ok: true, skipped: "orphan_or_unrecognized_task" });
      if (!schedule.enabled) return res.json({ ok: true, skipped: "schedule_disabled" });
      const result = await reconcileOutboundMessageAutoDeletion();
      return res.json({ ok: true, taskUid: user.taskUid, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Kronos Guard] outbound-message auto-delete scheduler callback failed", { message, path: req.path, taskUid: req.body?.taskUid ?? null });
      await notifySchedulerFailure("خطای زمان‌بند حذف خودکار پیام", error);
      return res.status(500).json({ error: "scheduler_unavailable", context: { path: req.path }, timestamp: new Date().toISOString() });
    }
  });

  app.post("/api/scheduled/xtr-rate-alert", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      const result = await runXtrRateAlert(user.taskUid);
      return res.json({ ok: true, taskUid: user.taskUid, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Kronos Guard] XTR rate alert scheduler callback failed", { message, path: req.path, taskUid: req.body?.taskUid ?? null });
      await notifySchedulerFailure("خطای زمان‌بند هشدار XTR", error);
      return res.status(500).json({ error: "scheduler_unavailable", context: { path: req.path }, timestamp: new Date().toISOString() });
    }
  });

  app.post("/api/scheduled/crypto-market-alerts", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      const result = await runCryptoMarketAlerts(user.taskUid);
      return res.json({ ok: true, taskUid: user.taskUid, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Kronos Guard] crypto market alert scheduler callback failed", { message, path: req.path, taskUid: req.body?.taskUid ?? null });
      await notifySchedulerFailure("خطای زمان‌بند هشدار بازار", error);
      return res.status(500).json({ error: "scheduler_unavailable", context: { path: req.path }, timestamp: new Date().toISOString() });
    }
  });
}
