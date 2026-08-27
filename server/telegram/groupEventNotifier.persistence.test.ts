import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../notifications", () => ({ createUserNotification: vi.fn() }));
vi.mock("./groupEventPreferences", () => ({
  getGroupEventNotificationPreferences: vi.fn(),
}));

import { getDb } from "../db";
import { createUserNotification } from "../notifications";
import { getGroupEventNotificationPreferences } from "./groupEventPreferences";
import { notifyGroupEvent } from "./groupEventNotifier";

function selectQuery(rows: unknown[]) {
  const query = {
    where: () => query,
    limit: async () => rows,
    then: (resolve: (value: unknown[]) => unknown, reject: (reason?: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
  };
  return { from: () => query };
}

describe("group event notifier Mini App activity persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGroupEventNotificationPreferences).mockResolvedValue({
      privateDeliveryEnabled: true,
      protectionRecipientMode: "all_authorized",
      protectionCooldownSeconds: 60,
    });
  });

  it("persists the title-change actor's read-only activity record with before and after values", async () => {
    const select = vi.fn()
      .mockReturnValueOnce(selectQuery([{ title: "گروه آزمایشی", ownerTelegramId: 101 }]))
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(selectQuery([]))
      .mockReturnValueOnce(selectQuery([{ telegramUserId: 101, enabled: true }]));
    vi.mocked(getDb).mockResolvedValue({ select } as never);
    vi.mocked(createUserNotification).mockResolvedValue({ id: 77 } as never);

    const result = await notifyGroupEvent({
      groupId: 9,
      eventType: "role.title_changed",
      actor: { telegramUserId: 101, displayName: "مدیر گروه" },
      subject: { telegramUserId: 202, displayName: "عضو هدف" },
      details: { previousValue: "لقب قبلی", nextValue: "لقب جدید" },
      occurredAt: new Date("2026-08-20T06:32:03.000Z"),
      eventKey: "title-change:actor-feed:101:202",
      sendPrivateMessage: false,
      includeActorInDashboard: true,
    });

    expect(result.persistedRecipientIds).toContain(101);
    expect(createUserNotification).toHaveBeenCalledWith(expect.objectContaining({
      telegramUserId: 101,
      eventType: "role.title_changed",
      title: "تغییر لقب عضو",
      relatedGroupId: 9,
      relatedRole: "role",
      isRead: true,
      body: expect.stringContaining("<code>پیشین</code> │ لقب قبلی"),
    }));
    expect(vi.mocked(createUserNotification).mock.calls[0]?.[0]?.body).toContain("<code>جدید</code> │ لقب جدید");
  });
});
