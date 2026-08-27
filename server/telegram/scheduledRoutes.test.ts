import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("./forcedJoin", () => ({ reconcileForcedJoinExpiry: vi.fn() }));
vi.mock("./scheduledMaintenance", () => ({ reconcileTemporaryPunishments: vi.fn(), reconcileBotMaintenance: vi.fn(), reconcileExpiredRaidMode: vi.fn(), reconcileOutboundMessageAutoDeletion: vi.fn() }));
vi.mock("./alerts", () => ({ alertOwner: vi.fn() }));
vi.mock("./bot", () => ({ getTelegramBot: vi.fn() }));
vi.mock("./statistics", () => ({ deliverScheduledStatisticsReport: vi.fn() }));
vi.mock("../market/xtrRateAlerts", () => ({ runXtrRateAlert: vi.fn() }));
vi.mock("../market/cryptoMarketAlerts", () => ({ runCryptoMarketAlerts: vi.fn() }));

import { getDb } from "../db";
import { sdk } from "../_core/sdk";
import { reconcileForcedJoinExpiry } from "./forcedJoin";
import { reconcileBotMaintenance, reconcileExpiredRaidMode, reconcileOutboundMessageAutoDeletion, reconcileTemporaryPunishments } from "./scheduledMaintenance";
import { getTelegramBot } from "./bot";
import { alertOwner } from "./alerts";
import { registerTelegramScheduledRoutes } from "./scheduledRoutes";
import { deliverScheduledStatisticsReport } from "./statistics";
import { runXtrRateAlert } from "../market/xtrRateAlerts";
import { runCryptoMarketAlerts } from "../market/cryptoMarketAlerts";

function selectResult(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  return { select: vi.fn().mockReturnValue({ from }) };
}

