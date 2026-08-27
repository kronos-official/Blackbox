import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repository", () => ({ findGroupByChatId: vi.fn(), findTelegramUserByUsername: vi.fn(), getKronosMemberTitle: vi.fn(), writeAuditLog: vi.fn(), recordTelegramUser: vi.fn().mockResolvedValue(undefined), recordKnownGroupMember: vi.fn().mockResolvedValue(undefined), setKronosMemberTitle: vi.fn().mockResolvedValue(true) }));
vi.mock("./groupEventNotifier", () => ({ notifyGroupEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./authorization", async importOriginal => {
  const actual = await importOriginal<typeof import("./authorization")>();
  return { ...actual, resolveAccessLevel: vi.fn() };
});

import { resolveAccessLevel } from "./authorization";
import { findGroupByChatId, findTelegramUserByUsername, getKronosMemberTitle, setKronosMemberTitle, writeAuditLog } from "./repository";
import { notifyGroupEvent } from "./groupEventNotifier";
import { handleAdministratorTitleCommand, parseAdministratorTitleCommand, parseNicknameCommand } from "./administratorTitles";

describe("administrator title commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findGroupByChatId).mockResolvedValue({ id: 7, chatId: -1007, title: "Kronos" } as any);
    vi.mocked(resolveAccessLevel).mockResolvedValue("moderator" as never);
  });

  it("parses set and removal Persian title commands", () => {
    expect(parseAdministratorTitleCommand("تنظیم لقب خوشحال")).toEqual({ action: "set", title: "خوشحال" });
    expect(parseAdministratorTitleCommand("تنظیم لقب تست @justimmortalman")).toEqual({ action: "set", title: "تست", target: { kind: "username", username: "justimmortalman" } });
    expect(parseAdministratorTitleCommand("/حذف لقب")).toEqual({ action: "remove" });
    expect(parseAdministratorTitleCommand("تنظیم لقب")).toEqual({ action: "set", title: "" });
  });

  it("changes a member tag when the username follows the new title", async () => {
    vi.mocked(findTelegramUserByUsername).mockResolvedValue({
      telegramUserId: 123456,
      firstName: "Immortal man",
      lastName: null,
      username: "justimmortalman",
      isBot: false,
    } as any);
    const callApi = vi.fn().mockResolvedValue(true);
    const ctx = {
      chat: { id: -1007, type: "supergroup" },
      from: { id: 9001, is_bot: false },
      message: { text: "تنظیم لقب تست @justimmortalman", message_id: 77 },
      telegram: { getChatMember: vi.fn().mockResolvedValue({ status: "member" }), callApi },
      reply: vi.fn(),
    } as any;

    await expect(handleAdministratorTitleCommand(ctx)).resolves.toBe(true);

    expect(findTelegramUserByUsername).toHaveBeenCalledWith("justimmortalman");
    expect(callApi).toHaveBeenCalledWith("setChatMemberTag", { chat_id: -1007, user_id: 123456, tag: "تست" });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("به <b>تست</b> تغییر کرد"), expect.objectContaining({ parse_mode: "HTML" }));
  });

  it("treats bare nickname commands as display requests instead of nickname writes", () => {
    expect(parseNicknameCommand("لقب")).toEqual({ action: "show" });
    expect(parseNicknameCommand("لقب @AriaTest")).toEqual({ action: "show", target: { kind: "username", username: "AriaTest" } });
  });

  it("shows a replied member's stored nickname without validating or modifying it", async () => {
    vi.mocked(getKronosMemberTitle).mockResolvedValue("نگهبان گروه");
    const ctx = {
      chat: { id: -1007, type: "supergroup" },
      from: { id: 9002, is_bot: false },
      message: {
        text: "لقب", message_id: 72,
        reply_to_message: { from: { id: 123456, first_name: "آرین", is_bot: false } },
      },
      telegram: { getChatMember: vi.fn().mockResolvedValue({ status: "member" }) },
      reply: vi.fn(),
    } as any;
    await expect(handleAdministratorTitleCommand(ctx)).resolves.toBe(true);
    expect(getKronosMemberTitle).toHaveBeenCalledWith({ groupId: 7, telegramUserId: 123456 });
    expect(setKronosMemberTitle).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("نگهبان گروه"), expect.objectContaining({ parse_mode: "HTML" }));
  });

  it("changes the replied regular member's Telegram-visible tag and writes an audit event", async () => {
    const callApi = vi.fn().mockResolvedValue(true);
    const ctx = {
      chat: { id: -1007, type: "supergroup" },
      from: { id: 9001, is_bot: false },
      message: {
        text: "تنظیم لقب خوشحال", message_id: 71,
        reply_to_message: { from: { id: 123456, first_name: "آرین", is_bot: false } },
      },
      telegram: { getChatMember: vi.fn().mockResolvedValue({ status: "member" }), callApi, setChatAdministratorCustomTitle: vi.fn() },
      reply: vi.fn(),
    } as any;
    await expect(handleAdministratorTitleCommand(ctx)).resolves.toBe(true);
    expect(callApi).toHaveBeenCalledWith("setChatMemberTag", { chat_id: -1007, user_id: 123456, tag: "خوشحال" });
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("لقب"), expect.objectContaining({ parse_mode: "HTML" }));
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('href="tg://user?id=123456"'), expect.objectContaining({ parse_mode: "HTML" }));
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('>آرین</a> به <b>خوشحال</b>'), expect.objectContaining({ parse_mode: "HTML" }));
    expect(ctx.reply).not.toHaveBeenCalledWith(expect.stringContaining("✅"), expect.anything());
    expect(ctx.reply).not.toHaveBeenCalledWith(expect.stringContaining('>آرین | خوشحال</a>'), expect.anything());
    expect(setKronosMemberTitle).toHaveBeenCalledWith({ groupId: 7, telegramUserId: 123456, title: "خوشحال" });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ category: "member_tag", event: "set", subjectTelegramId: 123456 }));
  });

  it("changes a selected inline mention target without requiring a reply", async () => {
    const callApi = vi.fn().mockResolvedValue(true);
    const ctx = {
      chat: { id: -1007, type: "supergroup" },
      from: { id: 9001, is_bot: false },
      message: {
        text: "تنظیم لقب آرین نگهبان", message_id: 76,
        entities: [{ type: "text_mention", offset: 10, length: 4, user: { id: 123456, first_name: "آرین", is_bot: false } }],
      },
      telegram: { getChatMember: vi.fn().mockResolvedValue({ status: "member" }), callApi },
      reply: vi.fn(),
    } as any;
    await expect(handleAdministratorTitleCommand(ctx)).resolves.toBe(true);
    expect(callApi).toHaveBeenCalledWith("setChatMemberTag", { chat_id: -1007, user_id: 123456, tag: "نگهبان" });
  });

  it("records an administrator's internal nickname and actor-visible audit notification without changing Telegram's tag", async () => {
    const setChatAdministratorCustomTitle = vi.fn().mockResolvedValue(true);
    const ctx = {
      chat: { id: -1007, type: "supergroup" },
      from: { id: 9001, is_bot: false },
      message: { text: "تنظیم لقب نگهبان", message_id: 73, reply_to_message: { from: { id: 123456, first_name: "آرین", is_bot: false } } },
      telegram: { getChatMember: vi.fn().mockResolvedValue({ status: "administrator" }), setChatAdministratorCustomTitle, callApi: vi.fn() },
      reply: vi.fn(),
    } as any;
    await expect(handleAdministratorTitleCommand(ctx)).resolves.toBe(true);
    expect(setChatAdministratorCustomTitle).not.toHaveBeenCalled();
    expect(ctx.telegram.callApi).not.toHaveBeenCalled();
    expect(setKronosMemberTitle).toHaveBeenCalledWith({ groupId: 7, telegramUserId: 123456, title: "نگهبان" });
    expect(notifyGroupEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "role.title_changed",
      includeActorInDashboard: true,
      details: expect.objectContaining({ previousValue: "نگهبان گروه", nextValue: "نگهبان" }),
    }));
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("لقب"), expect.objectContaining({ parse_mode: "HTML" }));
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("به <b>نگهبان</b> تغییر کرد"), expect.objectContaining({ parse_mode: "HTML" }));
    expect(ctx.reply).not.toHaveBeenCalledWith(expect.stringContaining("فقط برای اعضای عادی"), expect.anything());
  });

  it("records the group owner's internal nickname and actor-visible audit notification without changing Telegram's tag", async () => {
    const ctx = {
      chat: { id: -1007, type: "supergroup" },
      from: { id: 9001, is_bot: false },
      message: { text: "تنظیم لقب مالک", message_id: 74, reply_to_message: { from: { id: 123456, first_name: "آرین", is_bot: false } } },
      telegram: { getChatMember: vi.fn().mockResolvedValue({ status: "creator" }), setChatAdministratorCustomTitle: vi.fn(), callApi: vi.fn() },
      reply: vi.fn(),
    } as any;
    await expect(handleAdministratorTitleCommand(ctx)).resolves.toBe(true);
    expect(setKronosMemberTitle).toHaveBeenCalledWith({ groupId: 7, telegramUserId: 123456, title: "مالک" });
    expect(ctx.telegram.callApi).not.toHaveBeenCalled();
    expect(notifyGroupEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "role.title_changed",
      includeActorInDashboard: true,
      details: expect.objectContaining({ previousValue: "نگهبان گروه", nextValue: "مالک" }),
    }));
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("لقب"), expect.objectContaining({ parse_mode: "HTML" }));
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("به <b>مالک</b> تغییر کرد"), expect.objectContaining({ parse_mode: "HTML" }));
    expect(ctx.reply).not.toHaveBeenCalledWith(expect.stringContaining("فقط برای اعضای عادی"), expect.anything());
  });

  it("does not persist an internal-only nickname when Telegram rejects member-tag management", async () => {
    const ctx = {
      chat: { id: -1007, type: "supergroup" },
      from: { id: 9001, is_bot: false },
      message: { text: "تنظیم لقب نگهبان", message_id: 75, reply_to_message: { from: { id: 123456, first_name: "آرین", is_bot: false } } },
      telegram: { getChatMember: vi.fn().mockResolvedValue({ status: "member" }), callApi: vi.fn().mockRejectedValue(new Error("not enough rights to manage tags")), setChatAdministratorCustomTitle: vi.fn() },
      reply: vi.fn(),
    } as any;
    await expect(handleAdministratorTitleCommand(ctx)).resolves.toBe(true);
    expect(setKronosMemberTitle).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("مدیریت تگ‌ها"), expect.anything());
  });
});
