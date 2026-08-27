import { describe, expect, it } from "vitest";
import { dashboardHelpCopy } from "./dashboardHelpI18n";
import { DASHBOARD_LOCALES } from "./dashboardI18n";

const fields = [
  "nav", "eyebrow", "title", "intro", "accessTitle", "access", "groupsTitle", "groups",
  "moderationTitle", "moderation", "locksTitle", "locks", "forcedTitle", "forced",
  "paymentsTitle", "payments", "warningsTitle", "warnings", "broadcastTitle", "broadcast",
  "privacyTitle", "privacy",
] as const;

describe("dashboard help localization", () => {
  it("provides non-empty copy for every visible field in every supported locale", () => {
    for (const locale of DASHBOARD_LOCALES) {
      const copy = dashboardHelpCopy[locale];
      for (const field of fields) expect(copy[field].trim(), `${locale}.${field}`).not.toBe("");
    }
  });

  it("does not silently reuse the English long-form sections for translated locales", () => {
    for (const locale of DASHBOARD_LOCALES.filter(value => value !== "en")) {
      const copy = dashboardHelpCopy[locale];
      expect(copy.intro).not.toBe(dashboardHelpCopy.en.intro);
      expect(copy.access).not.toBe(dashboardHelpCopy.en.access);
      expect(copy.groups).not.toBe(dashboardHelpCopy.en.groups);
      expect(copy.broadcast).not.toBe(dashboardHelpCopy.en.broadcast);
    }
  });
});