function routeHandler(path = "/api/scheduled/forced-join-reconcile") {
  const app = express();
  registerTelegramScheduledRoutes(app);
  const layer = (app as any)._router.stack.find((entry: any) => entry.route?.path === path);
  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

function responseRecorder() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe("forced-join Heartbeat callback authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips an authenticated cron caller whose task UID is not stored for this project schedule", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({ isCron: true, taskUid: "cron-unknown" } as any);
    vi.mocked(getDb).mockResolvedValue(selectResult([]) as never);
    const res = responseRecorder();
    await routeHandler()({ path: "/api/scheduled/forced-join-reconcile" }, res);
    expect(res.json).toHaveBeenCalledWith({ ok: true, skipped: "orphan_or_unrecognized_task" });
    expect(reconcileForcedJoinExpiry).not.toHaveBeenCalled();
  });

  it("skips a stored task when the owner has disabled that schedule", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({ isCron: true, taskUid: "cron-disabled" } as any);
    vi.mocked(getDb).mockResolvedValue(selectResult([{ enabled: false }]) as never);
    const res = responseRecorder();
    await routeHandler()({ path: "/api/scheduled/forced-join-reconcile" }, res);
    expect(res.json).toHaveBeenCalledWith({ ok: true, skipped: "schedule_disabled" });
    expect(reconcileForcedJoinExpiry).not.toHaveBeenCalled();
  });

  it("runs forced-join, temporary-punishment, raid-reset, and maintenance reconciliation only for the stored enabled task", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({ isCron: true, taskUid: "cron-active" } as any);
    vi.mocked(getDb).mockResolvedValue(selectResult([{ enabled: true }]) as never);
    vi.mocked(reconcileForcedJoinExpiry).mockResolvedValue({ skipped: false, expired: 1 } as never);
    vi.mocked(reconcileTemporaryPunishments).mockResolvedValue({ skipped: false, unmuted: 2 } as never);
    vi.mocked(reconcileExpiredRaidMode).mockResolvedValue({ skipped: false, reset: 1 } as never);
    vi.mocked(reconcileBotMaintenance).mockResolvedValue({ skipped: false, deletedWebhookEvents: 3, deletedCompletedJobs: 4 } as never);
    const res = responseRecorder();
    await routeHandler()({ path: "/api/scheduled/forced-join-reconcile" }, res);
    expect(reconcileForcedJoinExpiry).toHaveBeenCalledTimes(1);
    expect(reconcileTemporaryPunishments).toHaveBeenCalledTimes(1);
    expect(reconcileExpiredRaidMode).toHaveBeenCalledTimes(1);
    expect(reconcileBotMaintenance).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, taskUid: "cron-active", temporaryPunishments: { skipped: false, unmuted: 2 }, raidMode: { skipped: false, reset: 1 } }));
  });

  it("notifies the owner when the protected maintenance callback fails", async () => {
    const telegram = { sendMessage: vi.fn() };
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({ isCron: true, taskUid: "cron-active" } as any);
    vi.mocked(getDb).mockResolvedValue(selectResult([{ enabled: true }]) as never);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram } as any);
    vi.mocked(reconcileForcedJoinExpiry).mockRejectedValue(new Error("forced-join test failure"));
    vi.mocked(reconcileTemporaryPunishments).mockResolvedValue({ skipped: false, unmuted: 0 } as never);
    vi.mocked(reconcileExpiredRaidMode).mockResolvedValue({ skipped: false, reset: 0 } as never);
    vi.mocked(reconcileBotMaintenance).mockResolvedValue({ skipped: false, deletedWebhookEvents: 0, deletedCompletedJobs: 0 } as never);
    const res = responseRecorder();

    await routeHandler()({ path: "/api/scheduled/forced-join-reconcile", body: {} }, res);

    expect(alertOwner).toHaveBeenCalledWith(telegram, expect.objectContaining({ alertType: "scheduler_failure", severity: "critical", title: "خطای زمان‌بند نگهداری ربات" }));
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("statistics-report Heartbeat callback authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects callers that are not trusted cron tasks", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({ isCron: false } as any);
    const res = responseRecorder();
    await routeHandler("/api/scheduled/statistics-report")({ path: "/api/scheduled/statistics-report" }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "cron-only" });
    expect(deliverScheduledStatisticsReport).not.toHaveBeenCalled();
  });

  it("passes only the authenticated task UID to the report delivery service", async () => {
    const telegram = { sendMessage: vi.fn() };
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({ isCron: true, taskUid: "statistics-active" } as any);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram } as any);
    vi.mocked(deliverScheduledStatisticsReport).mockResolvedValue({ ok: true, status: "sent", groupId: 19, reportDate: "2026-08-19", messageId: 721 } as never);
    const res = responseRecorder();
    await routeHandler("/api/scheduled/statistics-report")({ path: "/api/scheduled/statistics-report", body: { groupId: 999999 } }, res);
    expect(deliverScheduledStatisticsReport).toHaveBeenCalledWith("statistics-active", telegram);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, taskUid: "statistics-active", delivery: expect.objectContaining({ status: "sent", groupId: 19 }) }));
  });

  it("returns the idempotent skip produced by the delivery ledger without retrying a message", async () => {
    const telegram = { sendMessage: vi.fn() };
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({ isCron: true, taskUid: "statistics-duplicate" } as any);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram } as any);
    vi.mocked(deliverScheduledStatisticsReport).mockResolvedValue({ ok: true, status: "skipped", groupId: 19, reportDate: "2026-08-19", skipped: "already_processed" } as never);
    const res = responseRecorder();
    await routeHandler("/api/scheduled/statistics-report")({ path: "/api/scheduled/statistics-report" }, res);
    expect(deliverScheduledStatisticsReport).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ delivery: expect.objectContaining({ skipped: "already_processed" }) }));
  });

  it("notifies the owner when scheduled statistics delivery fails", async () => {
    const telegram = { sendMessage: vi.fn() };
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({ isCron: true, taskUid: "statistics-active" } as any);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram } as any);
    vi.mocked(deliverScheduledStatisticsReport).mockRejectedValue(new Error("statistics test failure"));
    const res = responseRecorder();

    await routeHandler("/api/scheduled/statistics-report")({ path: "/api/scheduled/statistics-report", body: {} }, res);

    expect(alertOwner).toHaveBeenCalledWith(telegram, expect.objectContaining({ alertType: "scheduler_failure", title: "خطای زمان‌بند آمار" }));
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("outbound-message auto-delete Heartbeat callback authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects callers that are not trusted cron tasks", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({ isCron: false } as any);
    const res = responseRecorder();
    await routeHandler("/api/scheduled/outbound-message-auto-delete")({ path: "/api/scheduled/outbound-message-auto-delete" }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "cron-only" });
    expect(reconcileOutboundMessageAutoDeletion).not.toHaveBeenCalled();
  });

  it("skips an authenticated task that is not the persisted auto-delete schedule", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({ isCron: true, taskUid: "unrecognized-auto-delete" } as any);
    vi.mocked(getDb).mockResolvedValue(selectResult([]) as never);
    const res = responseRecorder();
    await routeHandler("/api/scheduled/outbound-message-auto-delete")({ path: "/api/scheduled/outbound-message-auto-delete" }, res);
    expect(res.json).toHaveBeenCalledWith({ ok: true, skipped: "orphan_or_unrecognized_task" });
    expect(reconcileOutboundMessageAutoDeletion).not.toHaveBeenCalled();
  });

  it("runs deletion only for the stored enabled task and returns its precise result", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({ isCron: true, taskUid: "auto-delete-active" } as any);
    vi.mocked(getDb).mockResolvedValue(selectResult([{ enabled: true }]) as never);
    vi.mocked(reconcileOutboundMessageAutoDeletion).mockResolvedValue({ due: 3, deleted: 2, retired: 1, retrying: 0 } as never);
    const res = responseRecorder();
    await routeHandler("/api/scheduled/outbound-message-auto-delete")({ path: "/api/scheduled/outbound-message-auto-delete" }, res);
    expect(reconcileOutboundMessageAutoDeletion).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ ok: true, taskUid: "auto-delete-active", result: { due: 3, deleted: 2, retired: 1, retrying: 0 } });
  });

  it("notifies the owner when auto-delete scheduling becomes degraded", async () => {
    const telegram = { sendMessage: vi.fn() };
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({ isCron: true, taskUid: "auto-delete-active" } as any);
    vi.mocked(getDb).mockResolvedValue(selectResult([{ enabled: true }]) as never);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram } as any);
    vi.mocked(reconcileOutboundMessageAutoDeletion).mockRejectedValue(new Error("auto-delete test failure"));
    const res = responseRecorder();

    await routeHandler("/api/scheduled/outbound-message-auto-delete")({ path: "/api/scheduled/outbound-message-auto-delete", body: {} }, res);

    expect(alertOwner).toHaveBeenCalledWith(telegram, expect.objectContaining({ alertType: "scheduler_failure", severity: "critical", title: "خطای زمان‌بند حذف خودکار پیام" }));
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("crypto-market alert Heartbeat callback authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects callers that are not trusted cron tasks", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({ isCron: false } as any);
    const res = responseRecorder();
    await routeHandler("/api/scheduled/crypto-market-alerts")({ path: "/api/scheduled/crypto-market-alerts" }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "cron-only" });
    expect(runCryptoMarketAlerts).not.toHaveBeenCalled();
  });

  it("passes only the authenticated schedule task UID to the idempotent market-alert scanner", async () => {
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({ isCron: true, taskUid: "market-alert-active" } as any);
    vi.mocked(runCryptoMarketAlerts).mockResolvedValue({ checked: 2, triggered: 1, skipped: 0, results: [] } as never);
    const res = responseRecorder();
    await routeHandler("/api/scheduled/crypto-market-alerts")({ path: "/api/scheduled/crypto-market-alerts", body: { taskUid: "forged-task" } }, res);
    expect(runCryptoMarketAlerts).toHaveBeenCalledWith("market-alert-active");
    expect(res.json).toHaveBeenCalledWith({ ok: true, taskUid: "market-alert-active", result: { checked: 2, triggered: 1, skipped: 0, results: [] } });
  });

  it("notifies the owner when market-alert scheduling fails", async () => {
    const telegram = { sendMessage: vi.fn() };
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({ isCron: true, taskUid: "market-alert-active" } as any);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram } as any);
    vi.mocked(runCryptoMarketAlerts).mockRejectedValue(new Error("market alert test failure"));
    const res = responseRecorder();

    await routeHandler("/api/scheduled/crypto-market-alerts")({ path: "/api/scheduled/crypto-market-alerts", body: {} }, res);

    expect(alertOwner).toHaveBeenCalledWith(telegram, expect.objectContaining({ alertType: "scheduler_failure", title: "خطای زمان‌بند هشدار بازار" }));
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("XTR rate-alert Heartbeat callback authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("notifies the owner when XTR rate-alert scheduling fails", async () => {
    const telegram = { sendMessage: vi.fn() };
    vi.spyOn(sdk, "authenticateRequest").mockResolvedValue({ isCron: true, taskUid: "xtr-alert-active" } as any);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram } as any);
    vi.mocked(runXtrRateAlert).mockRejectedValue(new Error("xtr alert test failure"));
    const res = responseRecorder();

    await routeHandler("/api/scheduled/xtr-rate-alert")({ path: "/api/scheduled/xtr-rate-alert", body: {} }, res);

    expect(alertOwner).toHaveBeenCalledWith(telegram, expect.objectContaining({ alertType: "scheduler_failure", title: "خطای زمان‌بند هشدار XTR" }));
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
