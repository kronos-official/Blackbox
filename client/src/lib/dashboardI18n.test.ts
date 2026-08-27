import { describe, expect, it } from "vitest";
import { DASHBOARD_LOCALES, dashboardDirection, dashboardMessages, dashboardPanelMessages, dashboardCommonCopy, dashboardConnectedGroupsCopy, dashboardOperationalCopy, dashboardOverviewCopy, dashboardOverviewStatusCopy, dashboardRoleCopy, dashboardModerationCopy, dashboardForcedCopy, dashboardWarningFormCopy, dashboardMemberExtraCopy, normalizeDashboardLocale } from "./dashboardI18n";

describe("dashboard global localization", () => {
  it("contains the twelve supported dashboard locales with a complete shell vocabulary", () => {
    expect(DASHBOARD_LOCALES).toHaveLength(12);
    for (const locale of DASHBOARD_LOCALES) {
      const messages = dashboardMessages(locale);
      expect(messages.language).toBeTruthy();
      expect(messages.languageSaved).toBeTruthy();
      expect(Object.keys(messages.nav)).toHaveLength(13);
      expect(messages.nav.help).toBeTruthy();
      expect(Object.values(messages.nav).every(Boolean)).toBe(true);
    }
  });

  it("keeps the owner-only connected-groups registry copy complete and localized", () => {
    for (const locale of DASHBOARD_LOCALES) {
      const copy = dashboardConnectedGroupsCopy[locale];
      expect(copy.title).toBeTruthy();
      expect(copy.access).toBeTruthy();
      expect(copy.installed).toBeTruthy();
      if (locale !== "fa") expect(Object.values(copy).join(" ")).not.toMatch(/[پچژگ]/);
    }
  });

  it("exposes translated copy for every internal dashboard panel in every locale", () => {
    const panels = ["overview", "groups", "members", "moderation", "warningPolicy", "forced", "payments", "alerts", "settings", "audit"] as const;
    for (const locale of DASHBOARD_LOCALES) {
      for (const panel of panels) {
        const copy = dashboardPanelMessages(locale, panel);
        expect(copy.eyebrow).toBeTruthy();
        expect(copy.title).toBeTruthy();
        expect(copy.text).toBeTruthy();
      }
    }
  });

  it("keeps the English dashboard shell and panel copy free of Persian fallback text", () => {
    const englishShell = dashboardMessages("en");
    const englishPanels = ["overview", "groups", "members", "moderation", "warningPolicy", "forced", "payments", "alerts", "settings", "audit"] as const;
    const copy = [...Object.values(englishShell.nav), ...englishPanels.flatMap(panel => {
      const panelCopy = dashboardPanelMessages("en", panel);
      return [panelCopy.eyebrow, panelCopy.title, panelCopy.text];
    })].join(" ");
    expect(copy).not.toMatch(/[\u0600-\u06FF]/);
  });

  it("keeps every translated panel copy free of Persian fallback in non-Persian locales", () => {
    const panels = ["overview", "groups", "members", "moderation", "warningPolicy", "forced", "payments", "alerts", "settings", "audit"] as const;
    for (const locale of DASHBOARD_LOCALES.filter(item => item !== "fa")) {
      const panelCopy = panels.flatMap(panel => {
        const copy = dashboardPanelMessages(locale, panel);
        return [copy.eyebrow, copy.title, copy.text];
      }).join(" ");
      expect(panelCopy).not.toMatch(/[پچژگ]/);
    }
  });

  it("keeps shared maintenance and warning copy free of Persian fallback in non-Persian locales", () => {
    for (const locale of DASHBOARD_LOCALES.filter(item => item !== "fa")) {
      expect(Object.values(dashboardCommonCopy[locale]).join(" ")).not.toMatch(/[پچژگ]/);
    }
  });

  it("keeps operational alert and audit actions translated in every non-Persian locale", () => {
    for (const locale of DASHBOARD_LOCALES.filter(item => item !== "fa")) {
      const copy = dashboardOperationalCopy[locale];
      expect(copy.close).toBeTruthy();
      expect(copy.alertsEmpty).toBeTruthy();
      expect(copy.auditEmpty).toBeTruthy();
      expect(copy.groupPrefix).toBeTruthy();
      expect(Object.values(copy).join(" ")).not.toMatch(/[پچژگ]/);
    }
  });

  it("keeps Overview copy translated without Persian fallback in non-Persian locales", () => {
    for (const locale of DASHBOARD_LOCALES.filter(item => item !== "fa")) {
      const copy = dashboardOverviewCopy[locale];
      expect(Object.values(copy).join(" ")).not.toMatch(/[پچژگ]/);
      expect(copy.liveTitle).toBeTruthy();
      expect(copy.noAlerts).toBeTruthy();
    }
  });

  it("keeps the overview status labels translated in every supported locale", () => {
    for (const locale of DASHBOARD_LOCALES) {
      const copy = dashboardOverviewStatusCopy[locale];
      expect(copy.eyebrow).toBeTruthy();
      expect(copy.systemStatus).toBeTruthy();
      expect(copy.botOperational).toBeTruthy();
      if (locale !== "fa") expect(Object.values(copy).join(" ")).not.toMatch(/[پچژگ]/);
    }
  });

  it("keeps role-management copy complete and free of Persian fallback in non-Persian locales", () => {
    for (const locale of DASHBOARD_LOCALES.filter(item => item !== "fa")) {
      const copy = dashboardRoleCopy[locale];
      expect(copy.group).toBeTruthy();
      expect(copy.userId).toBeTruthy();
      expect(copy.save).toBeTruthy();
      expect(copy.remove).toBeTruthy();
      expect(Object.values(copy).join(" ")).not.toMatch(/[پچژگ]/);
    }
  });

  it("keeps moderation workspace copy complete and free of Persian fallback in non-Persian locales", () => {
    for (const locale of DASHBOARD_LOCALES.filter(item => item !== "fa")) {
      const copy = dashboardModerationCopy[locale];
      expect(copy.selectGroup).toBeTruthy();
      expect(copy.locksTitle).toBeTruthy();
      expect(copy.removeWarnings).toBeTruthy();
      expect(Object.values(copy).join(" ")).not.toMatch(/[پچژگ]/);
    }
  });

  it("keeps forced-join copy complete and free of Persian fallback in non-Persian locales", () => {
    for (const locale of DASHBOARD_LOCALES.filter(item => item !== "fa")) {
      const copy = dashboardForcedCopy[locale];
      expect(copy.add).toBeTruthy();
      expect(copy.botAdmin).toBeTruthy();
      expect(copy.deleteConfirm).toContain("{title}");
      expect(Object.values(copy).join(" ")).not.toMatch(/[پچژگ]/);
    }
  });

  it("keeps WarningPolicy form copy complete and free of Persian fallback in non-Persian locales", () => {
    for (const locale of DASHBOARD_LOCALES.filter(item => item !== "fa")) {
      const copy = dashboardWarningFormCopy[locale];
      expect(copy.selectGroup).toBeTruthy();
      expect(copy.policyTitle).toBeTruthy();
      expect(copy.save).toBeTruthy();
      expect(Object.values(copy).join(" ")).not.toMatch(/[پچژگ]/);
    }
  });

  it("keeps member-management extra copy localized instead of sharing English fallback", () => {
    const english = Object.values(dashboardMemberExtraCopy.en).join(" ");
    for (const locale of DASHBOARD_LOCALES.filter(item => item !== "en")) {
      const translated = Object.values(dashboardMemberExtraCopy[locale]).join(" ");
      expect(translated).not.toBe(english);
      if (locale !== "fa") expect(translated).not.toMatch(/[پچژگ]/);
    }
  });

  it("normalizes unknown locales to Persian and keeps RTL only for RTL languages", () => {
    expect(normalizeDashboardLocale("unknown")).toBe("fa");
    expect(normalizeDashboardLocale("en")).toBe("en");
    expect(dashboardDirection("fa")).toBe("rtl");
    expect(dashboardDirection("ar")).toBe("rtl");
    expect(dashboardDirection("en")).toBe("ltr");
  });
});
