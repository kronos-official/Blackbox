import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../_core/heartbeat", () => ({ createHeartbeatJob: vi.fn(), updateHeartbeatJob: vi.fn() }));

import { getDb } from "../db";
import { deliverScheduledStatisticsReport } from "./statistics";

function query(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
    then: promise.then.bind(promise),
  };
}

function fakeDb(results: unknown[][], insertResult: Promise<unknown> = Promise.resolve(undefined)) {
  const select = vi.fn(() => query(results.shift() ?? []));
  const values = vi.fn(() => insertResult);
  const where = vi.fn().mockResolvedValue(undefined);
  return { select, insert: vi.fn(() => ({ values })), update: vi.fn(() => ({ set: vi.fn(() => ({ where })) })) };
}

const activeSchedule = { groupId: 19, scheduleCronTaskUid: "statistics-19", frequency: "daily", enabled: true };

describe("scheduled statistics delivery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips an unknown task before it can target a group", async () => {
    vi.mocked(getDb).mockResolvedValue(fakeDb([[]]) as never);
    const telegram = { sendMessage: vi.fn() };
    await expect(deliverScheduledStatisticsReport("unknown-task", telegram)).resolves.toMatchObject({ status: "skipped", skipped: "orphan_or_unrecognized_task" });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("skips a disabled group schedule without constructing or sending a report", async () => {
    vi.mocked(getDb).mockResolvedValue(fakeDb([[{ ...activeSchedule, enabled: false }]]) as never);
    const telegram = { sendMessage: vi.fn() };
    await expect(deliverScheduledStatisticsReport("statistics-19", telegram)).resolves.toMatchObject({ status: "skipped", skipped: "schedule_disabled", groupId: 19 });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("uses the durable delivery key to prevent a duplicate send", async () => {
    vi.mocked(getDb).mockResolvedValue(fakeDb([[activeSchedule], [{ chatId: -10019, status: "active" }]], Promise.reject({ code: "ER_DUP_ENTRY" })) as never);
    const telegram = { sendMessage: vi.fn() };
    await expect(deliverScheduledStatisticsReport("statistics-19", telegram)).resolves.toMatchObject({ status: "skipped", skipped: "already_processed", groupId: 19 });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });

  it("sends the current report to the stored chat after reserving its delivery key", async () => {
    const db = fakeDb([[activeSchedule], [{ chatId: -10019, status: "active" }], [], [], [], []]);
    vi.mocked(getDb).mockResolvedValue(db as never);
    const telegram = { sendMessage: vi.fn().mockResolvedValue({ message_id: 721 }) };
    await expect(deliverScheduledStatisticsReport("statistics-19", telegram)).resolves.toMatchObject({ status: "sent", groupId: 19, messageId: 721 });
    expect(telegram.sendMessage).toHaveBeenCalledWith(-10019, expect.stringContaining("فعالیت های امروز"), { parse_mode: "HTML", disable_web_page_preview: true });
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});
