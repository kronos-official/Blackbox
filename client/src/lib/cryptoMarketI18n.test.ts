import { describe, expect, it } from "vitest";
import { DASHBOARD_LOCALES } from "./dashboardI18n";
import { cryptoMarketCopyFor } from "./cryptoMarketI18n";

describe("crypto market localization", () => {
  it("provides complete price, 24-hour change, chart, and recovery copy for every supported locale", () => {
    for (const locale of DASHBOARD_LOCALES) {
      const copy = cryptoMarketCopyFor(locale);
      expect(copy.title).toBeTruthy();
      expect(copy.searchPlaceholder).toBeTruthy();
      expect(copy.profitLoss24h).toBeTruthy();
      expect(copy.chartSource).toBeTruthy();
      expect(copy.chartUnavailable).toContain("{range}");
      expect(copy.ranges["1d"].label).toBeTruthy();
      expect(copy.ranges["7d"].heading).toBeTruthy();
      expect(copy.ranges["30d"].heading).toBeTruthy();
      if (locale !== "fa") expect(Object.values(copy).join(" ")).not.toMatch(/[پچژگ]/);
    }
  });

  it("keeps Persian as the explicit default for the public market panel", () => {
    expect(cryptoMarketCopyFor("fa").title).toBe("بازار عمومی رمزارز");
    expect(cryptoMarketCopyFor("fa").profitLoss24h).toBe("سود / زیان 24 ساعته");
  });
});
