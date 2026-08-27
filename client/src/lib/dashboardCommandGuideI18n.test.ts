import { describe, expect, it } from "vitest";
import { DASHBOARD_LOCALES } from "./dashboardI18n";
import { dashboardCommandGuideCopy } from "./dashboardCommandGuideI18n";

describe("dashboard command guide localization", () => {
  it("provides a distinct localized title and command guidance for every supported locale", () => {
    for (const locale of DASHBOARD_LOCALES) {
      const copy = dashboardCommandGuideCopy(locale);
      const completeGuide = [copy.text, ...copy.sections.map(section => section.text)].join("\n");
      expect(copy.title.length).toBeGreaterThan(2);
      expect(copy.text.length).toBeGreaterThan(40);
      if (locale !== "en") {
        expect(copy.title).not.toBe("Bot commands and flows");
        expect(copy.text).not.toContain("Reply directly to a member message for reliable targeting.");
      }
      expect(completeGuide).toContain("/help");
    }
  });

  it("returns the selected locale instead of silently sharing the English object", () => {
    const persian = dashboardCommandGuideCopy("fa");
    const persianReference = [persian.text, ...persian.sections.map(section => section.text)].join("\n");
    expect(persian.title).toBe("دستورها و قابلیت‌های ربات");
    expect(persian.text).toContain("◈ مدیریت اعضا");
    expect(persianReference).toContain("تنظیم لقب");
    expect(persian.text).toContain("آمار و زمان‌بندی آمار");
    expect(persian.text).toContain("عضویت اجباری");
    expect(persianReference).toContain("/payapprove");
    expect(persian.text).toContain("کنترل سنتر");
    expect(dashboardCommandGuideCopy("ru").title).toBe("Команды и возможности бота");
    expect(dashboardCommandGuideCopy("de").title).toBe("Bot-Befehle und Funktionen");
  });

  it("documents every active command area as a readable, localized reference", () => {
    for (const locale of DASHBOARD_LOCALES) {
      const guide = dashboardCommandGuideCopy(locale);
      expect(guide.sections).toHaveLength(11);
      expect(guide.sections.map(section => section.title).join(" ")).toMatch(/01/);
      for (const section of guide.sections) {
        expect(section.title.length).toBeGreaterThan(5);
        expect(section.text.length).toBeGreaterThan(120);
        expect(section.text.split("\n").length).toBeGreaterThanOrEqual(4);
      }
      const completeGuide = guide.sections.map(section => section.text).join("\n");
      expect(completeGuide).toContain("/help");
      expect(completeGuide).toContain("/payapprove");
      expect(completeGuide).toContain("تنظیم لقب");
      expect(completeGuide).toContain("قفل");
    }
  });
});
