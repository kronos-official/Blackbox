import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));

import { getDb } from "../db";
import { createOwnerAlertRecord, setTelegramGroupStatus } from "./repository";

describe("owner-alert persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses a non-empty harmless duplicate update so recurring alert deduplication never throws", async () => {
    const onDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onDuplicateKeyUpdate });
    const limit = vi.fn().mockResolvedValue([{ id: 7, status: "sent" }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    vi.mocked(getDb).mockResolvedValue({
      insert: vi.fn().mockReturnValue({ values }),
      select: vi.fn().mockReturnValue({ from }),
    } as never);

    await expect(createOwnerAlertRecord({
      alertType: "scheduler_failure",
      severity: "critical",
      title: "Scheduler error",
      body: "Callback failed",
      dedupeKey: "scheduler-2026-08-14T02",
    })).resolves.toEqual({ id: 7, status: "sent" });

    expect(onDuplicateKeyUpdate).toHaveBeenCalledWith({ set: expect.objectContaining({ dedupeKey: expect.anything() }) });
  });

  it("persists bot removal or permission loss so the group can be excluded from dashboard lists", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    vi.mocked(getDb).mockResolvedValue({ update } as never);

    await setTelegramGroupStatus(-100700, "removed");

    expect(update).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({ status: "removed" });
    expect(where).toHaveBeenCalledOnce();
  });
});
