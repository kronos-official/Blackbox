import { describe, expect, it } from "vitest";
import { DASHBOARD_LOCALES } from "./dashboardI18n";
import { dashboardGroupFormCopy } from "./dashboardGroupFormI18n";

describe("dashboard group form localization", () => {
  it("provides every visible group-form label for all supported locales", () => {
    const keys = ["empty", "close", "description", "templateTitle", "formats", "formatsExample", "variables", "variablesExample", "readOnly", "welcome", "goodbye", "antiSpam", "antiRaid", "floodLimit", "floodWindow", "duplicateLimit", "warningLimit", "rules", "save", "saved"] as const;
    for (const locale of DASHBOARD_LOCALES) {
      for (const key of keys) expect(dashboardGroupFormCopy[locale][key].trim()).not.toBe("");
    }
  });

  it("documents the Persian Jalali/Gregorian dates and short/full clocks", () => {
    const example = dashboardGroupFormCopy.fa.variablesExample;
    expect(example).toContain("{تاریخ_شمسی}");
    expect(example).toContain("{تاریخ_میلادی}");
    expect(example).toContain("{ساعت_دقیقه}");
    expect(example).toContain("{ساعت_دقیقه_ثانیه}");
  });
});
