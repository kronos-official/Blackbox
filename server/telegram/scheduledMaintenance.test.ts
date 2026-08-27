import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("./bot", () => ({ getTelegramBot: vi.fn() }));
vi.mock("./repository", () => ({ writeAuditLog: vi.fn(), removeRecentGroupMessageIds: vi.fn() }));
vi.mock("./alerts", () => ({ alertOwner: vi.fn() }));

import { getDb } from "../db";
import { getTelegramBot } from "./bot";
import { removeRecentGroupMessageIds, writeAuditLog } from "./repository";
import { alertOwner } from "./alerts";
import { reconcileForcedJoinExpiry } from "./forcedJoin";
import { reconcileBotMaintenance, reconcileExpiredRaidMode, reconcileOutboundMessageAutoDeletion, reconcileTemporaryPunishments } from "./scheduledMaintenance";

function chain(rows: unknown[]) {
  const value: Record<string, unknown> = {};
  value.from = vi.fn(() => value);
  value.innerJoin = vi.fn(() => value);
  value.where = vi.fn(() => value);
  value.orderBy = vi.fn(() => value);
  value.limit = vi.fn(async () => rows);
  value.then = (resolve: (result: unknown[]) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
  return value;
}

function schedulerDb(selectRows: unknown[][]) {
  const select = vi.fn(() => chain(selectRows.shift() ?? []));
  const onDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn()
    .mockReturnValueOnce({ onDuplicateKeyUpdate })
    .mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values: insertValues });
  const updateWhere = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });
  const remove = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ affectedRows: 2 }]) });
  return { db: { select, insert, update, delete: remove }, select, insert, insertValues, onDuplicateKeyUpdate, update, updateSet, remove };
}

