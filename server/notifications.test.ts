import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));

import { getDb } from "./db";
import { createUserNotification, getUserNotificationMutes, listUserNotifications, markAllUserNotificationsRead, markUserNotificationRead, normalizeUserNotificationMutes, setUserNotificationMutes } from "./notifications";

describe("user notification helpers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a scoped notification for the target Telegram user", async () => {
    const returningId = vi.fn().mockResolvedValue([{ id: 42 }]);
    const values = vi.fn().mockReturnValue({ $returningId: returningId });
    vi.mocked(getDb).mockResolvedValue({ insert: vi.fn().mockReturnValue({ values }) } as never);

    await expect(createUserNotification({ telegramUserId: 837, eventType: "role_changed", title: "تغییر مقام", body: "مقام شما تغییر کرد.", relatedGroupId: 7, relatedRole: "moderator" })).resolves.toBe(42);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ telegramUserId: 837, eventType: "role_changed", relatedGroupId: 7, relatedRole: "moderator" }));
  });

  it("lists notifications through the bounded query chain", async () => {
    const rows = [{ id: 1, telegramUserId: 837, isRead: false }];
    const limit = vi.fn().mockResolvedValue(rows);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn().mockReturnValue({ from }) } as never);

    await expect(listUserNotifications(837, 999)).resolves.toEqual(rows);
    expect(limit).toHaveBeenCalledWith(100);
  });

  it("keeps an actor-owned read-only activity record visible in the Mini App feed", async () => {
    const rows = [{ id: 77, telegramUserId: 837, eventType: "role.title_changed", isRead: true, body: "↩️ مقدار پیشین: لقب قبلی\n➡️ مقدار جدید: لقب جدید" }];
    const limit = vi.fn().mockResolvedValue(rows);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn().mockReturnValue({ from }) } as never);

    await expect(listUserNotifications(837, 50, { eventType: "role.title_changed" })).resolves.toEqual(rows);
    expect(where).toHaveBeenCalledOnce();
  });

  it("normalizes user notification mutes to the supported categories in a stable order", () => {
    expect(normalizeUserNotificationMutes(["protection", "unknown", "membership", "protection", 99])).toEqual(["membership", "protection"]);
    expect(normalizeUserNotificationMutes(null)).toEqual([]);
  });

  it("reads and writes the current user's notification mute preferences", async () => {
    const limit = vi.fn().mockResolvedValue([{ notificationMutes: ["system", "membership", "invalid"] }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const onDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onDuplicateKeyUpdate });
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn().mockReturnValue({ from }), insert: vi.fn().mockReturnValue({ values }) } as never);

    await expect(getUserNotificationMutes(837)).resolves.toEqual(["membership", "system"]);
    await expect(setUserNotificationMutes(837, ["moderation", "invalid", "moderation"])).resolves.toEqual(["moderation"]);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ telegramUserId: 837, notificationMutes: ["moderation"] }));
    expect(onDuplicateKeyUpdate).toHaveBeenCalledWith(expect.objectContaining({ set: expect.objectContaining({ notificationMutes: ["moderation"], updatedAt: expect.any(Date) }) }));
  });

  it("includes muted categories in the scoped notification query so muted records are excluded", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn().mockReturnValue({ from }) } as never);

    await expect(listUserNotifications(837, 50, { mutedCategories: ["protection", "membership"] })).resolves.toEqual([]);
    expect(where).toHaveBeenCalledWith(expect.anything());
  });

  it("marks one notification or all unread notifications as read", async () => {
    const where = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    vi.mocked(getDb).mockResolvedValue({ update } as never);

    await expect(markUserNotificationRead(837, 42)).resolves.toBe(true);
    await expect(markAllUserNotificationsRead(837)).resolves.toBe(1);
    expect(update).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ isRead: true, readAt: expect.any(Date) }));
  });
});
