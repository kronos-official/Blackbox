import { describe, expect, it, vi } from "vitest";
import { deleteTemporaryCommandSuccess, telegramMessageId } from "./temporarySuccess";

describe("temporary command success deletion", () => {
  it("deletes a success acknowledgement after the configured short delay", async () => {
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(deleteTemporaryCommandSuccess({ telegram: { deleteMessage } as never, chatId: -1007, messageId: 71, delayMs: 3_000, wait })).resolves.toBe(true);
    expect(wait).toHaveBeenCalledWith(3_000);
    expect(deleteMessage).toHaveBeenCalledWith(-1007, 71);
  });

  it("does not attempt deletion without a Telegram message identity and tolerates a later Telegram rejection", async () => {
    const deleteMessage = vi.fn().mockRejectedValue(new Error("message no longer exists"));
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(deleteTemporaryCommandSuccess({ telegram: { deleteMessage } as never, chatId: -1007, wait })).resolves.toBe(false);
    expect(wait).not.toHaveBeenCalled();
    expect(deleteMessage).not.toHaveBeenCalled();
    await expect(deleteTemporaryCommandSuccess({ telegram: { deleteMessage } as never, chatId: -1007, messageId: 72, wait })).resolves.toBe(false);
  });

  it("extracts only a valid Telegram message ID", () => {
    expect(telegramMessageId({ message_id: 31 })).toBe(31);
    expect(telegramMessageId({ message_id: "31" })).toBeUndefined();
    expect(telegramMessageId(undefined)).toBeUndefined();
  });
});