describe("idempotent scheduled maintenance", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unmutes an expired target once, records the reversal, and completes its scheduler ledger job", async () => {
    const fixture = schedulerDb([
      [{ id: 55, status: "pending" }],
      [{ id: 7, groupId: 4, targetTelegramId: 99, action: "mute", expiresAt: new Date("2026-08-14T00:00:00Z"), completedAt: null }],
      [{ id: 4, chatId: -1004, title: "Kronos" }],
    ]);
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    const restrictChatMember = vi.fn().mockResolvedValue(true);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { restrictChatMember } } as never);
    const result = await reconcileTemporaryPunishments(new Date("2026-08-14T01:00:00Z"));
    expect(result).toEqual({ skipped: false, unmuted: 1, unbanned: 0 });
    expect(restrictChatMember).toHaveBeenCalledWith(-1004, 99, expect.objectContaining({ permissions: expect.objectContaining({ can_send_messages: true }) }));
    expect(fixture.insertValues).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: 4, targetTelegramId: 99, action: "unmute", source: "scheduler" }));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "temporary_mute_expired", subjectTelegramId: 99 }));
    expect(fixture.onDuplicateKeyUpdate).toHaveBeenCalledWith({ set: expect.objectContaining({ idempotencyKey: expect.anything() }) });
  });

  it("skips temporary-punishment work when the interval idempotency ledger is already completed", async () => {
    const fixture = schedulerDb([[{ id: 55, status: "completed" }]]);
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    await expect(reconcileTemporaryPunishments(new Date("2026-08-14T01:00:00Z"))).resolves.toEqual({ skipped: true, unmuted: 0, unbanned: 0 });
    expect(getTelegramBot).not.toHaveBeenCalled();
  });

  it("resets only expired raid windows once and records a scheduler audit event", async () => {
    const fixture = schedulerDb([
      [{ id: 57, status: "pending" }],
      [{ groupId: 6 }],
    ]);
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);

    await expect(reconcileExpiredRaidMode(new Date("2026-08-14T01:00:00Z"))).resolves.toEqual({ skipped: false, reset: 1 });

    expect(fixture.updateSet).toHaveBeenCalledWith({ raidModeUntil: null });
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      category: "scheduler",
      event: "raid_mode_expired",
      groupId: 6,
    }));
  });

  it("does not retry a raid reset after its idempotency ledger job is completed", async () => {
    const fixture = schedulerDb([[{ id: 57, status: "completed" }]]);
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);

    await expect(reconcileExpiredRaidMode(new Date("2026-08-14T01:00:00Z"))).resolves.toEqual({ skipped: true, reset: 0 });
    expect(fixture.update).not.toHaveBeenCalled();
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("unbans an expired timed ban once and records its scheduler reversal", async () => {
    const fixture = schedulerDb([
      [{ id: 56, status: "pending" }],
      [{ id: 8, groupId: 5, targetTelegramId: 100, action: "ban", expiresAt: new Date("2026-08-14T00:00:00Z"), completedAt: null }],
      [{ id: 5, chatId: -1005, title: "Kronos" }],
    ]);
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    const unbanChatMember = vi.fn().mockResolvedValue(true);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { unbanChatMember } } as never);
    await expect(reconcileTemporaryPunishments(new Date("2026-08-14T01:01:00Z"))).resolves.toEqual({ skipped: false, unmuted: 0, unbanned: 1 });
    expect(unbanChatMember).toHaveBeenCalledWith(-1005, 100, { only_if_banned: true });
    expect(fixture.insertValues).toHaveBeenLastCalledWith(expect.objectContaining({ groupId: 5, targetTelegramId: 100, action: "unban", source: "scheduler" }));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "temporary_ban_expired", subjectTelegramId: 100 }));
  });

  it("prunes only old processed operational records through its own idempotent maintenance ledger", async () => {
    const fixture = schedulerDb([[{ id: 56, status: "pending" }]]);
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    await expect(reconcileBotMaintenance(new Date("2026-08-14T01:00:00Z"))).resolves.toEqual({ skipped: false, deletedWebhookEvents: 2, deletedCompletedJobs: 2 });
    expect(fixture.remove).toHaveBeenCalledTimes(2);
  });

  it("reconciles expired owner-managed bot-private forced-join channels through the idempotent expiry ledger", async () => {
    const fixture = schedulerDb([
      [{ id: 77, status: "pending" }],
      [{ id: 91, channelChatId: -10091, title: "Owner-managed channel", status: "active", expiresAt: new Date("2026-08-14T00:00:00Z") }],
    ]);
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    vi.mocked(getTelegramBot).mockReturnValue(undefined);

    await expect(reconcileForcedJoinExpiry(new Date("2026-08-14T01:00:00Z"))).resolves.toEqual({ skipped: false, expired: 1 });
    expect(fixture.updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: "expired" }));
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "listing_expired", details: expect.objectContaining({ channelId: 91 }) }));
  });

  it("deletes due bot-authored group messages and removes their durable queue entries", async () => {
    const fixture = schedulerDb([[
      { groupId: 9, messageId: 90, chatId: -1009 },
      { groupId: 9, messageId: 91, chatId: -1009 },
    ]]);
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    const deleteMessage = vi.fn().mockResolvedValue(true);
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { deleteMessage } } as never);

    await expect(reconcileOutboundMessageAutoDeletion(new Date("2026-08-20T20:25:00Z"))).resolves.toEqual({ due: 2, deleted: 2, retired: 0, retiredUnavailable: 0, retiredPermission: 0, retrying: 0 });
    expect(deleteMessage).toHaveBeenNthCalledWith(1, -1009, 90);
    expect(deleteMessage).toHaveBeenNthCalledWith(2, -1009, 91);
    expect(removeRecentGroupMessageIds).toHaveBeenCalledWith(9, [90, 91]);
  });

  it("retires messages Telegram reports as missing but preserves transient failures for the next run", async () => {
    const fixture = schedulerDb([[
      { groupId: 10, messageId: 100, chatId: -1010 },
      { groupId: 10, messageId: 101, chatId: -1010 },
    ]]);
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    const deleteMessage = vi.fn()
      .mockRejectedValueOnce({ response: { description: "Bad Request: message to delete not found" } })
      .mockRejectedValueOnce(new Error("network unavailable"));
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { deleteMessage } } as never);

    await expect(reconcileOutboundMessageAutoDeletion(new Date("2026-08-20T20:25:00Z"))).resolves.toEqual({ due: 2, deleted: 0, retired: 1, retiredUnavailable: 0, retiredPermission: 0, retrying: 1 });
    expect(removeRecentGroupMessageIds).toHaveBeenCalledWith(10, [100]);
  });

  it("retires messages for an unavailable group without retrying a known failed delivery context", async () => {
    const fixture = schedulerDb([[
      { groupId: 11, messageId: 110, chatId: -1011, groupStatus: "permission_lost", groupTitle: "Inactive group" },
    ]]);
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    const deleteMessage = vi.fn();
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { deleteMessage } } as never);

    await expect(reconcileOutboundMessageAutoDeletion(new Date("2026-08-20T20:25:00Z"))).resolves.toEqual({ due: 1, deleted: 0, retired: 1, retiredUnavailable: 1, retiredPermission: 0, retrying: 0 });
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(removeRecentGroupMessageIds).toHaveBeenCalledWith(11, [110]);
  });

  it("retires a permission failure, records it, and alerts the owner once for the group-day", async () => {
    const fixture = schedulerDb([[
      { groupId: 12, messageId: 120, chatId: -1012, groupStatus: "active", groupTitle: "Kronos Team" },
    ]]);
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    const deleteMessage = vi.fn().mockRejectedValue({ response: { description: "Bad Request: not enough rights to delete messages" } });
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { deleteMessage } } as never);

    await expect(reconcileOutboundMessageAutoDeletion(new Date("2026-08-20T20:25:00Z"))).resolves.toEqual({ due: 1, deleted: 0, retired: 1, retiredUnavailable: 0, retiredPermission: 1, retrying: 0 });
    expect(removeRecentGroupMessageIds).toHaveBeenCalledWith(12, [120]);
    expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ event: "outbound_message_auto_delete_permission_lost", groupId: 12 }));
    expect(alertOwner).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dedupeKey: "outbound-auto-delete-permission:12:2026-08-20" }));
  });
});
