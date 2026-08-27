import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));

import { getDb } from "../db";
import { getGroupUserActivityStats, recordGroupMemberFlow, recordGroupUserActivity } from "./repository";

function mockInsertDb() {
  const onDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onDuplicateKeyUpdate });
  vi.mocked(getDb).mockResolvedValue({ insert: vi.fn().mockReturnValue({ values }) } as never);
  return { values, onDuplicateKeyUpdate };
}

describe("group activity persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists every requested media counter with the message activity row", async () => {
    const { values, onDuplicateKeyUpdate } = mockInsertDb();
    await recordGroupUserActivity({ groupId: 4, telegramUserId: 9, messages: 1, photos: 1, videos: 2, documents: 3, audios: 4, stickers: 5, voices: 6, at: new Date("2026-08-19T08:00:00.000Z") });

    expect(values.mock.calls[0]?.[0]).toMatchObject({
      groupId: 4,
      telegramUserId: 9,
      messageCount: 1,
      photoCount: 1,
      videoCount: 2,
      documentCount: 3,
      audioCount: 4,
      stickerCount: 5,
      voiceCount: 6,
    });
    expect(values).toHaveBeenCalledTimes(1);
    expect(onDuplicateKeyUpdate.mock.calls[0]?.[0]?.set).toMatchObject({
      photoCount: expect.anything(),
      videoCount: expect.anything(),
      documentCount: expect.anything(),
      audioCount: expect.anything(),
      stickerCount: expect.anything(),
      voiceCount: expect.anything(),
    });
  });

  it("persists observed joins and exits as daily group flow rather than estimating roster size", async () => {
    const { values, onDuplicateKeyUpdate } = mockInsertDb();
    await recordGroupMemberFlow({ groupId: 4, joined: 3, left: 1, at: new Date("2026-08-19T08:00:00.000Z") });

    expect(values.mock.calls[0]?.[0]).toMatchObject({ groupId: 4, joinedCount: 3, leftCount: 1 });
    expect(onDuplicateKeyUpdate.mock.calls[0]?.[0]?.set).toMatchObject({ joinedCount: expect.anything(), leftCount: expect.anything() });
  });

  it("loads activity totals only for the requested user, not the whole group", async () => {
    const targetRows = [
      { telegramUserId: 42, dayKey: "2026-08-20", messageCount: 4, addedMemberCount: 2 },
      { telegramUserId: 42, dayKey: "2026-08-19", messageCount: 3, addedMemberCount: 1 },
    ];
    const otherUserRows = { telegramUserId: 99, dayKey: "2026-08-20", messageCount: 900, addedMemberCount: 700 };
    const where = vi.fn(() => Promise.resolve(where.mock.calls.length === 1 ? targetRows : [...targetRows, otherUserRows]));
    const from = vi.fn().mockReturnValue({ where });
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn().mockReturnValue({ from }) } as never);

    const stats = await getGroupUserActivityStats({ groupId: 4, telegramUserId: 42, now: new Date("2026-08-20T12:00:00.000Z") });

    expect(stats.today).toEqual({ messages: 4, addedMembers: 2 });
    expect(stats.week).toEqual({ messages: 7, addedMembers: 3 });
    expect(stats.month).toEqual({ messages: 7, addedMembers: 3 });
    expect(stats.all).toEqual({ messages: 7, addedMembers: 3 });
    expect(stats.messageRank).toBe(2);
    expect(stats.addedMemberRank).toBe(2);
    expect("peakHours" in stats).toBe(false);
    expect("peakWeekdays" in stats).toBe(false);
    expect(where).toHaveBeenCalledTimes(2);
  });
});
