import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPersistentKeyboardHandlers, PERSISTENT_KEYBOARD_ACTIONS, QUICK_HELP_MESSAGE, type PersistentKeyboardContext } from "./persistentKeyboard";

function privateContext() {
  const reply = vi.fn(async () => ({ message_id: 1 }));
  return { chat: { type: "private" }, from: { id: 42 }, reply } as unknown as PersistentKeyboardContext & { reply: ReturnType<typeof vi.fn> };
}

describe("persistent keyboard handlers", () => {
  const originalPublicBaseUrl = process.env.TELEGRAM_PUBLIC_BASE_URL;
  const keyboard = vi.fn(() => ({ reply_markup: { keyboard: [["پنل مدیریت"]] } })) as never;
  const getLocale = vi.fn(async () => "fa");
  const languagePrompt = vi.fn(() => "زبان دلخواه خود را انتخاب کنید");
  const languageSelector = vi.fn(() => ({ reply_markup: { inline_keyboard: [[{ text: "فارسی", callback_data: "language:fa" }]] } })) as never;
  const handlers = createPersistentKeyboardHandlers({ getLocale, languagePrompt, languageSelector, keyboard });

  beforeEach(() => {
    process.env.TELEGRAM_PUBLIC_BASE_URL = "https://kronos-guard.manus.space";
  });

  afterEach(() => {
    if (originalPublicBaseUrl === undefined) delete process.env.TELEGRAM_PUBLIC_BASE_URL;
    else process.env.TELEGRAM_PUBLIC_BASE_URL = originalPublicBaseUrl;
  });

  it.each([
    [PERSISTENT_KEYBOARD_ACTIONS.dashboard, "کنترل سنتر از دکمهٔ Menu"],
    [PERSISTENT_KEYBOARD_ACTIONS.help, "راهنمای کامل Kronos Guard"],
    [PERSISTENT_KEYBOARD_ACTIONS.membership, "وضعیت عضویت"],
    [PERSISTENT_KEYBOARD_ACTIONS.language, "زبان دلخواه خود را انتخاب کنید"],
    [PERSISTENT_KEYBOARD_ACTIONS.forcedJoin, "عضویت اجباری"],
    [PERSISTENT_KEYBOARD_ACTIONS.about, "دربارهٔ ما"],
    [PERSISTENT_KEYBOARD_ACTIONS.support, "پشتیبانی Kronos Guard"],
  ] as const)("replies with the intended persistent response for %s", async (action, expectedText) => {
    const ctx = privateContext();
    await handlers[action](ctx);

    expect(ctx.reply).toHaveBeenCalledOnce();
    expect(ctx.reply.mock.calls[0]?.[0]).toContain(expectedText);
    expect(ctx.reply.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ reply_markup: expect.any(Object) }));
  });

  it("documents staff-console controls and lock-policy rollback in the bot help", async () => {
    const ctx = privateContext();
    await handlers[PERSISTENT_KEYBOARD_ACTIONS.help](ctx);

    const message = ctx.reply.mock.calls[0]?.[0] ?? "";
    expect(message).toContain("کنترل سنتر کارکنان");
    expect(message).toContain("پروفایل‌های قفل");
    expect(message).toContain("بازگردانی وضعیت قبلی");
  });

  it("documents Persian anti-raid controls in the complete help message", () => {
    expect(QUICK_HELP_MESSAGE).toContain("ضدحمله روشن");
    expect(QUICK_HELP_MESSAGE).toContain("ضدحمله وضعیت");
  });

  it.each(Object.values(PERSISTENT_KEYBOARD_ACTIONS))("does not reply to %s in a group chat", async action => {
    const reply = vi.fn();
    const ctx = { chat: { type: "group" }, from: { id: 42 }, reply } as unknown as PersistentKeyboardContext;
    await handlers[action](ctx);

    expect(reply).not.toHaveBeenCalled();
  });
});
