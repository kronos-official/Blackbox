import { describe, expect, it } from "vitest";
import { buildUserPanelCaption, resolveUserPanelTarget, USER_PANEL_REFRESH_CALLBACK_PREFIX, USER_PANEL_REFRESH_TIMEOUT_MS, userPanelRefreshKeyboard } from "./moderation";

describe("user panel caption", () => {
  it("renders a professional identity, activity, and safety profile with English numerals", () => {
    const caption = buildUserPanelCaption({
      displayName: "Kronos",
      telegramUserId: 8375579910,
      username: "Kronosteam_official",
      warningCount: 2,
      role: "owner",
      isVip: false,
      telegramRole: "owner",
      actionCount: 4,
      memberSince: new Date("2026-08-01T00:00:00.000Z"),
      lastSeenAt: new Date(Date.now() - 60_000),
      profilePhotoCount: 109,
      kronosTitle: "محافظ ارشد",
      stats: {
        today: { messages: 36, addedMembers: 1 },
        week: { messages: 2642, addedMembers: 34 },
        month: { messages: 2642, addedMembers: 34 },
        all: { messages: 2642, addedMembers: 34 },
        messageRank: 3,
        addedMemberRank: 3,
      },
    });
    expect(caption).toContain("پنل کاربر | Kronos Guard");
    expect(caption).toContain("پروندهٔ هویتی، دسترسی و فعالیت عضو");
    expect(caption).toContain("نوع پنل: <b>🔵 پنل کاربر دیگر</b>");
    expect(caption).toContain("8375579910");
    expect(caption).toContain('<a href="tg://user?id=8375579910">Kronos</a>');
    expect(caption).toContain("@Kronosteam_official");
    expect(caption).not.toContain('<a href="tg://user?id=8375579910">محافظ ارشد</a>');
    expect(caption).toContain("109 تصویر");
    expect(caption).toContain("لقب کاربر: <b>محافظ ارشد</b>");
    expect(caption).not.toContain("Kronos | محافظ ارشد");
    expect(caption).toContain("سطح دسترسی: <b>مالک</b>");
    expect(caption).toContain("مقام کاربر: <b>مالک</b>");
    expect(caption).toContain("وضعیت حضور: <b>🟢 آنلاین</b>");
    expect(caption).toContain("پیام‌های امروز: <b>36</b>");
    expect(caption).toContain("پیام‌های این هفته: <b>2,642</b>");
    expect(caption).toContain("پیام‌های این ماه: <b>2,642</b>");
    expect(caption).toContain("کل پیام‌ها: <b>2,642</b>");
    expect(caption).toContain("رتبهٔ پیام: <b>#3</b>");
    expect(caption).toContain("افزودن عضو امروز: <b>1</b>");
    expect(caption).toContain("افزودن عضو این هفته: <b>34</b>");
    expect(caption).toContain("افزودن عضو این ماه: <b>34</b>");
    expect(caption).toContain("کل افزودن عضو: <b>34</b>");
    expect(caption).toContain("رتبهٔ افزودن عضو: <b>#3</b>");
    expect(caption).not.toContain("اوج فعالیت");
    expect(caption).not.toContain("ساعت‌های");
    expect(caption).not.toContain("روزهای");
    expect(caption).toContain("وضعیت حفاظتی");
    expect(caption).toContain("اخطار فعال");
    expect(caption).not.toMatch(/[۰-۹]/);
    expect(caption).not.toContain("Kronos Guard مالک");
  });

  it("marks a self panel when the target matches the viewer", () => {
    const caption = buildUserPanelCaption({
      displayName: "Me",
      telegramUserId: 42,
      warningCount: 0,
      role: "user",
      isSelf: true,
      actionCount: 0,
    });
    expect(caption).toContain("نوع پنل: <b>🟢 پنل شما</b>");
    expect(caption).not.toContain("پنل کاربر دیگر");
  });

  it("uses explicit empty states rather than fabricated statistics", () => {
    const caption = buildUserPanelCaption({
      displayName: "Guest",
      telegramUserId: 42,
      warningCount: 0,
      role: "user",
      isVip: true,
      telegramRole: "member",
      actionCount: 0,
    });
    expect(caption).toContain("سطح دسترسی: <b>ویژه</b>");
    expect(caption).toContain("مقام کاربر: <b>بدون مقام</b>");
    expect(caption).toContain("وضعیت حضور: <b>⚪ آفلاین</b>");
    expect(caption).toContain("ثبت نشده");
    expect(caption).toContain("پیام‌های امروز: <b>ثبت نشده</b>");
    expect(caption).toContain("در دسترس نیست");
  });

  it("renders a visible countdown and restores the active label after timeout", () => {
    expect(USER_PANEL_REFRESH_TIMEOUT_MS).toBe(10_000);
    expect(userPanelRefreshKeyboard(77, 42, 7).inline_keyboard[0][0]).toMatchObject({
      text: "🔄 تازه‌سازی در 7 ثانیه",
      callback_data: `${USER_PANEL_REFRESH_CALLBACK_PREFIX}77:42`,
      style: "primary",
    });
    expect(userPanelRefreshKeyboard(77, 42, 0).inline_keyboard[0][0].text).toBe("🔄 تازه‌سازی پنل");
    const refreshKeyboard = userPanelRefreshKeyboard(77, 42).inline_keyboard;
    expect(refreshKeyboard.flat().map(button => button.text).join(" ")).not.toContain("در حال تازه‌سازی");
    expect(refreshKeyboard.flat().map(button => button.text).join(" ")).not.toContain("%");
  });
});

it("resolves a bare Persian user-panel command to the sender in a direct group context", async () => {
  const target = await resolveUserPanelTarget({
    from: { id: 8375579910, first_name: "Kronos", last_name: "Guard" },
    message: { text: "پنل کاربر" },
  } as any, { action: "panel", sourceAlias: "پنل کاربر" });
  expect(target).toEqual({ telegramUserId: 8375579910, displayName: "Kronos Guard" });
});

it("shows the latest successful refresh time beneath the refresh button", async () => {
  const { userPanelRefreshKeyboard } = await import("./moderation");
  const updatedAt = new Date("2026-08-20T06:25:18.000Z");
  const rows = userPanelRefreshKeyboard(-100123, 42, 0, updatedAt).inline_keyboard;
  expect(rows[0][0]).toMatchObject({ text: "🔄 تازه‌سازی پنل", style: "primary" });
    expect(rows[1][0]).toMatchObject({ callback_data: "user-panel-last-updated" });
    expect(rows[1][0]).not.toHaveProperty("style");
  expect(rows[1][0].text).toBe("آخرین به‌روزرسانی: 09:55:18");
});


describe("user panel refresh failure feedback", () => {
  it("adds a compact Persian warning without duplicating it", async () => {
    const { appendUserPanelRefreshError, USER_PANEL_REFRESH_ERROR_TEXT } = await import("./moderation");
    const caption = "<b>◈ پنل کاربر | Kronos Guard</b>";
    const warning = appendUserPanelRefreshError(caption);
    expect(warning).toContain(`<b>${USER_PANEL_REFRESH_ERROR_TEXT}</b>`);
    expect(appendUserPanelRefreshError(warning)).toBe(warning);
  });
});
