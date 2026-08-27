import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../telegram/repository", () => ({
  recordKnownGroupMember: vi.fn(async () => undefined),
  recordTelegramUser: vi.fn(async () => undefined),
  writeAuditLog: vi.fn(async () => undefined),
}));
vi.mock("../telegram/bot", () => ({ getTelegramBot: vi.fn() }));

import { getDb } from "../db";
import { writeAuditLog } from "../telegram/repository";
import { getTelegramBot } from "../telegram/bot";
import { appRouter } from "../routers";
import { issueOwnerDashboardSession } from "./telegramMiniAppAuth";
import { OWNER_TELEGRAM_ID } from "../telegram/constants";
import type { TrpcContext } from "../_core/context";
import { getEnabledLocks } from "../telegram/locks";
import { shouldEnforceLock } from "../telegram/groupSafety";

function ownerCaller(token: string) {
  const ctx: TrpcContext = { req: { header: (name: string) => name === "x-kronos-owner-session" ? token : undefined } as TrpcContext["req"], res: {} as TrpcContext["res"], user: null };
  return appRouter.createCaller(ctx);
}

function mutationDb() {
  const insertValues = vi.fn().mockReturnValue({ onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined) });
  const insert = vi.fn().mockReturnValue({ values: insertValues });
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });
  const select = vi.fn(() => readChain([{ chatId: -100700, status: "active" }]));
  return { db: { insert, update, select }, insert, insertValues, update, updateSet, updateWhere };
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

