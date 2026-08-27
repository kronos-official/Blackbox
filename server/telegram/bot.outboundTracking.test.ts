import { describe, expect, it, vi } from "vitest";
import { outboundTelegramMessageIds, recordOutboundGroupMessages } from "./bot";

describe("outbound Telegram message tracking", () => {
  it("extracts only message-bearing Telegram send responses", () => {
    expect(outboundTelegramMessageIds("sendMessage", { message_id: 71 })).toEqual([71]);
    expect(outboundTelegramMessageIds("sendMediaGroup", [{ message_id: 72 }, { message_id: 73 }])).toEqual([72, 73]);
    expect(outboundTelegramMessageIds("deleteMessage", true)).toEqual([]);
    expect(outboundTelegramMessageIds("sendMessage", { ok: true })).toEqual([]);
  });

  it("records bot-authored group messages so cleanup can target them later", async () => {
    const findGroupByChatId = vi.fn().mockResolvedValue({ id: 81, chatId: -10081 });
    const recordRecentGroupMessage = vi.fn().mockResolvedValue(undefined);
    const sentAt = new Date("2026-08-20T20:15:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(sentAt);

    try {
      await recordOutboundGroupMessages({
        method: "sendMessage",
        payload: { chat_id: -10081, text: "پیام Kronos Guard" },
        result: { message_id: 910 },
        findGroupByChatId,
        recordRecentGroupMessage,
      });

      expect(findGroupByChatId).toHaveBeenCalledWith(-10081);
      expect(recordRecentGroupMessage).toHaveBeenCalledWith({
        groupId: 81,
        messageId: 910,
        autoDeleteAt: new Date(sentAt.getTime() + 5 * 60 * 1000),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not register private messages or non-message API responses as group cleanup candidates", async () => {
    const findGroupByChatId = vi.fn();
    const recordRecentGroupMessage = vi.fn();

    await recordOutboundGroupMessages({
      method: "sendMessage",
      payload: { chat_id: "@public_channel", text: "اعلان" },
      result: { message_id: 911 },
      findGroupByChatId,
      recordRecentGroupMessage,
    });
    await recordOutboundGroupMessages({
      method: "deleteMessage",
      payload: { chat_id: -10081, message_id: 910 },
      result: true,
      findGroupByChatId,
      recordRecentGroupMessage,
    });

    expect(findGroupByChatId).not.toHaveBeenCalled();
    expect(recordRecentGroupMessage).not.toHaveBeenCalled();
  });
});
