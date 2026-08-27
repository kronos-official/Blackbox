import { describe, expect, it } from "vitest";
import { DASHBOARD_LOCALES } from "./dashboardI18n";
import { dashboardNotificationDeliveryCopy } from "./dashboardNotificationDeliveryI18n";

describe("dashboard notification delivery localization", () => {
  it("provides complete delivery-channel copy for every supported dashboard locale", () => {
    for (const locale of DASHBOARD_LOCALES) {
      const copy = dashboardNotificationDeliveryCopy[locale];
      expect(copy.eyebrow.trim()).not.toHaveLength(0);
      expect(copy.title.trim()).not.toHaveLength(0);
      expect(copy.description.trim()).not.toHaveLength(0);
      expect(copy.enabled.trim()).not.toHaveLength(0);
      expect(copy.disabled.trim()).not.toHaveLength(0);
      expect(copy.enabledHint.trim()).not.toHaveLength(0);
      expect(copy.disabledHint.trim()).not.toHaveLength(0);
      expect(copy.aria.trim()).not.toHaveLength(0);
      expect(copy.loadError.trim()).not.toHaveLength(0);
    }
  });

  it("keeps the Persian delivery path fully Persian-first", () => {
    const copy = dashboardNotificationDeliveryCopy.fa;
    expect(copy.eyebrow).toBe("مسیر تحویل");
    expect(copy.title).toBe("کانال تحویل اعلان‌ها");
    expect(copy.loadError).toContain("لطفاً دوباره تلاش کنید");
  });
});
