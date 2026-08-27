import { describe, expect, it } from "vitest";
import { DASHBOARD_LOCALES } from "./dashboardI18n";
import { dashboardSystemCopyFor } from "./dashboardSystemI18n";

describe("dashboard system localization", () => {
  it("provides complete public error-page copy for every supported locale", () => {
    for (const locale of DASHBOARD_LOCALES) {
      const copy = dashboardSystemCopyFor(locale);
      expect(copy.notFoundTitle).toBeTruthy();
      expect(copy.notFoundText).toBeTruthy();
      expect(copy.goHome).toBeTruthy();
      expect(copy.unexpectedError).toBeTruthy();
      expect(copy.reloadPage).toBeTruthy();
      if (locale !== "fa") expect(Object.values(copy).join(" ")).not.toMatch(/[پچژگ]/);
    }
  });

  it("keeps Persian as the explicit default public-error copy", () => {
    expect(dashboardSystemCopyFor("fa").notFoundTitle).toBe("صفحه پیدا نشد");
  });
});
