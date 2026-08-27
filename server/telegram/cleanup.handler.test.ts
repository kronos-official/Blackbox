import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repository", () => ({ findGroupByChatId: vi.fn(), listRecentGroupMessageIds: vi.fn(), removeRecentGroupMessageIds: vi.fn(), writeAuditLog: vi.fn() }));
vi.mock("./authorization", async importOriginal => {
  const actual = await importOriginal<typeof import("./authorization")>();
  return { ...actual, resolveAccessLevel: vi.fn() };
});
vi.mock("./retry", () => ({ withTelegramRetry: vi.fn(async (work: () => unknown) => work()) }));

import { resolveAccessLevel } from "./authorization";
import { canBotDeleteGroupMessages, classifyCleanupDeleteFailure, handleCleanupCommand, handleCleanupConfirmation } from "./cleanup";
import { findGroupByChatId, listRecentGroupMessageIds, removeRecentGroupMessageIds, writeAuditLog } from "./repository";

function context(text: string) {
  return {
    chat: { id: -1008, type: "supergroup", title: "Kronos" },
    from: { id: 9001, is_bot: false },
    message: { text, message_id: 50 },
    telegram: {
      getMe: vi.fn(async () => ({ id: 7001 })),
      getChatMember: vi.fn(async () => ({ status: "administrator", can_delete_messages: true })),
      deleteMessage: vi.fn(async () => undefined),
    },
    reply: vi.fn(async () => ({ message_id: 61 })),
    answerCbQuery: vi.fn(async () => undefined),
    editMessageText: vi.fn(async () => undefined),
  } as any;
}

function confirmationData(ctx: any, decision: "yes" | "no" = "yes") {
  const confirmation = ctx.reply.mock.calls.find(([text]: [string]) => text.includes("تأیید پاک‌سازی"));
  const buttons = confirmation?.[1]?.reply_markup?.inline_keyboard?.flat?.() ?? [];
  const button = buttons.find((item: { callback_data?: string }) => item.callback_data?.startsWith(`cleanup-confirm:${decision}:`));
  return button?.callback_data as string;
}

async function confirmCleanup(ctx: any, decision: "yes" | "no" = "yes") {
  ctx.callbackQuery = { data: confirmationData(ctx, decision) };
  return handleCleanupConfirmation(ctx);
}

