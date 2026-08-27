import { dashboardCustomInvoiceActions, dashboardCustomInvoiceCopy } from "./dashboardCustomInvoiceI18n";
import { DASHBOARD_LOCALES } from "./dashboardI18n";
import { describe, expect, it } from "vitest";

const fields = [
  "title", "description", "target", "targetHint", "channelId", "amountStars", "durationDays",
  "expiryHours", "send", "invalid", "sent", "sentDetails", "paymentNotice", "sendFailed",
] as const;

describe("custom Stars invoice localization", () => {
  it("provides complete non-empty owner form copy for all dashboard locales", () => {
    for (const locale of DASHBOARD_LOCALES) {
      const copy = dashboardCustomInvoiceCopy[locale];
      for (const field of fields) expect(copy[field].trim(), `${locale}.${field}`).not.toBe("");
    }
  });

  it("provides complete translated resolver actions for every locale", () => {
    for (const locale of DASHBOARD_LOCALES) {
      const actions = dashboardCustomInvoiceActions[locale];
      for (const [field, value] of Object.entries(actions)) expect(value.trim(), `${locale}.${field}`).not.toBe("");
    }
  });

  it("keeps the Persian resolver action fully Persian instead of mixing an English verb", () => {
    expect(dashboardCustomInvoiceActions.fa.resolve).toBe("تبدیل");
    expect(dashboardCustomInvoiceActions.fa.resolve).not.toMatch(/Generate|Resolve/);
  });

  it("does not silently substitute English for translated owner-payment guidance", () => {
    for (const locale of DASHBOARD_LOCALES.filter(locale => locale !== "en")) {
      expect(dashboardCustomInvoiceCopy[locale].description).not.toBe(dashboardCustomInvoiceCopy.en.description);
      expect(dashboardCustomInvoiceCopy[locale].paymentNotice).not.toBe(dashboardCustomInvoiceCopy.en.paymentNotice);
      expect(dashboardCustomInvoiceCopy[locale].sendFailed).not.toBe(dashboardCustomInvoiceCopy.en.sendFailed);
    }
  });
});
