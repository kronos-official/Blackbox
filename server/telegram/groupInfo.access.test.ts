import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("./repository", () => ({
  findGroupByChatId: vi.fn(),
  isGlobalAdmin: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./authorization", async importOriginal => {
  const actual = await importOriginal<typeof import("./authorization")>();
  return { ...actual, resolveAccessLevel: vi.fn() };
});

import { getDb } from "../db";
import { resolveAccessLevel } from "./authorization";
import { GROUP_LINK_ACCESS_POLICY_REVISION, handleGroupLinkCommand, handleGroupLinkModeCallback, isAnonymousGroupAdministratorLinkMessage } from "./groupInfo";
import { findGroupByChatId, isGlobalAdmin, writeAuditLog } from "./repository";

const group = { id: 7, chatId: -1007, title: "Kronos Guard" };

function linkTelegram(overrides: Record<string, unknown> = {}) {
  return {
    getChat: vi.fn().mockResolvedValue({ id: -1007, type: "supergroup", title: "Kronos Guard" }),
    getMe: vi.fn().mockResolvedValue({ id: 8809324062 }),
    getChatMembersCount: vi.fn().mockResolvedValue(42),
    getChatMember: vi.fn().mockResolvedValue({ status: "administrator" }),
    getChatAdministrators: vi.fn().mockResolvedValue([]),
    exportChatInviteLink: vi.fn().mockResolvedValue("https://t.me/+test-link"),
    sendPhoto: vi.fn().mockResolvedValue({ message_id: 88 }),
    deleteMessage: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("group link live authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(null as never);
    vi.mocked(findGroupByChatId).mockResolvedValue(group as never);
    vi.mocked(isGlobalAdmin).mockResolvedValue(false);
    vi.mocked(resolveAccessLevel).mockResolvedValue("user" as never);
  });

  it("permits a live Telegram administrator when a single-member lookup is temporarily unavailable", async () => {
    const getChatMember = vi.fn()
      .mockRejectedValueOnce(new Error("member lookup temporarily unavailable"))
      .mockResolvedValueOnce({ status: "administrator" });
    const getChatAdministrators = vi.fn().mockResolvedValue([{ user: { id: 9001 }, status: "administrator" }]);
    const telegram = linkTelegram({ getChatMember, getChatAdministrators });
    const ctx = {
      chat: { id: -1007, type: "supergroup" },
      from: { id: 9001, first_name: "مدیر", is_bot: false },
      message: { text: "لینک", message_id: 71 },
      telegram,
      reply: vi.fn().mockResolvedValue({ message_id: 77 }),
    } as any;

    await expect(handleGroupLinkCommand(ctx)).resolves.toBe(true);

    expect(getChatAdministrators).toHaveBeenCalledWith(-1007);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("ساخت لینک"), expect.objectContaining({
      reply_markup: expect.any(Object),
    }));
    expect(ctx.reply).not.toHaveBeenCalledWith(expect.stringContaining("فقط برای مالک یا مدیر"), expect.anything());
  });

  it("keeps a callback available to a valid Telegram administrator even when group persistence is temporarily unavailable", async () => {
    vi.mocked(findGroupByChatId).mockResolvedValue(undefined);
    vi.mocked(resolveAccessLevel).mockResolvedValue("user" as never);
    const telegram = linkTelegram({
      getChatMember: vi.fn().mockRejectedValue(new Error("temporary lookup miss")),
      getChatAdministrators: vi.fn().mockResolvedValue([{ user: { id: 9001 }, status: "administrator" }]),
    });
    const ctx = {
      chat: { id: -1007, type: "supergroup" },
      from: { id: 9001, first_name: "مدیر", is_bot: false },
      callbackQuery: { data: "group-link:close", message: { message_id: 81, chat: { id: -1007, type: "supergroup" } } },
      telegram,
      answerCbQuery: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
    } as any;

    await expect(handleGroupLinkModeCallback(ctx)).resolves.toBe(true);

    expect(telegram.getChatAdministrators).toHaveBeenCalledWith(-1007);
    expect(ctx.answerCbQuery).toHaveBeenCalledWith();
    expect(telegram.deleteMessage).toHaveBeenCalledWith(-1007, 81);
  });

  it("permits an internally delegated Kronos manager even when Telegram currently reports a regular member", async () => {
    vi.mocked(resolveAccessLevel).mockResolvedValue("moderator" as never);
    const telegram = linkTelegram({
      getChatMember: vi.fn().mockResolvedValue({ status: "member" }),
      getChatAdministrators: vi.fn().mockResolvedValue([]),
    });
    const ctx = {
      chat: { id: -1007, type: "supergroup" },
      from: { id: 9003, first_name: "مدیر داخلی", is_bot: false },
      message: { text: "لینک", message_id: 82 },
      telegram,
      reply: vi.fn().mockResolvedValue({ message_id: 83 }),
    } as any;

    await expect(handleGroupLinkCommand(ctx)).resolves.toBe(true);

    expect(resolveAccessLevel).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 7,
      groupChatId: -1007,
      telegramUserId: 9003,
    }), telegram);
    expect(telegram.getChatMember).not.toHaveBeenCalledWith(-1007, 9003);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("ساخت لینک"), expect.objectContaining({
      reply_markup: expect.any(Object),
    }));
  });

  it("applies the same internal manager authorization to link callbacks", async () => {
    vi.mocked(resolveAccessLevel).mockResolvedValue("moderator" as never);
    const telegram = linkTelegram({
      getChatMember: vi.fn().mockResolvedValue({ status: "member" }),
      getChatAdministrators: vi.fn().mockResolvedValue([]),
    });
    const ctx = {
      chat: { id: -1007, type: "supergroup" },
      from: { id: 9003, first_name: "مدیر داخلی", is_bot: false },
      callbackQuery: { data: "group-link:close", message: { message_id: 84, chat: { id: -1007, type: "supergroup" } } },
      telegram,
      answerCbQuery: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn(),
    } as any;

    await expect(handleGroupLinkModeCallback(ctx)).resolves.toBe(true);

    expect(telegram.getChatMember).not.toHaveBeenCalledWith(-1007, 9003);
    expect(ctx.answerCbQuery).toHaveBeenCalledWith();
    expect(telegram.deleteMessage).toHaveBeenCalledWith(-1007, 84);
  });

  it("recognizes only the group’s own anonymous-admin sender identity and never a linked channel", () => {
    const anonymousAdmin = {
      chat: { id: -1007, type: "supergroup" },
      message: { text: "لینک", sender_chat: { id: -1007, type: "supergroup" } },
    } as any;
    const linkedChannel = {
      chat: { id: -1007, type: "supergroup" },
      message: { text: "لینک", sender_chat: { id: -1008, type: "channel" } },
    } as any;

    expect(isAnonymousGroupAdministratorLinkMessage(anonymousAdmin)).toBe(true);
    expect(isAnonymousGroupAdministratorLinkMessage(linkedChannel)).toBe(false);
  });

  it("records only non-sensitive runtime metadata when a link request is denied", async () => {
    const telegram = linkTelegram({
      getChatMember: vi.fn().mockResolvedValue({ status: "member" }),
      getChatAdministrators: vi.fn().mockResolvedValue([]),
    });
    const ctx = {
      chat: { id: -1007, type: "supergroup" },
      from: { id: 9002, first_name: "عضو", is_bot: false },
      message: { text: "لینک", message_id: 72 },
      telegram,
      reply: vi.fn().mockResolvedValue({ message_id: 78 }),
    } as any;

    await expect(handleGroupLinkCommand(ctx)).resolves.toBe(true);

    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      severity: "warning",
      category: "group_info",
      event: "link_access_denied",
      groupId: 7,
      actorTelegramId: 9002,
      details: expect.objectContaining({
        policyRevision: GROUP_LINK_ACCESS_POLICY_REVISION,
        chatId: -1007,
        contextFromId: 9002,
        messageFromId: null,
        senderChatId: null,
        registeredGroupId: 7,
        anonymousGroupAdministrator: false,
      }),
    }));
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("فقط برای مالک یا مدیر"), expect.anything());
  });
});
