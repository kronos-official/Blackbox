import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  new URL("../../client/src/pages/OwnerDashboard.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(new URL("../../client/src/index.css", import.meta.url), "utf8");
const introSource = readFileSync(new URL("../../client/src/components/KronosIntro.tsx", import.meta.url), "utf8");
const dashboardI18nSource = readFileSync(new URL("../../client/src/lib/dashboardI18n.ts", import.meta.url), "utf8");

describe("authenticated Mini App accessibility contract", () => {
  it("exposes locale and direction semantics on the authenticated dashboard shell", () => {
    expect(dashboardSource).toContain('dir={direction} lang={locale}');
    expect(dashboardSource).toContain('direction === "rtl"');
    expect(dashboardSource).toContain('aria-current={allowedTab === item.id ? "page" : undefined}');
    expect(dashboardSource).toContain("messages.secureSession");
    expect(dashboardSource).toContain("messages.telegramVerified");
  });

  it("labels the language selector and mobile navigation controls", () => {
    expect(dashboardSource).toContain('select aria-label={messages.language}');
    expect(dashboardSource).toContain("dashboardUiCopy[locale].actions.openMenu");
    expect(dashboardSource).toContain("dashboardUiCopy[locale].actions.closeMenu");
    expect(dashboardSource).toContain("dashboardUiCopy[locale].actions.refresh");
  });

  it("keeps form controls label-associated and avoids the removed Persian reset hardcode", () => {
    expect(dashboardSource).toContain("function Field({ label, children }");
    expect(dashboardSource).toContain("<Field label={copy.resetDescription}>");
    expect(dashboardSource).not.toContain("برای فعال‌سازی، دقیقاً بنویسید");
    expect(dashboardSource).toContain('placeholder="RESET KRONOS DATABASE"');
  });

  it("covers role-management semantics and protected-role states", () => {
    expect(dashboardSource).toContain("dashboardRoleCopy[locale]");
    expect(dashboardSource).toContain('<Field label={roleCopy.group}>');
    expect(dashboardSource).toContain('roleCopy.invalid');
    expect(dashboardSource).toContain('roleCopy.ownerOnly');
    expect(dashboardSource).toContain('roleCopy.saving');
    expect(dashboardSource).toContain('value="kronos_owner"');
    expect(dashboardSource).toContain('value="user"');
  });

  it("keeps the forced-membership panel available without the removed graphical status-card route", () => {
    expect(dashboardSource).toContain('"warningPolicy", "forced", "cryptoMarket", "notifications", "support"');
    expect(dashboardSource).toContain("<ForcedJoin isOwner={profile?.isOwner ?? false} />");
    expect(dashboardSource).toContain('navigation.filter(item => USER_DASHBOARD_NAV_IDS.includes(item.id as (typeof USER_DASHBOARD_NAV_IDS)[number]))');
    expect(dashboardSource).toContain('"groups", "forced", "cryptoMarket", "notifications", "help"');
    expect(dashboardSource).toContain('const USER_DASHBOARD_NAV_IDS');
    expect(dashboardI18nSource).toContain('forced: "عضویت اجباری"');
    expect(dashboardSource).not.toContain("StatusCardHistoryPanel");
    expect(dashboardSource).not.toContain("statusCards");
    expect(dashboardSource).not.toContain('history: <');
  });

  it("preserves visible focus and reduced-motion behavior in the dashboard styles", () => {
    expect(styles).toMatch(/:focus-visible/);
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain(".kronos-dashboard-enter { animation: none; }");
    expect(styles).toMatch(/overflow-x|overflow-wrap|break-word/);
  });

  it("keeps the premium visual shell and restrained motion hooks across dashboard surfaces", () => {
    expect(dashboardSource).toContain("kronos-app-frame");
    expect(dashboardSource).toContain("kronos-app-frame--intro");
    expect(dashboardSource).toContain("kronos-app-frame--ready");
    expect(dashboardSource).toContain("onComplete={() => setShowIntro(false)}");
    expect(dashboardSource).toContain("kronos-topbar");
    expect(dashboardSource).toContain("kronos-content-stage");
    expect(dashboardSource).toContain("kronos-mobile-dock");
    expect(dashboardSource).toContain("kronos-metric");
    expect(dashboardSource).toContain("kronos-section-heading");
    expect(styles).toContain(".kronos-shell::before");
    expect(styles).toContain(".kronos-app-frame--ready");
    expect(styles).toContain("transition: opacity 560ms");
    expect(styles).toContain('.kronos-sidebar nav > button[aria-current="page"]');
    expect(styles).toContain(".kronos-metric__icon");
    expect(styles).toContain("@keyframes kronos-panel-rise");
  });

  it("uses a branded K-centered Logomotion with a reduced-motion fallback", () => {
    expect(introSource).toContain("kronos-intro__crest");
    expect(introSource).toContain("kronos-intro__shield");
    expect(introSource).toContain("<span>K</span>");
    expect(introSource).toContain("prefers-reduced-motion");
    expect(introSource).not.toContain("audio.play");
    expect(introSource).not.toContain("<audio");
    expect(dashboardSource).not.toContain("dashboardLoadingStages");
    expect(dashboardSource).not.toContain("kronos-dashboard-loading-status");
    expect(styles).toContain("@keyframes kronos-intro-crest-in");
    expect(styles).toContain("filter: drop-shadow");
    expect(styles).toContain("text-shadow:");
    expect(introSource).toContain("kronos-intro__orbit--outer");
    expect(introSource).not.toContain("kronos-intro__skip");
    expect(styles).toContain("@keyframes kronos-future-orbit");
  });

  it("keeps the dashboard handoff immediate without the removed Skeleton or theme-flip overlay", () => {
    expect(dashboardSource).not.toContain("DashboardContentSkeleton");
    expect(dashboardSource).not.toContain("showDashboardSkeleton");
    expect(styles).not.toContain("kronos-skeleton-shimmer");
    expect(styles).not.toContain("kronos-theme-flip");
    expect(styles).not.toContain("rotateY(180deg)");
  });

  it("keeps the logo-motion compact on small displays while retaining its readable branded glow", () => {
    expect(styles).toContain("@media (max-width: 479px)");
    expect(styles).toContain("width: 4.5rem");
    expect(styles).toContain("width: 2.8rem; height: 3.1rem");
    expect(styles).toContain("font-size: .95rem");
    expect(styles).toContain("filter: drop-shadow");
    expect(styles).toContain("text-shadow:");
  });

  it("uses shallow light-theme surface shadows to preserve hierarchy with less compositing work", () => {
    expect(styles).toContain("0 2px 8px -4px rgb(14 116 144 / .12)");
    expect(styles).toContain("0 4px 12px -8px rgb(14 116 144 / .2)");
  });

  it("keeps the Mini App wrapped in a rounded branded frame", () => {
    expect(styles).toContain(".kronos-shell {");
    expect(styles).toContain("border-radius: 30px");
    expect(styles).toContain("border: 1px solid rgb(103 232 249 / .18)");
    expect(styles).toContain("min-height: calc(100dvh - 16px)");
    expect(styles).toContain(":root:not(.dark) .kronos-shell");
    expect(styles).toContain("rgb(14 165 233 / .28)");
    expect(styles).toContain(":root:not(.dark) .kronos-shell::after");
  });

  it("coordinates theme transitions while respecting reduced motion", () => {
    expect(styles).toContain("/* Coordinated light/dark theme transition */");
    expect(styles).toContain("transition-duration: 420ms");
    expect(styles).toContain("transition-duration: 520ms");
    expect(styles).toContain("transition: none !important");
  });

  it("tunes the branded frame proportionally for tablet and wide desktop viewports", () => {
    expect(styles).toContain("@media (min-width: 640px) and (max-width: 1279px)");
    expect(styles).toContain("min-height: calc(100dvh - 24px)");
    expect(styles).toContain("@media (min-width: 1280px)");
    expect(styles).toContain("min-height: calc(100dvh - 32px)");
    expect(styles).toContain("@media (min-width: 1800px)");
    expect(styles).toContain("min-height: calc(100dvh - 40px)");
  });

  it("extends the visual language to the internal panel, form, list, and dialog surfaces", () => {
    expect(styles).toContain("Interior panel language");
    expect(styles).toContain(".kronos-content-stage section > .grid > [data-slot=\"card\"]");
    expect(styles).toContain(".kronos-shell form > :is(div, fieldset, label)");
    expect(styles).toContain(".kronos-shell [data-slot=\"dialog-content\"]");
    expect(styles).toContain("@keyframes kronos-item-settle");
    expect(styles).toContain("@keyframes kronos-dialog-arrive");
    expect(dashboardSource).toContain('className="kronos-field block space-y-1.5"');
    expect(dashboardSource).toContain("kronos-toggle flex items-center");
    expect(dashboardSource).toContain("kronos-empty-state p-7");
    expect(styles).toContain(".kronos-empty-state");
  });
});
