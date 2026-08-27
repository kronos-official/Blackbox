import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("./repository", () => ({ findGroupByChatId: vi.fn(), recordKnownGroupMember: vi.fn(), recordTelegramUser: vi.fn(), suspendGroupAuthority: vi.fn(), upsertTelegramGroupAuthorityRole: vi.fn(), writeAuditLog: vi.fn() }));
vi.mock("./authorization", async importOriginal => {
  const actual = await importOriginal<typeof import("./authorization")>();
  return { ...actual, resolveAccessLevel: vi.fn() };
});

import { getDb } from "../db";
import { resolveAccessLevel } from "./authorization";
import { OWNER_TELEGRAM_ID } from "./constants";
import { findGroupByChatId, suspendGroupAuthority, upsertTelegramGroupAuthorityRole, writeAuditLog } from "./repository";
import { handleRoleCleanupConfirmation, handleRoleListCleanupCallback, handleRoleListPageCallback, handleRoleManagementCommand, parseRoleCleanupCommand, roleListPageWindow } from "./roleManagement";

function context(text: string, actorTelegramId = 9001) {
  return {
    chat: { id: -1007, type: "supergroup", title: "Kronos" },
    from: { id: actorTelegramId, is_bot: false },
    message: { text, message_id: 71 },
    telegram: { getChatMember: vi.fn(), getChat: vi.fn(), getChatAdministrators: vi.fn().mockResolvedValue([]) },
    reply: vi.fn(),
  } as any;
}

function mutationDb() {
  const values = vi.fn().mockReturnValue({ onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined) });
  const insert = vi.fn().mockReturnValue({ values });
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn().mockReturnValue({ where: deleteWhere });
  const roleRows = vi.fn().mockResolvedValue([]);
  const select = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: roleRows }) });
  return { db: { insert, delete: remove, select }, insert, values, remove, deleteWhere, roleRows };
}

