import { describe, expect, it } from "vitest";
import { formatDashboardSettingAnnouncement } from "./settingAnnouncements";

describe("dashboard setting announcements", () => {
  const input = {
    actorTelegramId: 42,
    actorDisplayName: "Ada <Admin>",
    changes: [{ label: "قفل لینک", enabled: true }],
    now: new Date("2026-08-14T08:30:00Z"),
  };

  it("uses Persian protection status wording and a safe direct actor mention for Persian groups", () => {
    const message = formatDashboardSettingAnnouncement({ ...input, locale: "fa" });
    expect(message).toContain("تنظیمات محافظت Kronos تغییر کرد");
    expect(message).toContain("فعال شد");
    expect(message).toContain("Ada &lt;Admin&gt;");
    expect(message).toContain('<a href="tg://user?id=42">Ada &lt;Admin&gt;</a>');
  });

  it("uses the configured non-Persian group locale for the status announcement", () => {
    const message = formatDashboardSettingAnnouncement({ ...input, locale: "en" });
    expect(message).toContain("Kronos protection settings updated");
    expect(message).toContain("Enabled");
    expect(message).toContain("Changed by");
  });
});
