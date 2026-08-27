import { describe, expect, it } from "vitest";
import { formatStatisticsDateTime, formatStatisticsDay, formatStatisticsMetricLine, formatStatisticsRankLine, isValidStatisticsParticipant, nextStatisticsRun, participantMention, statisticsMenuKeyboard, statisticsMenuText, statisticsRangeStart, validateStatisticsSchedule } from "./statistics";

describe("statistics command", () => {
  it("uses the Persian statistics menu and all requested activity-report actions", () => {
    expect(statisticsMenuText).toContain("انتخاب نوع آمار");
    const keyboard = statisticsMenuKeyboard() as { reply_markup?: { inline_keyboard?: Array<Array<{ text?: string; callback_data?: string }>> } };
    const buttons = keyboard.reply_markup?.inline_keyboard?.flat() ?? [];
    expect(buttons.map(button => button.callback_data)).toEqual([
      "stats:top-daily",
      "stats:role-activity",
      "stats:top-invites",
      "stats:weekly",
      "stats:monthly",
      "stats:weekly-days",
      "stats:lifetime",
      "stats:custom",
      "stats:daily",
      "stats:close",
    ]);
    expect(buttons.some(button => button.text?.includes("30 نفر برتر فعالیت روزانه"))).toBe(true);
    expect(buttons.some(button => button.text?.includes("فعالیت کاربران مقام‌دار"))).toBe(true);
    expect(buttons.some(button => button.text?.includes("بازگشت به آمار روزانه"))).toBe(true);
  });

  it("calculates stable UTC windows for daily, weekly, and monthly reports", () => {
    const now = new Date("2026-08-18T12:00:00.000Z");
    expect(statisticsRangeStart("daily", now)).toBe("2026-08-17");
    expect(statisticsRangeStart("weekly-users", now)).toBe("2026-08-12");
    expect(statisticsRangeStart("weekly-leaders", now)).toBe("2026-08-12");
    expect(statisticsRangeStart("monthly", now)).toBe("2026-07-20");
  });

  it("accepts a complete custom schedule and rejects unsafe values", () => {
    expect(validateStatisticsSchedule({ frequency: "weekly", dayOfWeek: 5, dayOfMonth: 15, hour: 18, minute: 30, timezone: "Asia/Tehran" })).toBeNull();
    expect(validateStatisticsSchedule({ frequency: "daily", hour: 24, minute: 0, timezone: "UTC" })).toContain("ساعت");
    expect(validateStatisticsSchedule({ frequency: "daily", hour: 9, minute: 0, timezone: "" })).toContain("منطقه");
  });

  it("previews the next scheduled execution in the selected timezone", () => {
    const now = new Date("2026-08-18T06:30:00.000Z");
    expect(nextStatisticsRun({ frequency: "daily", dayOfWeek: 1, dayOfMonth: 1, hour: 9, minute: 0, timezone: "UTC", enabled: true }, now)).toMatchObject({ date: "2026-08-18", hour: 9, minute: 0, timezone: "UTC" });
    expect(nextStatisticsRun({ frequency: "weekly", dayOfWeek: 5, dayOfMonth: 1, hour: 9, minute: 0, timezone: "UTC", enabled: true }, now)?.date).toBe("2026-08-21");
  });

  it("formats the report timestamp in Persian locale while retaining English digits", () => {
    const value = formatStatisticsDateTime(new Date("2026-08-18T12:00:00.000Z"));
    expect(value).toContain("1405");
    expect(value).toContain("15:30");
    expect(value).not.toMatch(/[۰-۹]/);
  });

  it("renders weekly day labels in the Persian calendar with English digits", () => {
    const value = formatStatisticsDay("2026-08-18");
    expect(value).toContain("1405");
    expect(value).not.toMatch(/[۰-۹]/);
  });

  it("renders weekly day labels in the Persian calendar with English digits", () => {
    const value = formatStatisticsDay("2026-08-18");
    expect(value).toContain("1405");
    expect(value).not.toMatch(/[۰-۹]/);
  });

  it("orders daily, weekly, and monthly report dates as weekday, day, month, year", () => {
    expect(formatStatisticsDay("2026-08-20")).toBe("پنجشنبه 29 مرداد 1405");
    expect(formatStatisticsDay("2026-07-20")).toBe("دوشنبه 29 تیر 1405");
  });

  it("formats ranking lines with an emoji separator and keeps the real mention intact", () => {
    const line = formatStatisticsRankLine("🥇 نفر اول", '<a href="tg://user?id=9">نام نمایشی</a>', "پیام", "60");
    expect(line).toContain("🥇 نفر اول");
    expect(line).toContain("📌 پیام: <b>60</b>");
    expect(line).toContain('<a href="tg://user?id=9">نام نمایشی</a>');
    expect(line).not.toContain("┘─");
  });

  it("uses semantic emoji metric labels without tree separators", () => {
    const line = formatStatisticsMetricLine("💬", "پیام‌ها", "12");
    expect(line).toBe("💬 پیام‌ها: <b>12</b>");
    expect(line).not.toMatch(/[└├┘─]/);
  });

  it("uses a real Telegram user mention with the display name before a username", () => {
    const users = new Map([[9, { firstName: "نام", lastName: "نمایشی", username: "plainusername" }]]);
    const label = participantMention(9, users);
    expect(label).toBe('<a href="tg://user?id=9">نام نمایشی</a>');
  });

  it("excludes Telegram system records and unverified memberships from statistics rankings", () => {
    expect(isValidStatisticsParticipant(777000, { membershipStatus: "active", telegramRole: "unknown" })).toBe(false);
    expect(isValidStatisticsParticipant(91, { membershipStatus: "active", telegramRole: "unknown" })).toBe(false);
    expect(isValidStatisticsParticipant(91, { membershipStatus: "left", telegramRole: "member" })).toBe(false);
    expect(isValidStatisticsParticipant(91, { membershipStatus: "active", telegramRole: "member" })).toBe(true);
  });
});
