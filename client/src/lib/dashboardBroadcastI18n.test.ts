import { describe, expect, it } from "vitest";
import { DASHBOARD_LOCALES } from "./dashboardI18n";
import { dashboardBroadcastResultCopy } from "./dashboardBroadcastI18n";

describe("dashboard broadcast result localization", () => {
  it("provides a localized delivery summary for every supported locale", () => {
    for (const locale of DASHBOARD_LOCALES) {
      const message = dashboardBroadcastResultCopy(locale).success("12", "10", "2", "4");
      expect(message).toContain("12");
      expect(message).toContain("10");
      expect(message).toContain("2");
      expect(message).toContain("4");
      expect(message.length).toBeGreaterThan(12);
    }
  });

  it("does not use the Persian delivery summary for the English locale", () => {
    expect(dashboardBroadcastResultCopy("en").success("1", "1", "0", "0")).toBe(
      "Sent to 1 of 1 eligible users; 0 deliveries failed; 0 users must start the bot privately first.",
    );
  });
});
