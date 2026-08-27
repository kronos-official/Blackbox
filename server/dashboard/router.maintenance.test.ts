import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../telegram/repository", () => ({
  recordKnownGroupMember: vi.fn(async () => undefined),
  recordTelegramUser: vi.fn(async () => undefined),
  writeAuditLog: vi.fn(async () => undefined),
}));
vi.mock("../telegram/bot", () => ({ getTelegramBot: vi.fn() }));

import {
  auditLogs,
  channelListings,
  contentLocks,
  customCommands,
  filterRules,
  forcedJoinAcquisitions,
  forcedJoinChannels,
  forcedJoinSessions,
  globalAdmins,
  groupMembers,
  groupRoles,
  groupSettings,
  marketplacePaymentSettings,
  moderationActions,
  moderationNotes,
  ownerAlerts,
  paymentOrders,
  paymentReceipts,
  scheduledJobs,
  telegramGroups,
  telegramUsers,
  userWarnings,
  webhookEvents,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { getTelegramBot } from "../telegram/bot";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { DATABASE_RESET_CONFIRMATION } from "./router";
import { issueDashboardSession, issueOwnerDashboardSession } from "./telegramMiniAppAuth";
import { OWNER_TELEGRAM_ID } from "../telegram/constants";

function caller(token: string) {
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

describe("owner database maintenance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a reset without the exact confirmation phrase before a transaction begins", async () => {
    const transaction = vi.fn();
    vi.mocked(getDb).mockResolvedValue({ transaction } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });

    await expect(caller(token).dashboard.maintenance.resetDatabase({ confirmation: "delete everything" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("rejects a confirmed reset from any signed Telegram user other than the sole bot owner", async () => {
    const transaction = vi.fn();
    vi.mocked(getDb).mockResolvedValue({ transaction } as never);
    const token = await issueDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID + 1, firstName: "Not owner" });

    await expect(caller(token).dashboard.maintenance.resetDatabase({ confirmation: DATABASE_RESET_CONFIRMATION })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("deletes all bot-managed database records child-first and leaves an auditable reset record", async () => {
    const deleted: unknown[] = [];
    const deleteRow = vi.fn((table: unknown) => { deleted.push(table); return Promise.resolve(); });
    const values = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn(() => ({ values }));
    const transaction = vi.fn(async (work: (tx: unknown) => Promise<void>) => work({ delete: deleteRow, insert }));
    vi.mocked(getDb).mockResolvedValue({ transaction } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });

    await expect(caller(token).dashboard.maintenance.resetDatabase({ confirmation: DATABASE_RESET_CONFIRMATION })).resolves.toMatchObject({ success: true, retained: expect.arrayContaining(["deployment identity", "Heartbeat schedule"]) });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deleted).toEqual([
      paymentReceipts, paymentOrders, channelListings, forcedJoinSessions, forcedJoinAcquisitions, forcedJoinChannels, scheduledJobs,
      moderationActions, moderationNotes, userWarnings, contentLocks, filterRules, customCommands, groupRoles,
      groupMembers, groupSettings, globalAdmins, marketplacePaymentSettings, ownerAlerts, webhookEvents, auditLogs,
      telegramGroups, telegramUsers,
    ]);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ category: "owner_maintenance", event: "database_reset_completed", actorTelegramId: OWNER_TELEGRAM_ID }));
  });

  it("marks an active group removed when Telegram reports the bot has left it", async () => {
    const records = [[{ id: 7, chatId: -100700, title: "Old group" }]];
    const select = vi.fn(() => readChain(records.shift() ?? []));
    const set = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
    const update = vi.fn(() => ({ set }));
    vi.mocked(getDb).mockResolvedValue({ select, update } as never);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getMe: vi.fn().mockResolvedValue({ id: 999 }), getChatMember: vi.fn().mockResolvedValue({ status: "left" }) } } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });

    await expect(caller(token).dashboard.maintenance.reconcileStaleGroups()).resolves.toMatchObject({ checked: 1, removed: 1, permissionLost: 0 });
    expect(set).toHaveBeenCalledWith({ status: "removed" });
  });
});
