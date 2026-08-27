import { buildUserStatusCaption } from "./moderation";
import { describe, expect, it } from "vitest";

describe("user status caption", () => {
  it("renders a concise, scannable user card with a direct target mention", () => {
    const caption = buildUserStatusCaption({
      target: { telegramUserId: 8375579910, displayName: "Kronos" },
      username: "Kronosteam_official",
      role: "group_admin",
      warnings: 2,
      muteExpiresAt: null,
      profilePhotoCount: 109,
    });

    expect(caption).toContain("<b>◈ وضعیت کاربر</b>");
    expect(caption).toContain('<a href="tg://user?id=8375579910">Kronos</a>');
    expect(caption).toContain("@Kronosteam_official");
    expect(caption).toContain("مقام: <b>مدیر گروه</b>");
    expect(caption).toContain("اخطار: <b>2</b>");
    expect(caption).toContain("تصاویر پروفایل: <b>109 تصویر</b>");
    expect(caption).toContain("سکوت: <b>فعال نیست</b>");
    expect(caption).not.toContain("وضعیت حفاظتی");
    expect(caption).not.toContain("نمای لحظه‌ای");
    expect(caption).not.toContain("────────────");
    expect(caption).not.toMatch(/[۰-۹]/);
  });

  it("keeps an explicit fallback when profile-photo data is unavailable", () => {
    const caption = buildUserStatusCaption({
      target: { telegramUserId: 42, displayName: "Guest" },
      role: "user",
      warnings: 0,
    });

    expect(caption).toContain("نام کاربری: ثبت نشده");
    expect(caption).toContain("تصاویر پروفایل: <b>در دسترس نیست</b>");
  });
});
