import { describe, expect, it } from "vitest";
import { beforeEach, vi } from "vitest";
import { handleTagCallback, handleTagCommand, handleTagConfirmation, handleTagDraftInput, isExactTagCommand, isInvalidTagIdentity, isValidTagDraft, parseTagCountInput, parseTagExclusionTokens, tagAnnouncementHeader, tagExclusionPrompt, tagFormCancelKeyboard, tagLink, tagPanelKeyboard, tagReplyOptions, toEnglishDigits } from "./groupTagging";

vi.mock("./authorization", () => ({
  hasAtLeastAccess: vi.fn(() => true),
  resolveAccessLevel: vi.fn(async () => "moderator"),
}));

vi.mock("./repository", () => ({
  findGroupByChatId: vi.fn(async () => ({ id: 1 })),
  writeAuditLog: vi.fn(async () => undefined),
}));

describe("group tag command grammar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("recognizes only exact tag commands", () => {
    expect(isExactTagCommand("تگ")).toBe(true);
    expect(isExactTagCommand("/tag")).toBe(true);
    expect(isExactTagCommand("تگ کن همه رو")).toBe(false);
    expect(isExactTagCommand("لطفاً تگ")).toBe(false);
  });

  it("bounds custom batch sizes and exclusion grammar", () => {
    expect(parseTagCountInput("1")).toBe(1);
    expect(parseTagCountInput("200")).toBe(200);
    expect(parseTagCountInput("201")).toBeUndefined();
    expect(parseTagCountInput("50 نفر")).toBeUndefined();
    expect(parseTagExclusionTokens("@KronosMember، 123456789 @KronosMember")).toEqual(["@KronosMember", "123456789"]);
  });

  it("renders tag controls and prompts with English digits only", () => {
    expect(tagExclusionPrompt()).toBe("شناسه یا @username افراد استثنا را بفرستید. حداکثر 50 نفر.");
    expect(tagExclusionPrompt()).not.toContain("برای لغو");
    expect(tagExclusionPrompt()).not.toMatch(/[۰-۹]/);
    expect(toEnglishDigits("تعداد ۵۰ و شناسه ۱۲۳۴۵۶")).toBe("تعداد 50 و شناسه 123456");
    expect(toEnglishDigits("العدد ٥٠ والمعرّف ١٢٣٤٥٦")).toBe("العدد 50 والمعرّف 123456");
  });

  it("renders a red cancel button for text-input tag forms", () => {
    const rows = (tagFormCancelKeyboard() as { reply_markup?: { inline_keyboard?: Array<Array<Record<string, unknown>>> } }).reply_markup?.inline_keyboard ?? [];
    expect(rows).toEqual([[expect.objectContaining({ text: "لغو", callback_data: "tag:cancel", style: "danger" })]]);
  });

  it("keeps selection methods neutral and colors only final actions", () => {
    const rows = (tagPanelKeyboard() as { reply_markup?: { inline_keyboard?: Array<Array<Record<string, unknown>>> } }).reply_markup?.inline_keyboard ?? [];
    expect(rows.slice(0, 5).flat().every(button => !button.style)).toBe(true);
    expect(rows).toHaveLength(6);
    expect(rows[5]?.[0]?.style).toBe("danger");
  });

  it("requires the exact reference message when a tag draft was opened from a reply", () => {
    expect(tagReplyOptions(4242)).toEqual({
      reply_parameters: { message_id: 4242, allow_sending_without_reply: false },
      reply_to_message_id: 4242,
    });
    expect(tagReplyOptions(undefined)).toEqual({});
    expect(tagReplyOptions(0)).toEqual({});
  });

  it("renders a concise announcement header without literal escape sequences", () => {
    expect(tagAnnouncementHeader(0)).toBe("<b>اعلان تگ اعضای گروه</b>\n\n");
    expect(tagAnnouncementHeader(1)).toBe("");
    expect(tagAnnouncementHeader(0)).not.toContain("\\n");
  });

  it("renders only the original display identity inside a safe Telegram mention", () => {
    expect(tagLink({ telegramUserId: 42, username: null, firstName: "سارا", lastName: null, isBot: false, kronosTitle: "مدیر ارشد" })).toBe('<a href="tg://user?id=42">سارا</a>');
    expect(tagLink({ telegramUserId: 43, username: null, firstName: "<سارا>", lastName: null, isBot: false, kronosTitle: "A&B" })).toBe('<a href="tg://user?id=43">&lt;سارا&gt;</a>');
  });

  it("rejects service, bot, and Telegram identities from tag recipients", () => {
    expect(isInvalidTagIdentity({ telegramUserId: 777000, username: null, firstName: "Telegram", isBot: false })).toBe(true);
    expect(isInvalidTagIdentity({ telegramUserId: 8, username: "Telegram", firstName: "Service", isBot: false })).toBe(true);
    expect(isInvalidTagIdentity({ telegramUserId: 9, username: "real_user", firstName: "Real", isBot: true })).toBe(true);
    expect(isInvalidTagIdentity({ telegramUserId: 10, username: "real_user", firstName: "Real", isBot: false })).toBe(false);
  });

  it("rejects corrupted drafts before mode is read by callback handlers", () => {
    expect(isValidTagDraft(undefined)).toBe(false);
    expect(isValidTagDraft({ requestedCount: 50, excludedTelegramIds: [], step: "selecting", expiresAt: Date.now() })).toBe(false);
    expect(isValidTagDraft({ mode: "members", requestedCount: 50, excludedTelegramIds: [], step: "selecting", expiresAt: Date.now() })).toBe(true);
    expect(isValidTagDraft({ mode: "members", requestedCount: 50, excludedTelegramIds: [], step: "selecting", expiresAt: Date.now(), replyToMessageId: 4242 })).toBe(true);
    expect(isValidTagDraft({ mode: "members", requestedCount: 50, excludedTelegramIds: [], step: "selecting", expiresAt: Date.now(), replyToMessageId: 0 })).toBe(false);
  });

  it("deletes the selection menu and sends callback prompts through Telegram when reply is unavailable", async () => {
    const sentMessages: Array<{ chatId: number; text: string }> = [];
    const commandContext = {
      chat: { id: -100123, type: "supergroup" },
      from: { id: 7 },
      message: { text: "تگ" },
      telegram: {
        getChatMember: vi.fn(async () => ({ status: "administrator" })),
        sendMessage: vi.fn(async (chatId: number, text: string) => {
          sentMessages.push({ chatId, text });
        }),
        deleteMessage: vi.fn(async () => undefined),
      },
      reply: vi.fn(async () => undefined),
    };

    await expect(handleTagCommand(commandContext)).resolves.toBe(true);

    const deleteMessage = vi.fn(async () => undefined);
    const callbackContext = {
      chat: commandContext.chat,
      from: commandContext.from,
      callbackQuery: { data: "tag:custom" },
      telegram: commandContext.telegram,
      answerCbQuery: vi.fn(async () => undefined),
      editMessageText: vi.fn(async () => undefined),
      deleteMessage,
    };

    await expect(handleTagCallback(callbackContext)).resolves.toBe(true);
    expect(deleteMessage).toHaveBeenCalledTimes(1);
    expect(commandContext.telegram.sendMessage).toHaveBeenCalledWith(
      commandContext.chat.id,
      expect.stringContaining("تعداد عضوهای موردنظر"),
      expect.objectContaining({ reply_markup: expect.objectContaining({ inline_keyboard: [[expect.objectContaining({ text: "لغو", callback_data: "tag:cancel", style: "danger" })]] }) }),
    );
    expect(sentMessages.at(-1)?.chatId).toBe(commandContext.chat.id);
    expect(sentMessages.at(-1)?.text).not.toContain("برای لغو");
    expect(callbackContext).not.toHaveProperty("reply");
  });

  it("asks for confirmation before executing a selected tag method and uses role-style colors", async () => {
    const commandContext = {
      chat: { id: -100321, type: "supergroup" },
      from: { id: 17 },
      message: { text: "تگ" },
      telegram: {
        getChatMember: vi.fn(async () => ({ status: "administrator" })),
        sendMessage: vi.fn(async () => ({ message_id: 800 })),
        deleteMessage: vi.fn(async () => undefined),
      },
      reply: vi.fn(async () => ({ message_id: 700 })),
    };
    await handleTagCommand(commandContext);
    const selection = {
      chat: commandContext.chat,
      from: commandContext.from,
      callbackQuery: { data: "tag:50" },
      telegram: commandContext.telegram,
      answerCbQuery: vi.fn(async () => undefined),
      editMessageText: vi.fn(async () => undefined),
      deleteMessage: vi.fn(async () => undefined),
    };
    await expect(handleTagCallback(selection)).resolves.toBe(true);
    const confirmationCall = commandContext.telegram.sendMessage.mock.calls.find(call => String(call[1]).includes("تأیید اجرای تگ"));
    expect(confirmationCall?.[1]).toContain("50 عضو فعال");
    const markup = (confirmationCall?.[2] as { reply_markup?: { inline_keyboard?: Array<Array<Record<string, unknown>>> } } | undefined)?.reply_markup;
    expect(markup?.inline_keyboard?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "خیر", style: "danger" }),
      expect.objectContaining({ text: "بله", style: "success" }),
    ]));
  });

  it("deletes the form and briefly shows then removes the cancellation notice from the button flow", async () => {
    vi.useFakeTimers();
    try {
      let nextMessageId = 500;
      const sendMessage = vi.fn(async () => ({ message_id: ++nextMessageId }));
      const telegram = {
        getChatMember: vi.fn(async () => ({ status: "administrator" })),
        sendMessage,
        deleteMessage: vi.fn(async () => undefined),
      };
      const commandContext = { chat: { id: -100777, type: "supergroup" }, from: { id: 31 }, message: { text: "تگ" }, telegram, reply: vi.fn(async () => ({ message_id: 499 })) };
      await handleTagCommand(commandContext);
      await handleTagCallback({ chat: commandContext.chat, from: commandContext.from, callbackQuery: { data: "tag:custom" }, telegram, answerCbQuery: vi.fn(async () => undefined), editMessageText: vi.fn(async () => undefined), deleteMessage: vi.fn(async () => undefined) });
      const cancel = { chat: commandContext.chat, from: commandContext.from, callbackQuery: { data: "tag:cancel" }, telegram, answerCbQuery: vi.fn(async () => undefined), editMessageText: vi.fn(async () => undefined), deleteMessage: vi.fn(async () => undefined) };
      await expect(handleTagCallback(cancel)).resolves.toBe(true);
      expect(cancel.deleteMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenLastCalledWith(commandContext.chat.id, "عملیات لغو شد");
      vi.advanceTimersByTime(2999);
      await Promise.resolve();
      expect(telegram.deleteMessage).not.toHaveBeenCalledWith(commandContext.chat.id, 502);
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      expect(telegram.deleteMessage).toHaveBeenCalledWith(commandContext.chat.id, 502);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the form message and shows the temporary notice when لغو is sent as text", async () => {
    vi.useFakeTimers();
    try {
      let nextMessageId = 600;
      const telegram = {
        getChatMember: vi.fn(async () => ({ status: "administrator" })),
        sendMessage: vi.fn(async () => ({ message_id: ++nextMessageId })),
        deleteMessage: vi.fn(async () => undefined),
      };
      const commandContext = { chat: { id: -100778, type: "supergroup" }, from: { id: 32 }, message: { text: "تگ" }, telegram, reply: vi.fn(async () => ({ message_id: 599 })) };
      await handleTagCommand(commandContext);
      await handleTagCallback({ chat: commandContext.chat, from: commandContext.from, callbackQuery: { data: "tag:exclude" }, telegram, answerCbQuery: vi.fn(async () => undefined), editMessageText: vi.fn(async () => undefined), deleteMessage: vi.fn(async () => undefined) });
      const inputContext = { chat: commandContext.chat, from: commandContext.from, message: { text: "لغو" }, telegram, reply: vi.fn(async () => undefined) };
      await expect(handleTagDraftInput(inputContext)).resolves.toBe(true);
      expect(telegram.deleteMessage).toHaveBeenCalledWith(commandContext.chat.id, 601);
      expect(telegram.sendMessage).toHaveBeenLastCalledWith(commandContext.chat.id, "عملیات لغو شد");
      vi.advanceTimersByTime(2999);
      await Promise.resolve();
      expect(telegram.deleteMessage).not.toHaveBeenCalledWith(commandContext.chat.id, 602);
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      expect(telegram.deleteMessage).toHaveBeenCalledWith(commandContext.chat.id, 602);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not execute a pending tag after the user chooses no", async () => {
    const commandContext = {
      chat: { id: -100654, type: "supergroup" },
      from: { id: 19 },
      message: { text: "تگ" },
      telegram: {
        getChatMember: vi.fn(async () => ({ status: "administrator" })),
        sendMessage: vi.fn(async () => ({ message_id: 900 })),
        deleteMessage: vi.fn(async () => undefined),
      },
      reply: vi.fn(async () => ({ message_id: 901 })),
    };
    await handleTagCommand(commandContext);
    await handleTagCallback({ chat: commandContext.chat, from: commandContext.from, callbackQuery: { data: "tag:50" }, telegram: commandContext.telegram, answerCbQuery: vi.fn(async () => undefined), editMessageText: vi.fn(async () => undefined), deleteMessage: vi.fn(async () => undefined) });
    const confirmation = commandContext.telegram.sendMessage.mock.calls.find(call => String(call[1]).includes("تأیید اجرای تگ"));
    const markup = (confirmation?.[2] as { reply_markup?: { inline_keyboard?: Array<Array<{ callback_data?: string }>> } } | undefined)?.reply_markup;
    const callbackData = markup?.inline_keyboard?.[0]?.[0]?.callback_data;
    expect(callbackData).toEqual(expect.stringMatching(/^tag-confirm:no:/));
    const cancel = { chat: commandContext.chat, from: commandContext.from, callbackQuery: { data: callbackData }, telegram: commandContext.telegram, answerCbQuery: vi.fn(async () => undefined), editMessageText: vi.fn(async () => undefined), deleteMessage: vi.fn(async () => undefined) };
    await expect(handleTagConfirmation(cancel)).resolves.toBe(true);
    expect(cancel.editMessageText).toHaveBeenCalledWith("اجرای تگ لغو شد.");
    expect(commandContext.telegram.sendMessage).toHaveBeenCalledTimes(1);
  });
});