describe("owner dashboard moderation workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getChatMember: liveAdministrator } } as never);
  });

  it("persists an owner note and an audit record for the selected member", async () => {
    const fixture = mutationDb();
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    await expect(ownerCaller(token).dashboard.moderation.addNote({ groupId: 7, targetTelegramId: 42, body: "Repeated external links" })).resolves.toEqual({ success: true });
    expect(fixture.insert).toHaveBeenCalledTimes(1);
    expect(fixture.insertValues).toHaveBeenCalledWith({ groupId: 7, targetTelegramId: 42, body: "Repeated external links", authorTelegramId: OWNER_TELEGRAM_ID });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "note_added", groupId: 7, subjectTelegramId: 42 }));
  });

  it("resets warnings, records the unwarn action, and writes an audit entry", async () => {
    const fixture = mutationDb();
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    await expect(ownerCaller(token).dashboard.moderation.clearWarnings({ groupId: 7, targetTelegramId: 42 })).resolves.toEqual({ success: true });
    expect(fixture.updateSet).toHaveBeenCalledWith({ count: 0, lastReason: null });
    expect(fixture.insertValues).toHaveBeenCalledWith(expect.objectContaining({ groupId: 7, targetTelegramId: 42, action: "unwarn", source: "manual" }));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "warnings_cleared", groupId: 7, subjectTelegramId: 42 }));
  });

  it("upserts a content lock, applies it to safety enforcement, and announces the outcome in the group", async () => {
    const fixture = mutationDb();
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getChatMember: liveAdministrator, sendMessage } } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    await expect(ownerCaller(token).dashboard.moderation.setLock({ groupId: 7, lockType: "link", enabled: true, action: "mute", exemptionRole: "moderator" })).resolves.toEqual({ success: true, announced: true });
    expect(fixture.insertValues).toHaveBeenCalledWith({ groupId: 7, lockType: "link", enabled: true, action: "mute", exemptionRole: "moderator", updatedByTelegramId: OWNER_TELEGRAM_ID });
    expect(sendMessage).toHaveBeenCalledWith(-100700, expect.stringContaining("قفل لینک: <b>فعال شد</b>"), { parse_mode: "HTML" });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "lock_updated", details: { lockType: "link", enabled: true, announced: true } }));
  });

  it("persists a Mini App lock for the runtime safety reader and localizes the group announcement", async () => {
    const persistedLocks: Array<{ groupId: number; lockType: string; enabled: boolean; action: "delete" | "warn" | "mute"; exemptionRole: "none" | "vip" | "moderator" | "admin" }> = [];
    const insertValues = vi.fn((value: typeof persistedLocks[number]) => ({
      onDuplicateKeyUpdate: vi.fn(async ({ set }: { set: Partial<typeof persistedLocks[number]> }) => {
        const existing = persistedLocks.find(lock => lock.groupId === value.groupId && lock.lockType === value.lockType);
        if (existing) Object.assign(existing, value, set);
        else persistedLocks.push({ ...value, ...set } as typeof persistedLocks[number]);
      }),
    }));
    const selectRows = [
      [{ chatId: -100700, status: "active" }],
      [{ chatId: -100700, language: "en" }],
    ];
    const db = {
      insert: vi.fn().mockReturnValue({ values: insertValues }),
      select: vi.fn(() => readChain(selectRows.shift() ?? persistedLocks)),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getChatMember: liveAdministrator, sendMessage } } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });

    await ownerCaller(token).dashboard.moderation.setLock({ groupId: 7, lockType: "link", enabled: true, action: "delete", exemptionRole: "vip" });

    const locksVisibleToRuntime = await getEnabledLocks(7);
    expect(locksVisibleToRuntime).toEqual([expect.objectContaining({ lockType: "link", enabled: true, action: "delete", exemptionRole: "vip" })]);
    expect(shouldEnforceLock(locksVisibleToRuntime[0], ["link"], "user", false)).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(-100700, expect.stringContaining("Kronos protection settings updated"), { parse_mode: "HTML" });
    expect(sendMessage).toHaveBeenCalledWith(-100700, expect.stringContaining("Enabled"), { parse_mode: "HTML" });
  });

  it("persists the complete Mini App safety configuration, including welcome, goodbye, flood, duplicate, raid, and warning policy", async () => {
    const fixture = mutationDb();
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getChatMember: liveAdministrator, sendMessage } } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    const input = { groupId: 7, welcomeEnabled: true, welcomeMessage: "سلام {name}", goodbyeEnabled: true, goodbyeMessage: "خدانگهدار {name}", antiSpamEnabled: true, antiRaidEnabled: true, floodMessageLimit: 8, floodWindowSeconds: 15, duplicateMessageLimit: 3, warnLimit: 4, warnAction: "mute" as const, warnMuteMinutes: 90, rulesText: "بدون تبلیغ" };
    await expect(ownerCaller(token).dashboard.groups.updateSettings(input)).resolves.toEqual({ success: true });
    expect(fixture.insertValues).toHaveBeenCalledWith(input);
    expect(sendMessage).toHaveBeenCalledWith(-100700, expect.stringContaining("ضد اسپم: <b>فعال شد</b>"), { parse_mode: "HTML" });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "group_settings_updated", groupId: 7, actorTelegramId: OWNER_TELEGRAM_ID }));
  });

  it("accepts an explicit one-year automatic mute policy from the Mini App", async () => {
    const fixture = mutationDb();
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    const input = { groupId: 7, welcomeEnabled: true, welcomeMessage: null, goodbyeEnabled: false, goodbyeMessage: null, antiSpamEnabled: true, antiRaidEnabled: true, floodMessageLimit: 7, floodWindowSeconds: 12, duplicateMessageLimit: 3, warnLimit: 3, warnAction: "mute" as const, warnMuteMinutes: 525_600, rulesText: null };
    await expect(ownerCaller(token).dashboard.groups.updateSettings(input)).resolves.toEqual({ success: true });
    expect(fixture.insertValues).toHaveBeenCalledWith(input);
  });

  it("returns warnings, notes, locks, and action history together in the group moderation detail view", async () => {
    const records = [
      [{ chatId: -100700, status: "active" }],
      [{ id: 7, chatId: -1007, title: "Safety Test" }], [{ groupId: 7, antiSpamEnabled: true }], [{ id: 1, groupId: 7, lockType: "link", enabled: true }], [], [], [{ id: 3, groupId: 7, targetTelegramId: 42, body: "Observe" }], [{ id: 4, groupId: 7, telegramUserId: 42, count: 2 }], [{ id: 5, groupId: 7, action: "warn", targetTelegramId: 42 }],
    ];
    const select = vi.fn(() => readChain(records.shift() ?? []));
    vi.mocked(getDb).mockResolvedValue({ select } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    const detail = await ownerCaller(token).dashboard.groups.detail({ groupId: 7 });
    expect(detail).toMatchObject({ group: { id: 7 }, locks: [{ lockType: "link" }], notes: [{ body: "Observe" }], warnings: [{ count: 2 }], actions: [{ action: "warn" }] });
  });

  it("returns the chronological moderation-action history consumed by the Mini App review panel", async () => {
    const records = [
      [{ chatId: -100700, status: "active" }],
      [{ id: 7, chatId: -1007, title: "Safety Test" }], [], [], [], [], [], [],
      [{ id: 9, groupId: 7, action: "mute", targetTelegramId: 42, reason: "Flood" }, { id: 8, groupId: 7, action: "warn", targetTelegramId: 42, reason: "Duplicate" }],
    ];
    const select = vi.fn(() => readChain(records.shift() ?? []));
    vi.mocked(getDb).mockResolvedValue({ select } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    const detail = await ownerCaller(token).dashboard.groups.detail({ groupId: 7 });
    expect(detail?.actions).toEqual([
      expect.objectContaining({ id: 9, action: "mute", reason: "Flood" }),
      expect.objectContaining({ id: 8, action: "warn", reason: "Duplicate" }),
    ]);
  });
});
