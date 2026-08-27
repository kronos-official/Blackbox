import { describe, expect, it, vi } from "vitest";
import { handleInlineControlCenterCallback, inlineControlCenterInfo, inlineControlCenterKeyboard, inlineControlCenterSectionKeyboard, isInlineControlCenterCallback } from "./inlineControlCenter";
import * as moderation from "./moderation";
import * as statistics from "./statistics";

vi.mock("./moderation", async () => {
  const actual = await vi.importActual<typeof import("./moderation")>("./moderation");
  return { ...actual, sendInlineSelfUserPanel: vi.fn().mockResolvedValue(true) };
});

vi.mock("./statistics", async () => {
  const actual = await vi.importActual<typeof import("./statistics")>("./statistics");
  return { ...actual, sendInlineStatisticsMenu: vi.fn().mockResolvedValue(true) };
});

describe("inline control center", () => {
  it("renders the main capability sections and Mini App entry point", () => {
    const keyboard = inlineControlCenterKeyboard(false, "https://kronos-guard.manus.space/dashboard").reply_markup.inline_keyboard;
    const labels = keyboard.flat().map(button => button.text);
    expect(labels).toContain("👥 مدیریت اعضا");
    expect(labels).toContain("📊 آمار و گزارش");
    expect(labels).toContain("🚀 باز کردن Mini App");
    expect(labels).not.toContain("👑 ابزارهای مالک");
  });

  it("only exposes the owner section when requested", () => {
    const keyboard = inlineControlCenterKeyboard(true).reply_markup.inline_keyboard;
    expect(keyboard.flat().map(button => button.text)).toContain("👑 ابزارهای مالک");
  });

  it("keeps callbacks namespaced and provides a safe back button", () => {
    expect(isInlineControlCenterCallback("cc:section:members")).toBe(true);
    expect(isInlineControlCenterCallback("stats:daily")).toBe(false);
    const keyboard = inlineControlCenterSectionKeyboard("members", false).reply_markup.inline_keyboard;
    expect(keyboard.at(-1)?.[0]).toMatchObject({ text: "↩️ بازگشت به کنترل سنتر", callback_data: "cc:home" });
  });

  it("executes the self user panel option directly from inline navigation", async () => {
    const ctx = {
      from: { id: 123456789 },
      callbackQuery: { data: "cc:info:members:0" },
      answerCbQuery: vi.fn(),
      reply: vi.fn(),
      editMessageText: vi.fn(),
    } as any;
    expect(await handleInlineControlCenterCallback(ctx)).toBe(true);
    expect(moderation.sendInlineSelfUserPanel).toHaveBeenCalledWith(ctx);
    expect(ctx.answerCbQuery).toHaveBeenCalledWith("در حال آماده‌سازی پنل شما…");
  });

  it("executes the statistics menu option directly from inline navigation", async () => {
    const ctx = {
      from: { id: 123456789 },
      callbackQuery: { data: "cc:info:stats:0" },
      answerCbQuery: vi.fn(),
      reply: vi.fn(),
      editMessageText: vi.fn(),
    } as any;
    expect(await handleInlineControlCenterCallback(ctx)).toBe(true);
    expect(statistics.sendInlineStatisticsMenu).toHaveBeenCalledWith(ctx);
    expect(ctx.answerCbQuery).toHaveBeenCalledWith("در حال آماده‌سازی منوی آمار…");
  });

  it("returns a localized capability explanation for a known option", () => {
    expect(inlineControlCenterInfo("members", 0)).toContain("پنل کاربر");
    expect(inlineControlCenterInfo("members", 999)).toContain("در حال حاضر");
  });

  it("rejects owner callbacks for non-owners without editing the message", async () => {
    const ctx = {
      from: { id: 123456789 },
      callbackQuery: { data: "cc:section:owner" },
      answerCbQuery: vi.fn(),
      editMessageText: vi.fn(),
    } as any;
    const handled = await handleInlineControlCenterCallback(ctx);
    expect(handled).toBe(true);
    expect(ctx.answerCbQuery).toHaveBeenCalledWith("این بخش فقط برای مالک ربات فعال است.", { show_alert: true });
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });
});
