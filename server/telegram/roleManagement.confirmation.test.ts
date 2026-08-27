import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("./repository", () => ({ findGroupByChatId: vi.fn(), recordRecentGroupMessage: vi.fn(), recordTelegramUser: vi.fn(), writeAuditLog: vi.fn() }));
vi.mock("./groupEventNotifier", () => ({ notifyGroupEvent: vi.fn() }));
vi.mock("./authorization", async importOriginal => {
  const actual = await importOriginal<typeof import("./authorization")>();
  return { ...actual, resolveAccessLevel: vi.fn() };
});

import { getDb } from "../db";
import { resolveAccessLevel } from "./authorization";
import { findGroupByChatId, recordRecentGroupMessage, writeAuditLog } from "./repository";
import { handleRoleManagementCommand, handleRoleManagementConfirmation } from "./roleManagement";

function emptyRoleDb() {
  const values = vi.fn().mockReturnValue({ onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined) });
  return {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    insert: vi.fn().mockReturnValue({ values }),
    values,
  };
}

describe("role-promotion confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findGroupByChatId).mockResolvedValue({ id: 7, chatId: -1007, title: "Kronos" } as any);
  });

  it("does not persist an elevation until the initiating administrator confirms it", async () => {
    const db = emptyRoleDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(resolveAccessLevel).mockResolvedValueOnce("group_admin" as never).mockResolvedValueOnce("user" as never).mockResolvedValueOnce("group_admin" as never);
    const command = {
      chat: { id: -1007, type: "supergroup" },
      from: { id: 9001, first_name: "نرگس", is_bot: false },
      message: { text: "تنظیم مدیر 123456", message_id: 71 },
      telegram: {},
      reply: vi.fn(),
    } as any;

    await handleRoleManagementCommand(command);
    expect(db.values).not.toHaveBeenCalled();
    const markup = command.reply.mock.calls[0][1].reply_markup;
    const yesCallback = markup.inline_keyboard[0][1].callback_data;

    const callback = {
      chat: { id: -1007, type: "supergroup" },
      from: { id: 9001, first_name: "نرگس", is_bot: false },
      callbackQuery: { data: yesCallback },
      telegram: {},
      answerCbQuery: vi.fn().mockResolvedValue(undefined),
      editMessageText: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
    } as any;
    await handleRoleManagementConfirmation(callback);

    expect(db.values).toHaveBeenCalledWith({ groupId: 7, telegramUserId: 123456, role: "moderator", grantedByTelegramId: 9001 });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "add_moderator", subjectTelegramId: 123456 }));
    expect(callback.editMessageText).toHaveBeenCalledWith("✅ ارتقای مقام تأیید شد.");
  });

  it("cancels a pending elevation without writing any role", async () => {
    const db = emptyRoleDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(resolveAccessLevel).mockResolvedValueOnce("group_admin" as never).mockResolvedValueOnce("user" as never);
    const command = {
      chat: { id: -1007, type: "supergroup" }, from: { id: 9001, is_bot: false },
      message: { text: "افزودن ویژه 123456", message_id: 71 }, telegram: {}, reply: vi.fn(),
    } as any;
    await handleRoleManagementCommand(command);
    const noCallback = command.reply.mock.calls[0][1].reply_markup.inline_keyboard[0][0].callback_data;
    const callback = {
      chat: { id: -1007, type: "supergroup" }, from: { id: 9001, is_bot: false }, callbackQuery: { data: noCallback },
      telegram: {}, answerCbQuery: vi.fn().mockResolvedValue(undefined), editMessageText: vi.fn().mockResolvedValue(undefined), reply: vi.fn(),
    } as any;
    await handleRoleManagementConfirmation(callback);
    expect(db.values).not.toHaveBeenCalled();
    expect(callback.editMessageText).toHaveBeenCalledWith("ارتقای مقام لغو شد.");
  });

  it("registers an unanswered confirmation for durable cleanup without an in-process timer", async () => {
    const db = emptyRoleDb();
    vi.mocked(getDb).mockResolvedValue(db as never);
    vi.mocked(resolveAccessLevel).mockResolvedValueOnce("group_admin" as never).mockResolvedValueOnce("user" as never);
    const command = {
      chat: { id: -1007, type: "supergroup" },
      from: { id: 9001, first_name: "نرگس", is_bot: false },
      message: { text: "تنظیم مدیر 123456", message_id: 71 },
      telegram: {},
      reply: vi.fn().mockResolvedValue({ message_id: 811 }),
    } as any;

    const before = Date.now();
    await handleRoleManagementCommand(command);
    const after = Date.now();

    expect(command.reply.mock.calls[0][0]).toContain("زمان باقی‌مانده");
    expect(recordRecentGroupMessage).toHaveBeenCalledWith({
      groupId: 7,
      messageId: 811,
      autoDeleteAt: expect.any(Date),
    });
    const autoDeleteAt = vi.mocked(recordRecentGroupMessage).mock.calls[0][0].autoDeleteAt as Date;
    expect(autoDeleteAt.getTime()).toBeGreaterThanOrEqual(before + 59_000);
    expect(autoDeleteAt.getTime()).toBeLessThanOrEqual(after + 61_000);
  });
});
