import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ getDb: vi.fn() }));

import { getDb } from "./db";
import { setKronosMemberTitle } from "./telegram/repository";
import { DASHBOARD_LOCALES } from "../client/src/lib/dashboardI18n";
import { dashboardNotificationCopy } from "../client/src/lib/dashboardNotificationI18n";

describe("notification and member-title iteration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps every notification control localized for all supported locales", () => {
    for (const locale of DASHBOARD_LOCALES) {
      const copy = dashboardNotificationCopy(locale);
      expect(copy.nav).toBeTruthy();
      expect(copy.unreadCount("3")).toBeTruthy();
      expect(copy.groupFilter).toBeTruthy();
      expect(copy.eventFilter).toBeTruthy();
      expect(copy.filterReset).toBeTruthy();
      expect(copy.markedRead).toBeTruthy();
      expect(copy.markedAllRead).toBeTruthy();
      expect(copy.unknownGroup).toBeTruthy();
    }
  });

  it("stores a Kronos title for any known group member", async () => {
    const where = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    vi.mocked(getDb).mockResolvedValue({ update } as never);

    await expect(setKronosMemberTitle({ groupId: 9, telegramUserId: 837, title: "همراه" })).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith({ kronosTitle: "همراه" });
  });
});


describe("dashboard notification source contract", () => {
  it("contains unread badge, read-action loading, filters, and category presentation", async () => {
    const source = await import("node:fs/promises").then(fs => fs.readFile("client/src/pages/OwnerDashboard.tsx", "utf8"));
    expect(source).toContain("notifications.unreadCount.useQuery");
    expect(source).toContain("relatedGroupId");
    expect(source).toContain("eventType");
    expect(source).toContain("markAll.isPending");
    expect(source).toContain("markRead.isPending");
    expect(source).toContain("item.relatedGroup?.title");
    expect(source).toContain("notificationPresentation");
    expect(source).toContain("EventIcon");
  });
});


describe("administrator title fallback contract", () => {
  it("keeps the mobile-safe animated shell styling contract", async () => {
    const source = await import("node:fs/promises").then(fs => fs.readFile("client/src/index.css", "utf8"));
    expect(source).toContain(".kronos-shell::before");
    expect(source).toContain(".kronos-content-stage");
    expect(source).toContain("prefers-reduced-motion: reduce");
  });

  it("keeps the native Telegram member-tag path for regular members while retaining the valid admin-title branch", async () => {
    const source = await import("node:fs/promises").then(fs => fs.readFile("server/telegram/administratorTitles.ts", "utf8"));
    expect(source).toContain("setChatMemberTag");
    expect(source).toContain("setKronosMemberTitle");
    expect(source).toContain('source: "telegram_member_tag"');
    expect(source).toContain('source: "kronos_member_title"');
  });
});
