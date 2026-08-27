import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  new URL("../../client/src/pages/OwnerDashboard.tsx", import.meta.url),
  "utf8",
);

describe("Mini App notification read and mute controls", () => {
  it("keeps the bulk-read action visible, scoped to visible unread notifications, and feedback-backed", () => {
    expect(dashboardSource).toContain("trpc.dashboard.notifications.markAllRead.useMutation");
    expect(dashboardSource).toContain("result.count > 0 ? `${result.count} اعلان خوانده شد.` : copy.markedAllRead");
    expect(dashboardSource).toContain("!visibleItems.some(item => !item.isRead)");
  });

  it("loads and optimistically persists per-category mute settings", () => {
    expect(dashboardSource).toContain("trpc.dashboard.notifications.getMutes.useQuery");
    expect(dashboardSource).toContain("trpc.dashboard.notifications.updateMutes.useMutation");
    expect(dashboardSource).toContain("utils.dashboard.notifications.getMutes.setData(undefined, { mutedCategories })");
    expect(dashboardSource).toContain("notificationMuteCategories.map(item => item.id).filter(item => next.has(item))");
  });

  it("preserves preference controls while excluding muted categories from the rendered feed", () => {
    expect(dashboardSource).toContain("const visibleItems = items.filter");
    expect(dashboardSource).toContain("groupSimilarNotifications(visibleItems)");
    expect(dashboardSource).toContain("دسته‌های بی‌صدا در فید شما پنهان می‌شوند؛ این کنترل‌ها همیشه در دسترس می‌مانند.");
    expect(dashboardSource).toContain("notificationMuteCategories.map(category =>");
  });
});
