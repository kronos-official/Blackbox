import { describe, expect, it, vi } from "vitest";
import { beginNumericIdConversion, handleNativeNumericIdSelection, handleNumericIdAction, handleNumericIdText, resolveEntity, resetNumericIdConversionForTests } from "./numericIdConversion";

describe("numeric ID conversion resolver", () => {
  it("turns a native users_shared update into the staged confirmation", async () => {
    resetNumericIdConversionForTests();
    const replies: unknown[] = [];
    const ctx = {
      chat: { type: "private", id: 9 },
      from: { id: 9 },
      reply: vi.fn(async (...args: unknown[]) => { replies.push(args); return { message_id: 1 }; }),
      editMessageText: vi.fn(async () => ({ message_id: 1 })),
      answerCbQuery: vi.fn(async () => undefined),
    };
    await beginNumericIdConversion(ctx);
    await handleNumericIdAction({ ...ctx, callbackQuery: { data: "numeric-id:user" } });
    await handleNativeNumericIdSelection({ ...ctx, message: { users_shared: { request_id: 7101, user_ids: [4242] } } });
    const confirmation = replies.find(reply => String((reply as unknown[])[0]).includes("تأیید استخراج آیدی"));
    expect(confirmation).toBeDefined();
    expect(confirmation?.[1 as keyof typeof confirmation]).toMatchObject({ reply_markup: { inline_keyboard: expect.any(Array) } });
  });

  it("turns a native chat_shared update into the staged confirmation", async () => {
    resetNumericIdConversionForTests();
    const replies: unknown[] = [];
    const ctx = {
      chat: { type: "private", id: 10 },
      from: { id: 10 },
      reply: vi.fn(async (...args: unknown[]) => { replies.push(args); return { message_id: 1 }; }),
      editMessageText: vi.fn(async () => ({ message_id: 1 })),
      answerCbQuery: vi.fn(async () => undefined),
    };
    await beginNumericIdConversion(ctx);
    await handleNumericIdAction({ ...ctx, callbackQuery: { data: "numeric-id:channel" } });
    await handleNativeNumericIdSelection({ ...ctx, message: { chat_shared: { request_id: 7104, chat_id: -1004242 } } });
    const confirmation = replies.find(reply => String((reply as unknown[])[0]).includes("تأیید استخراج آیدی"));
    expect(confirmation).toBeDefined();
    expect(JSON.stringify(confirmation)).toContain("numeric-confirm:yes:channel:-1004242");
  });
  it("returns Telegram's numeric ID for a public channel reference", async () => {
    const getChat = vi.fn().mockResolvedValue({
      id: -1001234567890,
      type: "channel",
      title: "Kronos Updates",
      username: "kronos_updates",
      description: "Updates",
    });

    const entity = await resolveEntity({ telegram: { getChat } }, "kronos_updates", "channel");

    expect(entity).toMatchObject({
      id: -1001234567890,
      kind: "channel",
      username: "kronos_updates",
      source: "telegram",
    });
    expect(entity?.id).not.toBe("kronos_updates");
    expect(getChat).toHaveBeenCalledWith("@kronos_updates");
  });

  it("includes Telegram name, username, and bio when resolving a user", async () => {
    const getChat = vi.fn().mockResolvedValue({
      id: 4242,
      type: "private",
      first_name: "Sara",
      last_name: "Kronos",
      username: "sara_kronos",
      bio: "Kronos Guard tester",
    });
    const entity = await resolveEntity({ telegram: { getChat } }, "4242", "user");

    expect(entity).toMatchObject({
      id: 4242,
      kind: "user",
      name: "Sara Kronos",
      username: "sara_kronos",
      bio: "Kronos Guard tester",
      source: "telegram",
    });
  });

  it("returns a shared numeric ID even when Telegram metadata is unavailable", async () => {
    const getChat = vi.fn().mockRejectedValue(new Error("Bad Request: chat not found"));
    const entity = await resolveEntity({ telegram: { getChat } }, "-1009876543210", "channel");

    expect(entity).toMatchObject({ id: -1009876543210, kind: "channel", source: "telegram" });
    expect(entity?.name).toContain("در دسترس نیست");
  });

  it("cancels native picker state from the reply-keyboard text button", async () => {
    resetNumericIdConversionForTests();
    const replies: unknown[] = [];
    const ctx = {
      chat: { type: "private", id: 12 },
      from: { id: 12 },
      message: { text: "لغو عملیات" },
      reply: vi.fn(async (...args: unknown[]) => { replies.push(args); return { message_id: 1 }; }),
    };

    expect(await handleNumericIdText(ctx)).toBe(true);
    expect(replies[0]?.[0]).toContain("عملیات استخراج آیدی لغو شد");
    expect(replies[0]?.[1]).toMatchObject({ reply_markup: { keyboard: [["استخراج آیدی"]], resize_keyboard: true, is_persistent: true } });
  });

  it("returns null rather than echoing an unresolved username", async () => {
    const getChat = vi.fn().mockRejectedValue(new Error("Bad Request: chat not found"));
    const entity = await resolveEntity({ telegram: { getChat } }, "missing_target", "group");

    expect(entity).toBeNull();
  });
});
