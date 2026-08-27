import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Mini App support shortcut", () => {
  const source = readFileSync(resolve(process.cwd(), "client/src/pages/OwnerDashboard.tsx"), "utf8");

  it("keeps a directly clickable localized support action in the dashboard header", () => {
    expect(source).toContain('aria-label={messages.nav.support}');
    expect(source).toContain('title={messages.nav.support}');
    expect(source).toContain('selectTab("support")');
    expect(source).toContain('<BellRing className="h-4 w-4" />');
  });

  it("exposes only a safe localized session identity badge, never raw initData", () => {
    expect(source).toContain('data-session-identity="signed"');
    expect(source).toContain("sessionProfile.telegramUserId");
    expect(source).toContain("sessionIdentityCopy");
    expect(source).not.toContain("{window.Telegram?.WebApp?.initData}");
  });

  it("renders group access through the localized role mapping", () => {
    expect(source).toContain("function groupAccessLabel");
    expect(source).toContain("dashboardRoleCopy[locale]");
    expect(source).toContain("groupAccessLabel(group.access, locale)");
    expect(source).not.toContain('group.access?.replaceAll("_", " ")');
  });
});
