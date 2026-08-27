import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../telegram/repository", () => ({
  recordKnownGroupMember: vi.fn(async () => undefined),
  recordTelegramUser: vi.fn(async () => undefined),
  writeAuditLog: vi.fn(async () => undefined),
}));
vi.mock("../telegram/bot", () => ({ getTelegramBot: vi.fn() }));

import { getDb } from "../db";
import { recordKnownGroupMember, recordTelegramUser, writeAuditLog } from "../telegram/repository";
import { getTelegramBot } from "../telegram/bot";
import { appRouter } from "../routers";
import { issueDashboardSession, issueOwnerDashboardSession } from "./telegramMiniAppAuth";
import { OWNER_TELEGRAM_ID } from "../telegram/constants";
import type { TrpcContext } from "../_core/context";

function ownerCaller(token: string) {
  const ctx: TrpcContext = { req: { header: (name: string) => name === "x-kronos-owner-session" ? token : undefined } as TrpcContext["req"], res: {} as TrpcContext["res"], user: null };
  return appRouter.createCaller(ctx);
}

function readChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy"]) chain[method] = vi.fn(() => chain);
  chain.limit = vi.fn(async () => rows);
  chain.then = (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

const liveAdministrator = vi.fn(async (_chatId: number, telegramUserId: number) => ({
  status: "administrator",
  user: { id: telegramUserId, is_bot: false, first_name: "Administrator" },
}));

describe("owner dashboard member directory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getChatMember: liveAdministrator } } as never);
  });

  it("returns only bot-observed members enriched with persisted roles and warning counts", async () => {
    const records = [
      [{ chatId: -100700, status: "active" }],
      [{ id: 11, groupId: 7, telegramUserId: 42, membershipStatus: "active", telegramRole: "member", lastSeenAt: new Date("2026-08-14T00:00:00Z") }],
      [{ telegramUserId: 42, firstName: "Ava", lastName: null, username: "ava", isBot: false }],
      [{ groupId: 7, telegramUserId: 42, role: "moderator" }],
      [{ groupId: 7, telegramUserId: 42, count: 2 }],
      [{ id: 7, ownerTelegramId: 1 }],
    ];
    const select = vi.fn(() => readChain(records.shift() ?? []));
    vi.mocked(getDb).mockResolvedValue({ select } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    await expect(ownerCaller(token).dashboard.members.list({ groupId: 7, includeDeparted: false })).resolves.toMatchObject({
      totalKnown: 1,
      members: [{ telegramUserId: 42, firstName: "Ava", managedRoles: ["moderator"], warningCount: 2, isGroupOwner: false }],
    });
  });

  it("assigns an internal Kronos moderator role, announces it in the group, and records the owner audit event", async () => {
    const records = [[{ chatId: -100700, status: "active" }], [{ id: 11, telegramRole: "member" }], [{ chatId: -100700 }], [{ firstName: "Ava", lastName: null, username: "ava" }]];
    const select = vi.fn(() => readChain(records.shift() ?? []));
    const insertValues = vi.fn().mockReturnValue({ onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined) });
    const insert = vi.fn().mockReturnValue({ values: insertValues });
    vi.mocked(getDb).mockResolvedValue({ select, insert } as never);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getChatMember: liveAdministrator, sendMessage } } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    await expect(ownerCaller(token).dashboard.members.setKronosRole({ groupId: 7, targetTelegramId: 42, role: "moderator" })).resolves.toEqual({ success: true, unchanged: false, announced: true });
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ groupId: 7, telegramUserId: 42, role: "moderator", grantedByTelegramId: OWNER_TELEGRAM_ID }));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ category: "dashboard_member_roles", event: "set_moderator", groupId: 7, subjectTelegramId: 42 }));
    expect(sendMessage).toHaveBeenCalledWith(-100700, expect.stringContaining('<a href="tg://user?id=42">Ava</a> به مدیر Kronos تغییر مقام پیدا کرد.'), { parse_mode: "HTML" });
  });

  it("allows an owner to set an internal Kronos role for an observed Telegram administrator without changing their Telegram role", async () => {
    const records = [[{ chatId: -100700, status: "active" }], [{ id: 11, telegramRole: "administrator" }], [{ chatId: -100700 }], [{ firstName: "Ava", lastName: null, username: "ava" }]];
    const select = vi.fn(() => readChain(records.shift() ?? []));
    const insertValues = vi.fn().mockReturnValue({ onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined) });
    const insert = vi.fn().mockReturnValue({ values: insertValues });
    vi.mocked(getDb).mockResolvedValue({ select, insert } as never);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getChatMember: liveAdministrator, sendMessage: vi.fn().mockResolvedValue(undefined) } } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    await expect(ownerCaller(token).dashboard.members.setKronosRole({ groupId: 7, targetTelegramId: 42, role: "moderator" })).resolves.toEqual({ success: true, unchanged: false, announced: true });
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ groupId: 7, telegramUserId: 42, role: "moderator" }));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "set_moderator", subjectTelegramId: 42 }));
  });

  it("lets only the sole bot owner delegate the protected Kronos owner role and records an accountable group announcement", async () => {
    const records = [[{ chatId: -100700, status: "active" }], [{ id: 11, telegramRole: "member" }], [{ chatId: -100700 }], [{ firstName: "Ava", lastName: null, username: "ava" }], []];
    const select = vi.fn(() => readChain(records.shift() ?? []));
    const insertValues = vi.fn().mockReturnValue({ onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined) });
    const insert = vi.fn().mockReturnValue({ values: insertValues });
    vi.mocked(getDb).mockResolvedValue({ select, insert } as never);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getChatMember: liveAdministrator, sendMessage } } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID, firstName: "مالک اصلی" });

    await expect(ownerCaller(token).dashboard.members.setKronosRole({ groupId: 7, targetTelegramId: 42, role: "kronos_owner" })).resolves.toEqual({ success: true, unchanged: false, announced: true });
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ groupId: 7, telegramUserId: 42, role: "kronos_owner", grantedByTelegramId: OWNER_TELEGRAM_ID }));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "set_kronos_owner", subjectTelegramId: 42 }));
    expect(sendMessage).toHaveBeenCalledWith(-100700, expect.stringContaining("مالک Kronos"), { parse_mode: "HTML" });
    expect(sendMessage).toHaveBeenCalledWith(-100700, expect.stringContaining("انجام‌دهنده:"), { parse_mode: "HTML" });
    expect(sendMessage).toHaveBeenCalledWith(-100700, expect.stringContaining('tg://user?id=42'), { parse_mode: "HTML" });
    expect(sendMessage).toHaveBeenCalledWith(-100700, expect.stringContaining(`tg://user?id=${OWNER_TELEGRAM_ID}`), { parse_mode: "HTML" });
  });

  it("reports a clear no-op when the target already has the requested or a higher Kronos role", async () => {
    const records = [[{ chatId: -100700, status: "active" }], [{ id: 11, telegramRole: "member" }], [{ chatId: -100700 }], [{ firstName: "Ava", lastName: null, username: "ava" }], [{ role: "moderator" }]];
    const select = vi.fn(() => readChain(records.shift() ?? []));
    const insert = vi.fn();
    const sendMessage = vi.fn();
    vi.mocked(getDb).mockResolvedValue({ select, insert } as never);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getChatMember: liveAdministrator, sendMessage } } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });

    await expect(ownerCaller(token).dashboard.members.setKronosRole({ groupId: 7, targetTelegramId: 42, role: "vip" })).resolves.toEqual({ success: false, unchanged: true, announced: false });
    expect(insert).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "role_unchanged", subjectTelegramId: 42, details: expect.objectContaining({ requestedRole: "vip" }) }));
  });

  it("rejects protected Kronos owner delegation by a Telegram group administrator", async () => {
    const actorTelegramId = OWNER_TELEGRAM_ID + 10;
    const records = [[{ chatId: -100700, status: "active" }], [{ id: 11, telegramRole: "member" }], [{ chatId: -100700 }], [{ firstName: "Ava", lastName: null, username: "ava" }], []];
    const select = vi.fn(() => readChain(records.shift() ?? []));
    vi.mocked(getDb).mockResolvedValue({ select } as never);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getChatMember: vi.fn().mockResolvedValue({ status: "administrator", user: { id: actorTelegramId, is_bot: false, first_name: "Admin" } }) } } as never);
    const token = await issueDashboardSession({ telegramUserId: actorTelegramId, firstName: "Admin" });

    await expect(ownerCaller(token).dashboard.members.setKronosRole({ groupId: 7, targetTelegramId: 42, role: "kronos_owner" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("denies member-role administration to internal moderators, VIPs, and ordinary users without live Telegram administration", async () => {
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => readChain([{ chatId: -100700, status: "active" }])) } as never);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getChatMember: vi.fn().mockResolvedValue({ status: "member", user: { id: 1, is_bot: false, first_name: "Member" } }) } } as never);

    for (const [label, telegramUserId] of [["moderator", 8121], ["vip", 8122], ["user", 8123]] as const) {
      const token = await issueDashboardSession({ telegramUserId, firstName: label });
      await expect(ownerCaller(token).dashboard.members.setKronosRole({ groupId: 7, targetTelegramId: 42, role: "moderator" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("promotes a known member to a real Telegram administrator and announces the result", async () => {
    const records = [[{ chatId: -100700, status: "active" }], [{ id: 11, telegramRole: "member" }], [{ chatId: -100700 }], [{ firstName: "Mina", lastName: null, username: "mina" }]];
    const select = vi.fn(() => readChain(records.shift() ?? []));
    vi.mocked(getDb).mockResolvedValue({ select } as never);
    const promoteChatMember = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getChatMember: liveAdministrator, promoteChatMember, sendMessage } } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });

    await expect(ownerCaller(token).dashboard.members.setTelegramRole({ groupId: 7, targetTelegramId: 42, role: "telegram_admin" })).resolves.toEqual({ success: true, unchanged: false, announced: true });
    expect(promoteChatMember).toHaveBeenCalledWith(-100700, 42, expect.objectContaining({ can_manage_chat: true, can_promote_members: false }));
    expect(recordKnownGroupMember).toHaveBeenCalledWith({ groupId: 7, telegramUserId: 42, status: "active", telegramRole: "administrator" });
    expect(sendMessage).toHaveBeenCalledWith(-100700, expect.stringContaining("به مدیر تلگرام تغییر مقام پیدا کرد."), { parse_mode: "HTML" });
    expect(sendMessage).toHaveBeenCalledWith(-100700, expect.stringContaining('tg://user?id=42'), { parse_mode: "HTML" });
  });

  it("refreshes Telegram administrators and persists only the allowed administrator discovery data", async () => {
    const records = [[{ chatId: -100700, status: "active" }], [{ chatId: -100700 }]];
    const select = vi.fn(() => readChain(records.shift() ?? []));
    vi.mocked(getDb).mockResolvedValue({ select } as never);
    const getChatAdministrators = vi.fn().mockResolvedValue([
      { status: "creator", user: { id: 10, is_bot: false, first_name: "Owner" } },
      { status: "administrator", user: { id: 20, is_bot: false, first_name: "Admin" } },
    ]);
    const getChatMembersCount = vi.fn().mockResolvedValue(147);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getChatMember: liveAdministrator, getChatAdministrators, getChatMembersCount } } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });

    await expect(ownerCaller(token).dashboard.members.refreshAdmins({ groupId: 7 })).resolves.toEqual({ refreshedAdministrators: 2, totalTelegramMembers: 147 });
    expect(getChatAdministrators).toHaveBeenCalledWith(-100700);
    expect(getChatMembersCount).toHaveBeenCalledWith(-100700);
    expect(recordTelegramUser).toHaveBeenCalledTimes(3);
    expect(recordKnownGroupMember).toHaveBeenCalledWith({ groupId: 7, telegramUserId: 10, status: "active", telegramRole: "owner" });
    expect(recordKnownGroupMember).toHaveBeenCalledWith({ groupId: 7, telegramUserId: 20, status: "active", telegramRole: "administrator" });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ category: "dashboard_members", event: "telegram_administrators_refreshed", details: { administrators: 2, totalTelegramMembers: 147 } }));
  });
});