describe("bounded administrator cleanup handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findGroupByChatId).mockResolvedValue({ id: 8, chatId: -1008, title: "Kronos" } as any);
    vi.mocked(listRecentGroupMessageIds).mockResolvedValue([50, 44, 39]);
  });

  it("shows confirmation first, then deletes a bounded message-ID window including bot messages absent from observed history", async () => {
    vi.mocked(resolveAccessLevel).mockResolvedValue("moderator" as never);
    const ctx = context("حذف 3");

    await expect(handleCleanupCommand(ctx)).resolves.toBe(true);

    expect(ctx.telegram.deleteMessage).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("3 پیام برای 3 حذف درخواستی"), expect.any(Object));
    expect(confirmationData(ctx)).toMatch(/^cleanup-confirm:yes:/);
    await expect(confirmCleanup(ctx)).resolves.toBe(true);
    expect(ctx.telegram.deleteMessage).toHaveBeenNthCalledWith(1, -1008, 50);
    expect(ctx.telegram.deleteMessage).toHaveBeenNthCalledWith(2, -1008, 49);
    expect(ctx.telegram.deleteMessage).toHaveBeenNthCalledWith(3, -1008, 48);
    expect(removeRecentGroupMessageIds).toHaveBeenCalledWith(8, [50, 49, 48]);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      event: "bulk_delete",
      details: {
        requested: 3,
        candidatesStored: 28,
        attempted: 3,
        deleted: 3,
        failed: 0,
        unavailable: 0,
        firstFailure: undefined,
        rejectedMessageIds: [],
      },
    }));
  });

  it("uses a later candidate when Telegram rejects a recent bot or system message", async () => {
    vi.mocked(resolveAccessLevel).mockResolvedValue("moderator" as never);
    const ctx = context("حذف 3");
    ctx.telegram.deleteMessage.mockImplementation(async (_chatId: number, messageId: number) => {
      if (messageId === 49) throw { response: { description: "Bad Request: message can't be deleted" } };
    });

    await handleCleanupCommand(ctx);
    await expect(confirmCleanup(ctx)).resolves.toBe(true);

    expect(ctx.telegram.deleteMessage).toHaveBeenCalledTimes(4);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ requested: 3, deleted: 3, failed: 1, firstFailure: "too_old_or_unsupported", rejectedMessageIds: [{ messageId: 49, failure: "too_old_or_unsupported" }] }) }));
    expect(ctx.telegram.deleteMessage).toHaveBeenLastCalledWith(-1008, 47);
    expect(ctx.editMessageText).toHaveBeenCalledWith("✅ 3 پیام حذف شد.");
  });

  it("uses an older valid observed message when a newer Telegram message is already gone", async () => {
    vi.mocked(resolveAccessLevel).mockResolvedValue("moderator" as never);
    const ctx = context("حذف 3");
    ctx.telegram.deleteMessage.mockImplementation(async (_chatId: number, messageId: number) => {
      if (messageId === 49) throw { response: { description: "Bad Request: message to delete not found" } };
    });

    await handleCleanupCommand(ctx);
    await confirmCleanup(ctx);

    expect(ctx.telegram.deleteMessage).toHaveBeenCalledTimes(4);
    expect(ctx.telegram.deleteMessage).toHaveBeenLastCalledWith(-1008, 47);
    expect(removeRecentGroupMessageIds).toHaveBeenCalledWith(8, [50, 49, 48, 47]);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ requested: 3, deleted: 3, failed: 1, unavailable: 0, firstFailure: "not_found", rejectedMessageIds: [{ messageId: 49, failure: "not_found" }] }) }));
    expect(ctx.editMessageText).toHaveBeenCalledWith("✅ 3 پیام حذف شد.");
  });

  it("reports an accurate partial result when Telegram rejects every non-command ID in the recent window", async () => {
    vi.mocked(resolveAccessLevel).mockResolvedValue("moderator" as never);
    const ctx = context("حذف 3");
    ctx.telegram.deleteMessage.mockImplementation(async (_chatId: number, messageId: number) => {
      if (messageId !== 50) throw { response: { description: "Bad Request: message can't be deleted" } };
    });

    await handleCleanupCommand(ctx);
    await confirmCleanup(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("3 پیام برای 3 حذف درخواستی"), expect.any(Object));
    expect(ctx.telegram.deleteMessage).toHaveBeenCalledTimes(28);
    expect(ctx.editMessageText).toHaveBeenCalledWith("⚠️ 1 پیام حذف شد.");
  });

  it("still offers cleanup when observed history is empty because third-party bot messages may not be tracked", async () => {
    vi.mocked(resolveAccessLevel).mockResolvedValue("moderator" as never);
    vi.mocked(listRecentGroupMessageIds).mockResolvedValue([]);
    const ctx = context("حذف 3");

    await expect(handleCleanupCommand(ctx)).resolves.toBe(true);

    expect(confirmationData(ctx)).toMatch(/^cleanup-confirm:yes:/);
    expect(ctx.telegram.deleteMessage).not.toHaveBeenCalled();
  });

  it("requires the bot's delete-messages right instead of offering a confirm action it cannot fulfill", async () => {
    vi.mocked(resolveAccessLevel).mockResolvedValue("group_admin" as never);
    const ctx = context("حذف 3");
    ctx.telegram.getChatMember.mockResolvedValue({ status: "administrator", can_delete_messages: false });

    await expect(handleCleanupCommand(ctx)).resolves.toBe(true);

    expect(ctx.telegram.deleteMessage).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("حذف پیام‌ها"));
  });

  it("recognizes only owners and administrators with the exact Telegram deletion right", () => {
    expect(canBotDeleteGroupMessages({ status: "administrator", can_delete_messages: true })).toBe(true);
    expect(canBotDeleteGroupMessages({ status: "administrator", can_delete_messages: false })).toBe(false);
    expect(canBotDeleteGroupMessages({ status: "member" })).toBe(false);
  });

  it("classifies definitive Telegram delete failures for a useful cleanup outcome", () => {
    expect(classifyCleanupDeleteFailure({ response: { description: "Bad Request: message can't be deleted" } })).toBe("too_old_or_unsupported");
    expect(classifyCleanupDeleteFailure({ response: { description: "Forbidden: not enough rights" } })).toBe("permission");
    expect(classifyCleanupDeleteFailure({ response: { description: "Bad Request: message to delete not found" } })).toBe("not_found");
  });

  it("denies a regular member without attempting deletion or creating confirmation", async () => {
    vi.mocked(resolveAccessLevel).mockResolvedValue("user" as never);
    const ctx = context("delete 3");
    await expect(handleCleanupCommand(ctx)).resolves.toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("مدیران مجاز"));
    expect(ctx.telegram.deleteMessage).not.toHaveBeenCalled();
    expect(confirmationData(ctx)).toBeUndefined();
  });

  it("lets only the requesting actor confirm and preserves the pending action after an intruder attempt", async () => {
    vi.mocked(resolveAccessLevel).mockResolvedValue("moderator" as never);
    const ctx = context("حذف 3");
    await handleCleanupCommand(ctx);
    const token = confirmationData(ctx);

    ctx.from = { id: 9002, is_bot: false };
    ctx.callbackQuery = { data: token };
    await expect(handleCleanupConfirmation(ctx)).resolves.toBe(true);
    expect(ctx.telegram.deleteMessage).not.toHaveBeenCalled();
    expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining("برای شما نیست"), { show_alert: true });

    ctx.from = { id: 9001, is_bot: false };
    await expect(confirmCleanup(ctx)).resolves.toBe(true);
    expect(ctx.telegram.deleteMessage).toHaveBeenCalledTimes(3);
  });

  it("consumes a confirmation token after one execution to prevent replay", async () => {
    vi.mocked(resolveAccessLevel).mockResolvedValue("moderator" as never);
    const ctx = context("حذف 3");
    await handleCleanupCommand(ctx);
    const token = confirmationData(ctx);
    await confirmCleanup(ctx);
    expect(ctx.telegram.deleteMessage).toHaveBeenCalledTimes(3);

    ctx.callbackQuery = { data: token };
    await expect(handleCleanupConfirmation(ctx)).resolves.toBe(true);
    expect(ctx.telegram.deleteMessage).toHaveBeenCalledTimes(3);
  });

  it("cancels cleanup with the red cancellation action without deleting any message", async () => {
    vi.mocked(resolveAccessLevel).mockResolvedValue("moderator" as never);
    const ctx = context("حذف 3");
    await handleCleanupCommand(ctx);
    await expect(confirmCleanup(ctx, "no")).resolves.toBe(true);
    expect(ctx.telegram.deleteMessage).not.toHaveBeenCalled();
    expect(ctx.editMessageText).toHaveBeenCalledWith("پاک‌سازی لغو شد.");
  });

  it("expires a confirmation after 60 seconds and rejects the delayed callback", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(resolveAccessLevel).mockResolvedValue("moderator" as never);
      const ctx = context("حذف 3");
      await handleCleanupCommand(ctx);
      const token = confirmationData(ctx);
      await vi.advanceTimersByTimeAsync(60_001);
      ctx.callbackQuery = { data: token };
      await expect(handleCleanupConfirmation(ctx)).resolves.toBe(true);
      expect(ctx.telegram.deleteMessage).toHaveBeenCalledWith(-1008, 61);
      expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining("منقضی"), { show_alert: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not handle malformed, zero, or over-limit cleanup requests", async () => {
    vi.mocked(resolveAccessLevel).mockResolvedValue("group_admin" as never);
    for (const text of ["حذف 0", "delete 101", "clear many"]) {
      const ctx = context(text);
      await expect(handleCleanupCommand(ctx)).resolves.toBe(false);
      expect(ctx.telegram.deleteMessage).not.toHaveBeenCalled();
      expect(ctx.reply).not.toHaveBeenCalled();
    }
  });
});