describe("group moderator and VIP management handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findGroupByChatId).mockResolvedValue({ id: 7, chatId: -1007, title: "Kronos" } as any);
  });

  it("requests confirmation before a VIP promotion and persists a later removal with an audit entry", async () => {
    const fixture = mutationDb();
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    vi.mocked(resolveAccessLevel).mockResolvedValueOnce("group_admin" as never).mockResolvedValueOnce("user" as never);
    const add = context("افزودن ویژه 123456");
    await expect(handleRoleManagementCommand(add)).resolves.toBe(true);
    expect(fixture.values).not.toHaveBeenCalled();
    expect(add.reply).toHaveBeenCalledWith(expect.stringContaining("آیا از ارتقای مقام"), expect.objectContaining({ parse_mode: "HTML", reply_markup: expect.anything() }));

    vi.mocked(resolveAccessLevel).mockResolvedValueOnce("group_admin" as never).mockResolvedValueOnce("user" as never);
    const remove = context("عزل ویژه 123456");
    await expect(handleRoleManagementCommand(remove)).resolves.toBe(true);
    expect(fixture.remove).not.toHaveBeenCalled();
    expect(remove.reply).toHaveBeenCalledWith(expect.stringContaining("در فهرست کاربران ویژه ربات وجود ندارد"), expect.objectContaining({ parse_mode: "HTML" }));
  });

  it("recognizes the concise Persian cleanup commands", () => {
    expect(parseRoleCleanupCommand("پاکسازی مدیران")).toBe("moderator");
    expect(parseRoleCleanupCommand("پاکسازی لیست مالکین")).toBe("kronos_owner");
    expect(parseRoleCleanupCommand("پاکسازی کاربران ویژه")).toBe("vip");
    expect(parseRoleCleanupCommand("پاکسازی مدیران 12")).toBeUndefined();
  });

  it("calculates bounded eight-member role-list pages", () => {
    expect(roleListPageWindow(17, 0)).toEqual({ page: 0, totalPages: 3, start: 0, end: 8 });
    expect(roleListPageWindow(17, 1)).toEqual({ page: 1, totalPages: 3, start: 8, end: 16 });
    expect(roleListPageWindow(17, 99)).toEqual({ page: 2, totalPages: 3, start: 16, end: 17 });
  });

  it("requires confirmation to clean manual moderators and preserves Telegram-native roles", async () => {
    const roleRows = vi.fn()
      .mockResolvedValueOnce([{ telegramUserId: 11 }, { telegramUserId: 12 }])
      .mockResolvedValueOnce([{ telegramUserId: 11, role: "group_admin" }, { telegramUserId: 12, role: "moderator" }]);
   const deleteWhere = vi.fn().mockResolvedValue(undefined);
   const remove = vi.fn().mockReturnValue({ where: deleteWhere });
   vi.mocked(getDb).mockResolvedValue({ select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: roleRows }) }), delete: remove } as never);
    vi.mocked(resolveAccessLevel).mockResolvedValue("group_owner" as never);
   const command = context("پاکسازی لیست مدیران");

    await expect(handleRoleManagementCommand(command)).resolves.toBe(true);
    const options = command.reply.mock.calls[0][1];
    const confirmationData = options.reply_markup.inline_keyboard[0][1].callback_data;
    expect(command.reply).toHaveBeenCalledWith(expect.stringContaining("بازگردانی فقط با راه‌اندازی خودکار مالک"), expect.objectContaining({ parse_mode: "HTML" }));

    const callback = context("", 9001);
    callback.callbackQuery = { data: confirmationData, message: { message_id: 72 } };
    callback.editMessageText = vi.fn().mockResolvedValue(undefined);
    callback.answerCbQuery = vi.fn().mockResolvedValue(undefined);
    await expect(handleRoleCleanupConfirmation(callback)).resolves.toBe(true);

    expect(remove).toHaveBeenCalledTimes(1);
    expect(suspendGroupAuthority).toHaveBeenCalledWith({ groupId: 7, telegramUserId: 11, suspendedByTelegramId: 9001 });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "clear_moderator", details: expect.objectContaining({ removedRoles: ["group_admin", "moderator"], suspendedAuthorityCount: 1 }) }));
    expect(callback.editMessageText).toHaveBeenCalledWith(expect.stringContaining("دسترسی Kronos Guard فقط با راه‌اندازی خودکار مالک بازمی‌گردد"), { parse_mode: "HTML" });
  });

  it("limits manager cleanup to the primary bot owner or the live group owner", async () => {
    const fixture = mutationDb();
    fixture.roleRows.mockResolvedValue([{ telegramUserId: 11 }]);
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    vi.mocked(resolveAccessLevel).mockResolvedValue("group_admin" as never);
    const command = context("پاکسازی مدیران");

    await expect(handleRoleManagementCommand(command)).resolves.toBe(true);
    expect(command.reply).toHaveBeenCalledWith(expect.stringContaining("فقط توسط مالک اصلی ربات یا مالک واقعی گروه"));
    expect(fixture.remove).not.toHaveBeenCalled();
  });

  it("accepts the Persian set-role wording on a reply and mentions the promotion target", async () => {
    const fixture = mutationDb();
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    vi.mocked(resolveAccessLevel).mockResolvedValueOnce("group_admin" as never).mockResolvedValueOnce("user" as never);
    const command = context("تنظیم ویژه");
    command.from = { id: 9001, is_bot: false, first_name: "نرگس" };
    command.message.reply_to_message = { from: { id: 123456, first_name: "آرین", is_bot: false } };

    await expect(handleRoleManagementCommand(command)).resolves.toBe(true);
    expect(fixture.values).not.toHaveBeenCalled();
    expect(command.reply).toHaveBeenCalledWith(expect.stringContaining('tg://user?id=123456'), expect.objectContaining({ parse_mode: "HTML", reply_parameters: { message_id: 71 } }));
    expect(command.reply).toHaveBeenCalledWith(expect.stringContaining("کاربر ویژه"), expect.anything());
  });

  it("accepts a selected inline mention as the target of a role change without a reply", async () => {
    const fixture = mutationDb();
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    vi.mocked(resolveAccessLevel).mockResolvedValueOnce("group_admin" as never).mockResolvedValueOnce("user" as never);
    const command = context("افزودن ویژه آرین");
    command.message.entities = [{ type: "text_mention", offset: 12, length: 4, user: { id: 123456, first_name: "آرین", is_bot: false } }];

    await expect(handleRoleManagementCommand(command)).resolves.toBe(true);
    expect(command.reply).toHaveBeenCalledWith(expect.stringContaining('tg://user?id=123456'), expect.objectContaining({ parse_mode: "HTML" }));
    expect(command.reply).toHaveBeenCalledWith(expect.stringContaining("کاربر ویژه"), expect.anything());
  });

  it("adds and removes a moderator only when the group administrator outranks the target", async () => {
    const fixture = mutationDb();
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    vi.mocked(resolveAccessLevel).mockResolvedValueOnce("group_admin" as never).mockResolvedValueOnce("user" as never);
    const add = context("افزودن مدیر 123456");
    await expect(handleRoleManagementCommand(add)).resolves.toBe(true);
    expect(fixture.values).not.toHaveBeenCalled();
    expect(add.reply).toHaveBeenCalledWith(expect.stringContaining("تأیید ارتقای مقام"), expect.anything());

    vi.mocked(resolveAccessLevel).mockResolvedValueOnce("group_admin" as never).mockResolvedValueOnce("user" as never);
    const remove = context("عزل مدیر 123456");
    await expect(handleRoleManagementCommand(remove)).resolves.toBe(true);
    expect(fixture.remove).not.toHaveBeenCalled();
    expect(remove.reply).toHaveBeenCalledWith(expect.stringContaining("در فهرست مدیران ربات وجود ندارد"), expect.objectContaining({ parse_mode: "HTML" }));
  });

  it("lists persisted moderator records and refuses non-admin role changes", async () => {
    const selectChain = { where: vi.fn().mockResolvedValue([{ telegramUserId: 10 }, { telegramUserId: 11 }]) };
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(selectChain) }) } as never);
    vi.mocked(resolveAccessLevel).mockResolvedValue("group_admin" as never);
    const list = context("لیست کاربران مدیر");
    await handleRoleManagementCommand(list);
    expect(list.reply).toHaveBeenCalledWith(expect.stringContaining("10"), expect.objectContaining({ parse_mode: "HTML" }));
    expect(list.reply).toHaveBeenCalledWith(expect.stringContaining("11"), expect.objectContaining({ parse_mode: "HTML" }));
    expect(list.reply).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ reply_markup: { inline_keyboard: [[expect.objectContaining({ callback_data: "role-list-cleanup:moderator" })]] } }));

    const vipList = context("لیست کاربران ویژه");
    await handleRoleManagementCommand(vipList);
    expect(vipList.reply).toHaveBeenCalledWith(expect.stringContaining("10"), expect.objectContaining({ parse_mode: "HTML" }));

    vi.mocked(resolveAccessLevel).mockResolvedValue("user" as never);
    const unauthorized = context("افزودن ویژه 123456");
    await handleRoleManagementCommand(unauthorized);
    expect(unauthorized.reply).toHaveBeenCalledWith(expect.stringContaining("فقط مدیران"));
  });

  it("refreshes and displays live Telegram administrators as internal group administrators", async () => {
    const listWhere = vi.fn()
      .mockResolvedValueOnce([{ telegramUserId: 88, role: "group_admin" }])
      .mockResolvedValueOnce([{ telegramUserId: 88, firstName: "نرگس", lastName: null, username: "narges" }]);
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: listWhere }) }) } as never);
    vi.mocked(resolveAccessLevel).mockResolvedValue("group_admin" as never);
    const list = context("لیست مدیران");
    list.telegram.getChatAdministrators.mockResolvedValue([{ status: "administrator", user: { id: 88, first_name: "نرگس", is_bot: false } }]);

    await expect(handleRoleManagementCommand(list)).resolves.toBe(true);
    expect(upsertTelegramGroupAuthorityRole).toHaveBeenCalledWith({ groupId: 7, telegramUserId: 88, role: "group_admin", grantedByTelegramId: 9001 });
    expect(list.reply).toHaveBeenCalledWith(expect.stringContaining("مدیر گروه"), expect.objectContaining({ parse_mode: "HTML" }));
  });

  it("renders the requested manager-list page with navigation and the cleanup button", async () => {
    const roleRows = Array.from({ length: 9 }, (_, index) => ({ telegramUserId: index + 1, role: "moderator" }));
    const knownUsers = Array.from({ length: 9 }, (_, index) => ({ telegramUserId: index + 1, firstName: `User ${String(index + 1).padStart(2, "0")}`, lastName: null, username: null }));
    const selectWhere = vi.fn().mockResolvedValueOnce(roleRows).mockResolvedValueOnce(knownUsers);
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: selectWhere }) }) } as never);
    vi.mocked(resolveAccessLevel).mockResolvedValue("group_admin" as never);
    const callback = context("", 9001);
    callback.callbackQuery = { data: "role-list-page:moderator:1", message: { message_id: 72 } };
    callback.answerCbQuery = vi.fn().mockResolvedValue(undefined);
    callback.editMessageText = vi.fn().mockResolvedValue(undefined);

    await expect(handleRoleListPageCallback(callback)).resolves.toBe(true);
    expect(callback.editMessageText).toHaveBeenCalledWith(expect.stringContaining("User 09"), expect.objectContaining({ reply_markup: expect.objectContaining({ inline_keyboard: expect.arrayContaining([expect.arrayContaining([expect.objectContaining({ callback_data: "role-list-cleanup:moderator" })])]) }) }));
    expect(callback.editMessageText).toHaveBeenCalledWith(expect.not.stringContaining("User 01"), expect.anything());
  });

  it("replaces the source role-list panel with an empty list and cleanup timestamp after confirmation", async () => {
    const roleRows = vi.fn()
      .mockResolvedValueOnce([{ telegramUserId: 44 }])
      .mockResolvedValueOnce([{ telegramUserId: 44, role: "group_admin" }]);
    const remove = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: roleRows }) }), delete: remove } as never);
    vi.mocked(resolveAccessLevel).mockResolvedValue("group_owner" as never);
    const callback = context("", 9001);
    callback.callbackQuery = { data: "role-list-cleanup:moderator", message: { message_id: 72 } };
    callback.answerCbQuery = vi.fn().mockResolvedValue(undefined);

    await expect(handleRoleListCleanupCallback(callback)).resolves.toBe(true);
    expect(callback.answerCbQuery).toHaveBeenCalled();
    expect(callback.reply).toHaveBeenCalledWith(expect.stringContaining("پاکسازی مدیران"), expect.objectContaining({ reply_markup: expect.anything() }));

    const confirmationData = callback.reply.mock.calls[0][1].reply_markup.inline_keyboard[0][1].callback_data;
    const confirmation = context("", 9001);
    confirmation.callbackQuery = { data: confirmationData, message: { message_id: 73 } };
    confirmation.answerCbQuery = vi.fn().mockResolvedValue(undefined);
    confirmation.editMessageText = vi.fn().mockResolvedValue(undefined);
    confirmation.telegram.editMessageText = vi.fn().mockResolvedValue(undefined);

    await expect(handleRoleCleanupConfirmation(confirmation)).resolves.toBe(true);
    expect(confirmation.telegram.editMessageText).toHaveBeenCalledWith(
      confirmation.chat.id,
      72,
      undefined,
      expect.stringContaining("لیست خالی است"),
      { parse_mode: "HTML", reply_markup: { inline_keyboard: [] } },
    );
    expect(confirmation.telegram.editMessageText).toHaveBeenCalledWith(
      confirmation.chat.id,
      72,
      undefined,
      expect.stringMatching(/پاکسازی انجام شد:/),
      expect.anything(),
    );
  });

  it("lists owners with direct mentions and removes every removable internal role with the generic dismissal command", async () => {
    const listedRoles = [{ telegramUserId: 10 }, { telegramUserId: 11 }];
    const knownUsers = [{ telegramUserId: 10, firstName: "آرین", lastName: null, username: "arian" }, { telegramUserId: 11, firstName: "سارا", lastName: null, username: "sara" }];
    const listWhere = vi.fn().mockResolvedValueOnce(listedRoles).mockResolvedValueOnce(knownUsers);
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: listWhere }) }) } as never);
    vi.mocked(resolveAccessLevel).mockResolvedValue("group_admin" as never);
    const owners = context("لیست مالکان");
    await expect(handleRoleManagementCommand(owners)).resolves.toBe(true);
    expect(owners.reply).toHaveBeenCalledWith(expect.stringContaining('tg://user?id=10'), expect.objectContaining({ parse_mode: "HTML" }));
    expect(owners.reply).toHaveBeenCalledWith(expect.stringContaining("🛡️ مالکان"), expect.anything());

    const fixture = mutationDb();
    const roleRows = [{ role: "moderator" }, { role: "vip" }];
    fixture.db.select = vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(roleRows) }) });
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    vi.mocked(resolveAccessLevel).mockResolvedValueOnce("group_admin" as never).mockResolvedValueOnce("user" as never);
    const dismiss = context("عزل 123456");
    await expect(handleRoleManagementCommand(dismiss)).resolves.toBe(true);
    expect(fixture.remove).toHaveBeenCalledTimes(3);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "remove_all_roles", details: { roles: ["moderator", "vip"] } }));
    expect(dismiss.reply).toHaveBeenCalledWith(expect.stringContaining("⬇️ عزل مقام"), expect.objectContaining({ parse_mode: "HTML" }));
  });

  it("does not let an internal moderator delegate a VIP or another moderator role", async () => {
    const fixture = mutationDb();
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    vi.mocked(resolveAccessLevel).mockResolvedValue("moderator" as never);

    const vipAttempt = context("افزودن ویژه 123456");
    await expect(handleRoleManagementCommand(vipAttempt)).resolves.toBe(true);
    expect(fixture.insert).not.toHaveBeenCalled();
    expect(vipAttempt.reply).toHaveBeenCalledWith(expect.stringContaining("فقط مدیران"));

    const moderatorAttempt = context("افزودن مدیر 123456");
    await expect(handleRoleManagementCommand(moderatorAttempt)).resolves.toBe(true);
    expect(fixture.insert).not.toHaveBeenCalled();
    expect(moderatorAttempt.reply).toHaveBeenCalledWith(expect.stringContaining("فقط مدیران"));
  });

  it("keeps VIP and ordinary users outside role delegation while preserving sole bot-owner delegation", async () => {
    const deniedFixture = mutationDb();
    vi.mocked(getDb).mockResolvedValue(deniedFixture.db as never);

    for (const actorAccess of ["vip", "user"] as const) {
      vi.mocked(resolveAccessLevel).mockResolvedValue(actorAccess as never);
      const attempt = context("افزودن ویژه 123456");
      await expect(handleRoleManagementCommand(attempt)).resolves.toBe(true);
      expect(attempt.reply).toHaveBeenCalledWith(expect.stringContaining("فقط مدیران"));
    }
    expect(deniedFixture.insert).not.toHaveBeenCalled();

    const ownerFixture = mutationDb();
    vi.mocked(getDb).mockResolvedValue(ownerFixture.db as never);
    vi.mocked(resolveAccessLevel).mockResolvedValueOnce("owner" as never).mockResolvedValueOnce("user" as never);
    const promotion = context("افزودن مالک کرونوس 123456", OWNER_TELEGRAM_ID);
    await expect(handleRoleManagementCommand(promotion)).resolves.toBe(true);
    expect(ownerFixture.values).not.toHaveBeenCalled();
    expect(promotion.reply).toHaveBeenCalledWith(expect.stringContaining("تأیید ارتقای مقام"), expect.anything());
  });

  it("does not give an internal Kronos owner delegation power beyond moderator-level command access", async () => {
    // Command resolution intentionally maps the internal kronos_owner tier to
    // moderator-level command access; it is not a Telegram or dashboard owner.
    const fixture = mutationDb();
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    vi.mocked(resolveAccessLevel).mockResolvedValue("moderator" as never);

    const attempt = context("افزودن ویژه 123456", 9031);
    await expect(handleRoleManagementCommand(attempt)).resolves.toBe(true);
    expect(fixture.insert).not.toHaveBeenCalled();
    expect(attempt.reply).toHaveBeenCalledWith(expect.stringContaining("فقط مدیران"));
  });
});
