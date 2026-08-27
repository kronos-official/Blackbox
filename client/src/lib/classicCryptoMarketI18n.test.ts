import { describe, expect, it } from "vitest";
import { DASHBOARD_LOCALES } from "@/lib/dashboardI18n";
import { classicCryptoMarketCopyFor } from "./classicCryptoMarketI18n";

describe("classic crypto-market translations", () => {
  it("provides complete visible-market vocabulary for every supported locale", () => {
    for (const locale of DASHBOARD_LOCALES) {
      const copy = classicCryptoMarketCopyFor(locale);
      expect(copy.navLabel.length).toBeGreaterThan(1);
      expect(copy.title.length).toBeGreaterThan(1);
      expect(copy.searchPlaceholder.length).toBeGreaterThan(1);
      expect(copy.favorites.length).toBeGreaterThan(1);
      expect(copy.starsCalculator.length).toBeGreaterThan(1);
      expect(copy.starsTitle.length).toBeGreaterThan(1);
      expect(copy.starsDisclaimer.length).toBeGreaterThan(1);
      expect(copy.addFavorite.length).toBeGreaterThan(1);
      expect(copy.removeFavorite.length).toBeGreaterThan(1);
      expect(copy.ranges["1d"].label.length).toBeGreaterThan(1);
    }
  });

  it("keeps the Persian and English navigation labels localized", () => {
    expect(classicCryptoMarketCopyFor("fa").navLabel).toBe("بازار ارز");
    expect(classicCryptoMarketCopyFor("en").navLabel).toBe("Currency market");
    expect(classicCryptoMarketCopyFor("fa").starsTitle).toBe("استارز تلگرام");
    expect(classicCryptoMarketCopyFor("en").starsTitle).toBe("Telegram Stars");
  });
});
