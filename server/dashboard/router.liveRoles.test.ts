import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../telegram/repository", () => ({
  isGlobalAdmin: vi.fn(async () => false),
  recordKnownGroupMember: vi.fn(async () => undefined),
  recordTelegramUser: vi.fn(async () => undefined),
  setTelegramGroupStatus: vi.fn(async () => undefined),
  writeAuditLog: vi.fn(async () => undefined),
}));
vi.mock("../telegram/bot", () => ({ getTelegramBot: vi.fn() }));

import { getDb } from "../db";
import { getTelegramBot } from "../telegram/bot";
import { recordKnownGroupMember } from "../telegram/repository";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { issueDashboardSession } from "./telegramMiniAppAuth";
import { OWNER_TELEGRAM_ID } from "../telegram/constants";

function readChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "orderBy"]) chain[method] = vi.fn(() => chain);
  chain.limit = vi.fn(async () => rows);
  chain.then = (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function caller(token: string) {
  const ctx: TrpcContext = { req: { header: (name: string) => name === "x-kronos-owner-session" ? token : undefined } as TrpcContext["req"], res: {} as TrpcContext["res"], user: null };
  return appRouter.createCaller(ctx);
}

describe("dashboard live Telegram group access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("admits a current Telegram group owner even when the owner has no stored group-member row", async () => {
    const actorTelegramId = 7291;
    const selectRecords = [
      [{ id: 7, chatId: -100700, title: "Live owner group", status: "active", lastActivityAt: new Date() }],
      [],
      [{ chatId: -100700, ownerTelegramId: actorTelegramId }],
      [],
      [],
    ];
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => readChain(selectRecords.shift() ?? [])) } as never);
    const getChatMember = vi.fn()
      .mockResolvedValueOnce({ status: "administrator", user: { id: 8809324062, is_bot: true, first_name: "Kronos Guard" } })
      .mockResolvedValueOnce({ status: "creator", user: { id: actorTelegramId, is_bot: false, first_name: "Live Owner" } });
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getMe: vi.fn().mockResolvedValue({ id: 8809324062, is_bot: true, first_name: "Kronos Guard" }), getChatMember } } as never);
    const token = await issueDashboardSession({ telegramUserId: actorTelegramId, firstName: "Live Owner" });

    await expect(caller(token).dashboard.groups.list()).resolves.toMatchObject([{ id: 7, access: "group_owner" }]);
    expect(getChatMember).toHaveBeenCalledWith(-100700, actorTelegramId);
    expect(recordKnownGroupMember).toHaveBeenCalledWith({ groupId: 7, telegramUserId: actorTelegramId, status: "active", telegramRole: "owner" });
  });

  it("recovers a real Telegram group creator when a legacy installer binding points elsewhere", async () => {
    const actorTelegramId = 7290;
    const selectRecords = [
      [{ id: 7, chatId: -100700, title: "Creator-owned group", status: "active", ownerTelegramId: 7295, lastActivityAt: new Date() }],
      [],
      [{ chatId: -100700, status: "active" }],
    ];
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => readChain(selectRecords.shift() ?? [])) } as never);
    const getChatMember = vi.fn()
      .mockResolvedValueOnce({ status: "administrator", user: { id: 8809324062, is_bot: true, first_name: "Kronos Guard" } })
      .mockResolvedValueOnce({ status: "creator", user: { id: actorTelegramId, is_bot: false, first_name: "Creator" } });
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getMe: vi.fn().mockResolvedValue({ id: 8809324062, is_bot: true, first_name: "Kronos Guard" }), getChatMember } } as never);
    const token = await issueDashboardSession({ telegramUserId: actorTelegramId, firstName: "Creator" });

    await expect(caller(token).dashboard.groups.list()).resolves.toMatchObject([{ id: 7, access: "group_owner" }]);
    expect(getChatMember).toHaveBeenCalledWith(-100700, actorTelegramId);
  });

  it("lists an active group to the sole bot owner only when that signed owner is also a current group administrator", async () => {
    const selectRecords = [
      [{ id: 7, chatId: -100700, title: "Private installer group", status: "active", ownerTelegramId: OWNER_TELEGRAM_ID + 1, lastActivityAt: new Date() }],
      [],
      [{ chatId: -100700, status: "active" }],
    ];
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => readChain(selectRecords.shift() ?? [])) } as never);
    const getChatMember = vi.fn()
      .mockResolvedValueOnce({ status: "administrator", user: { id: 8809324062, is_bot: true, first_name: "Kronos Guard" } })
      .mockResolvedValueOnce({ status: "administrator", user: { id: OWNER_TELEGRAM_ID, is_bot: false, first_name: "Kronos Owner" } });
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getMe: vi.fn().mockResolvedValue({ id: 8809324062, is_bot: true, first_name: "Kronos Guard" }), getChatMember } } as never);
    const token = await issueDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID, firstName: "Kronos Owner" });

    await expect(caller(token).dashboard.groups.list()).resolves.toMatchObject([{ id: 7, access: "group_admin" }]);
    expect(getChatMember).toHaveBeenCalledWith(-100700, 8809324062);
    expect(getChatMember).toHaveBeenCalledWith(-100700, OWNER_TELEGRAM_ID);
  });

  it("does not list a group merely because an ordinary member has been observed by the bot", async () => {
    const actorTelegramId = 7292;
    const selectRecords = [
      [{ id: 7, chatId: -100700, title: "Member-only group", status: "active", lastActivityAt: new Date() }],
      [],
      [{ chatId: -100700, ownerTelegramId: actorTelegramId }],
    ];
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => readChain(selectRecords.shift() ?? [])) } as never);
    const getChatMember = vi.fn()
      .mockResolvedValueOnce({ status: "administrator", user: { id: 8809324062, is_bot: true, first_name: "Kronos Guard" } })
      .mockResolvedValueOnce({ status: "member", user: { id: actorTelegramId, is_bot: false, first_name: "Ordinary Member" } });
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getMe: vi.fn().mockResolvedValue({ id: 8809324062, is_bot: true, first_name: "Kronos Guard" }), getChatMember } } as never);
    const token = await issueDashboardSession({ telegramUserId: actorTelegramId, firstName: "Ordinary Member" });

    await expect(caller(token).dashboard.groups.list()).resolves.toEqual([]);
    expect(getChatMember).toHaveBeenCalledWith(-100700, actorTelegramId);
    expect(recordKnownGroupMember).not.toHaveBeenCalled();
  });

  it("lists a group to another current Telegram administrator without relying on a stale installer binding", async () => {
    const actorTelegramId = 7294;
    const selectRecords = [
      [{ id: 7, chatId: -100700, title: "Private installer group", status: "active", lastActivityAt: new Date() }],
      [],
      [{ chatId: -100700, status: "active" }],
    ];
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => readChain(selectRecords.shift() ?? [])) } as never);
    const getChatMember = vi.fn()
      .mockResolvedValueOnce({ status: "administrator", user: { id: 8809324062, is_bot: true, first_name: "Kronos Guard" } })
      .mockResolvedValueOnce({ status: "administrator", user: { id: actorTelegramId, is_bot: false, first_name: "Other Admin" } });
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getMe: vi.fn().mockResolvedValue({ id: 8809324062, is_bot: true, first_name: "Kronos Guard" }), getChatMember } } as never);
    const token = await issueDashboardSession({ telegramUserId: actorTelegramId, firstName: "Other Admin" });

    await expect(caller(token).dashboard.groups.list()).resolves.toMatchObject([{ id: 7, access: "group_admin" }]);
    expect(getChatMember).toHaveBeenCalledWith(-100700, 8809324062);
    expect(getChatMember).toHaveBeenCalledWith(-100700, actorTelegramId);
  });

  it("fails closed when a Telegram response does not identify the signed Mini App user", async () => {
    const actorTelegramId = 7293;
    const selectRecords = [
      [{ id: 7, chatId: -100700, title: "Identity mismatch group", status: "active", lastActivityAt: new Date() }],
      [],
      [{ chatId: -100700, ownerTelegramId: actorTelegramId }],
    ];
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => readChain(selectRecords.shift() ?? [])) } as never);
    const getChatMember = vi.fn()
      .mockResolvedValueOnce({ status: "administrator", user: { id: 8809324062, is_bot: true, first_name: "Kronos Guard" } })
      .mockResolvedValueOnce({ status: "administrator", user: { id: 999_999, is_bot: false, first_name: "Different account" } });
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getMe: vi.fn().mockResolvedValue({ id: 8809324062, is_bot: true, first_name: "Kronos Guard" }), getChatMember } } as never);
    const token = await issueDashboardSession({ telegramUserId: actorTelegramId, firstName: "Signed user" });

    await expect(caller(token).dashboard.groups.list()).resolves.toEqual([]);
    expect(recordKnownGroupMember).not.toHaveBeenCalled();
  });

  it("blocks direct dashboard detail access after a group is marked removed, including for the bot owner", async () => {
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => readChain([{ chatId: -100700, status: "removed" }])) } as never);
    const token = await issueDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID, firstName: "Kronos Owner" });

    await expect(caller(token).dashboard.groups.detail({ groupId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getTelegramBot).not.toHaveBeenCalled();
  });
});
