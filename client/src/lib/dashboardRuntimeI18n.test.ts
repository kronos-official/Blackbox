import { describe, expect, it } from "vitest";
import { DASHBOARD_LOCALES } from "./dashboardI18n";
import { dashboardRuntimeCopyFor } from "./dashboardRuntimeI18n";

describe("dashboard runtime localization", () => {
  it("provides localized loading, status, and error copy for every supported locale", () => {
    for (const locale of DASHBOARD_LOCALES) {
      const copy = dashboardRuntimeCopyFor(locale);
      expect(copy.about).toBeTruthy();
      expect(copy.history).toBeTruthy();
      expect(copy.loadingData).toBeTruthy();
      expect(copy.loadingWait).toBeTruthy();
      expect(copy.adminTelegram).toBeTruthy();
      expect(Object.values(copy.errors).every(Boolean)).toBe(true);
      expect(Object.values(copy.statusLabels).every(Boolean)).toBe(true);
    }
  });

  it("does not fall back to English for non-English runtime locales", () => {
    const english = dashboardRuntimeCopyFor("en");
    const englishValues = [
      english.about,
      english.history,
      english.loadingData,
      english.loadingWait,
      english.adminTelegram,
      ...Object.values(english.errors),
      ...Object.values(english.statusLabels),
    ];

    for (const locale of DASHBOARD_LOCALES.filter(item => item !== "en")) {
      const copy = dashboardRuntimeCopyFor(locale);
      const values = [
        copy.about,
        copy.history,
        copy.loadingData,
        copy.loadingWait,
        copy.adminTelegram,
        ...Object.values(copy.errors),
        ...Object.values(copy.statusLabels),
      ];
      expect(values).not.toEqual(englishValues);
    }
  });
});
