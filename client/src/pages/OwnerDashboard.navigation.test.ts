import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { USER_DASHBOARD_NAV_IDS } from "./OwnerDashboard";

const dashboardSource = readFileSync(resolve(__dirname, "OwnerDashboard.tsx"), "utf8");
const appSource = readFileSync(resolve(__dirname, "..", "App.tsx"), "utf8");

describe("user Mini App navigation", () => {
  it("exposes the essential user-facing sections including localized Help", () => {
    expect(USER_DASHBOARD_NAV_IDS).toEqual([
      "groups",
      "members",
      "moderation",
      "warningPolicy",
      "forced",
      "cryptoMarket",
      "notifications",
      "support",
      "help",
      "about",
    ]);
  });

  it("does not expose the owner-only command center overview", () => {
    expect((USER_DASHBOARD_NAV_IDS as readonly string[]).includes("overview")).toBe(false);
  });

  it("derives the crypto-market navigation label from the locale-aware market dictionary", () => {
    expect(dashboardSource).toContain("classicCryptoMarketCopyFor(locale).navLabel");
  });

  it("does not expose owner-only registry, payment, alert, settings, or audit sections", () => {
    const ownerOnlySections = ["registry", "payments", "alerts", "settings", "audit"];
    expect(ownerOnlySections.some(section => (USER_DASHBOARD_NAV_IDS as readonly string[]).includes(section))).toBe(false);
  });

  it("hands off from logo motion directly to the dashboard without a Skeleton transition", () => {
    expect(dashboardSource).not.toContain("DashboardContentSkeleton");
    expect(dashboardSource).not.toContain("showDashboardSkeleton");
    expect(dashboardSource).not.toContain("kronos-dashboard-skeleton");
  });

  it("keeps loading, error retry, and RTL brand safeguards in the dashboard source", () => {
    expect(dashboardSource).not.toContain("dashboardLoadingStages");
    expect(dashboardSource).not.toContain("kronos-dashboard-loading-status");
    expect(dashboardSource).toContain("DashboardDataError");
    expect(dashboardSource).toContain("unreadNotifications.refetch()");
    expect(dashboardSource).toContain("dir={direction}");
    expect(dashboardSource).toContain("dashboardDirection(locale)");
  });

  it("includes detailed Mini App help for staff controls and lock-policy rollback", () => {
    expect(dashboardSource).toContain("operations.staff.eyebrow");
    expect(dashboardSource).toContain("operations.staff.access");
    expect(dashboardSource).toContain("operations.policies.strictGuardText");
    expect(dashboardSource).toContain("operations.policies.restoreText");
  });

  it("keeps the owner audit center searchable by actor and an inclusive date range", () => {
    expect(dashboardSource).toContain("actorTelegramId");
    expect(dashboardSource).toContain("شناسهٔ عامل");
    expect(dashboardSource).toContain("fromDate");
    expect(dashboardSource).toContain("toDate");
    expect(dashboardSource).toContain("T00:00:00.000Z");
    expect(dashboardSource).toContain("T23:59:59.999Z");
  });

  it("keeps the versioned policy controls connected to preview, history, and scoped rollback APIs", () => {
    expect(dashboardSource).toContain("policyAudit.previewPolicy.useQuery");
    expect(dashboardSource).toContain("policyAudit.listPolicyVersions.useQuery");
    expect(dashboardSource).toContain("policyAudit.rollbackPolicy.useMutation");
    expect(dashboardSource).toContain("موتور سیاست نسخه‌دار");
    expect(dashboardSource).toContain("پیش‌نمایش اثر");
    expect(dashboardSource).toContain("تاریخچهٔ نسخه‌ها");
    expect(dashboardSource).toContain("versionId: version.id");
  });

  it("keeps an accessible persistent three-way theme control in the dashboard header", () => {
    expect(dashboardSource).toContain("useTheme");
    expect(dashboardSource).toContain("kronos-theme-toggle");
    expect(dashboardSource).toContain("themeMode");
    expect(dashboardSource).toContain("همگام با تنظیمات دستگاه");
    expect(dashboardSource).toContain("ThemeControlIcon");
    expect(dashboardSource).toContain("themeControlLabel");
    expect(appSource).toContain("switchable");
  });

  it("cycles persistent light, dark, and device-preference modes without a transition overlay", () => {
    const themeContextSource = readFileSync(resolve(__dirname, "..", "contexts", "ThemeContext.tsx"), "utf8");
    const stylesheet = readFileSync(resolve(__dirname, "..", "index.css"), "utf8");
    expect(themeContextSource).toContain('export type ThemeMode = Theme | "system"');
    expect(themeContextSource).toContain('currentMode === "dark" ? "light" : currentMode === "light" ? "system" : "dark"');
    expect(themeContextSource).toContain('window.matchMedia("(prefers-color-scheme: dark)")');
    expect(themeContextSource).toContain('mediaQuery.addEventListener("change", updateDeviceTheme)');
    expect(themeContextSource).toContain("THEME_STORAGE_KEY, themeMode");
    expect(themeContextSource).not.toContain("ThemeFlipOverlay");
    expect(themeContextSource).not.toContain("Math.random()");
    expect(stylesheet).not.toContain("kronos-theme-flip");
  });

  it("keeps owner alerts actionable with triage filters, delivery retry, acknowledgement, and related navigation", () => {
    expect(dashboardSource).toContain("function ownerAlertDestination");
    expect(dashboardSource).toContain("trpc.dashboard.alerts.retryDelivery.useMutation");
    expect(dashboardSource).toContain("onNavigate(destination.tab)");
    expect(dashboardSource).toContain("ارسال دوباره");
    expect(dashboardSource).toContain("ثبت رسیدگی");
    expect(dashboardSource).toContain("تلاش ارسال");
    expect(dashboardSource).toContain("openCount");
    expect(dashboardSource).toContain("ارسال ناموفق");
  });
});
