import { describe, expect, it } from "vitest";
import { normalizeLocale, supportedLocales, translate, type MessageKey } from "./i18n";

describe("Kronos Guard localization", () => {
  it("supports the twelve specified bot locales and normalizes Telegram locale variants", () => {
    expect(supportedLocales).toHaveLength(12);
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("fa_IR")).toBe("fa");
    expect(normalizeLocale("unsupported")).toBe("fa");
  });

  it("has fully localized start, language, and forced-join copy for every supported locale", () => {
    const keys: MessageKey[] = ["welcome", "languageUpdated", "languageHelp", "languageSelector", "forcedJoinLocked", "forcedJoinStillMissing", "forcedJoinVerificationUnavailable", "membershipVerified", "joinChannel", "verifyMembership"];
    for (const locale of supportedLocales) {
      for (const key of keys) expect(translate(locale, key).trim()).not.toHaveLength(0);
    }
  });

  it("gives Persian users a visually structured, actionable Kronos Guard onboarding", () => {
    const welcome = translate("fa", "welcome");
    expect(welcome).toContain("به 𝐾𝑟𝑜𝑛𝑜𝑠 𝐺𝑢𝑎𝑟𝑑 خوش آمدی");
    expect(welcome).toContain("کنترل سنتر امنیت و مدیریت حرفهای گروه");
    expect(welcome).toContain("<b>راه‌اندازی سریع</b>");
    expect(welcome).toContain("کنترل سنتر");
    expect(welcome).toContain("/help");
    expect(welcome).toContain("<blockquote>");
    expect(welcome).toContain("پیشگیری هوشمندانه");
    expect(welcome).not.toContain("بازارچهٔ کانال");
    expect(welcome).not.toContain("3 کانال فعال");
    expect(welcome).not.toContain("ضداسپم، قفل‌های محتوا");
    expect(welcome).not.toContain("مرکز فرمان");
  });
});
