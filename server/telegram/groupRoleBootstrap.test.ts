import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repository", () => ({
  recordKnownGroupMember: vi.fn(),
  recordTelegramUser: vi.fn(),
  upsertTelegramGroupAuthorityRole: vi.fn(),
}));

import { bootstrapTelegramGroupAuthorities, canBootstrapTelegramGroupRoles, groupRoleBootstrapProgressMessage } from "./groupRoleBootstrap";
import { recordKnownGroupMember, recordTelegramUser, upsertTelegramGroupAuthorityRole } from "./repository";

const user = (id: number, isBot = false) => ({ id, first_name: `کاربر ${id}`, is_bot: isBot }) as any;

describe("bootstrapTelegramGroupAuthorities", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps creator to group_owner and administrator to group_admin while excluding bots", async () => {
    const result = await bootstrapTelegramGroupAuthorities({
      groupId: 71,
      grantedByTelegramId: 9001,
      administrators: [
        { status: "creator", user: user(101) },
        { status: "owner", user: user(102) },
        { status: "administrator", user: user(104) },
        { status: "administrator", user: user(103, true) },
      ],
    });

    expect(result).toEqual({ syncedCount: 3, ownerCount: 2, administratorCount: 1 });
    expect(recordTelegramUser).toHaveBeenCalledTimes(3);
    expect(recordKnownGroupMember).toHaveBeenNthCalledWith(1, { groupId: 71, telegramUserId: 101, status: "active", telegramRole: "owner" });
    expect(recordKnownGroupMember).toHaveBeenNthCalledWith(2, { groupId: 71, telegramUserId: 102, status: "active", telegramRole: "owner" });
    expect(upsertTelegramGroupAuthorityRole).toHaveBeenCalledWith({ groupId: 71, telegramUserId: 101, role: "group_owner", grantedByTelegramId: 9001 });
    expect(upsertTelegramGroupAuthorityRole).toHaveBeenCalledWith({ groupId: 71, telegramUserId: 102, role: "group_owner", grantedByTelegramId: 9001 });
    expect(upsertTelegramGroupAuthorityRole).toHaveBeenCalledWith({ groupId: 71, telegramUserId: 104, role: "group_admin", grantedByTelegramId: 9001 });
    expect(upsertTelegramGroupAuthorityRole).not.toHaveBeenCalledWith(expect.objectContaining({ telegramUserId: 103 }));
  });

  it("allows the callback only for a live Telegram owner or administrator", () => {
    expect(canBootstrapTelegramGroupRoles("creator")).toBe(true);
    expect(canBootstrapTelegramGroupRoles("owner")).toBe(true);
    expect(canBootstrapTelegramGroupRoles("administrator")).toBe(true);
    expect(canBootstrapTelegramGroupRoles("member")).toBe(false);
    expect(canBootstrapTelegramGroupRoles("restricted")).toBe(false);
    expect(canBootstrapTelegramGroupRoles(undefined)).toBe(false);
  });

  it("reports progress from zero to one hundred in proportion to completed live members", async () => {
    const updates: Array<{ completed: number; total: number; percent: number }> = [];
    await bootstrapTelegramGroupAuthorities({
      groupId: 71,
      grantedByTelegramId: 9001,
      administrators: [{ status: "creator", user: user(101) }, { status: "administrator", user: user(102) }, { status: "administrator", user: user(103) }],
      onProgress: update => { updates.push(update); },
    });

    expect(updates).toEqual([
      { completed: 0, total: 3, percent: 0 },
      { completed: 1, total: 3, percent: 33 },
      { completed: 2, total: 3, percent: 67 },
      { completed: 3, total: 3, percent: 100 },
    ]);
    expect(groupRoleBootstrapProgressMessage(updates[2])).toContain("67٪");
  });

  it("can be run repeatedly because it only requests idempotent authority-role upserts and never removes manual roles", async () => {
    const input = { groupId: 71, grantedByTelegramId: 9001, administrators: [{ status: "administrator", user: user(102) }] };
    await bootstrapTelegramGroupAuthorities(input);
    await bootstrapTelegramGroupAuthorities(input);

    expect(upsertTelegramGroupAuthorityRole).toHaveBeenCalledTimes(2);
    expect(upsertTelegramGroupAuthorityRole).toHaveBeenLastCalledWith({ groupId: 71, telegramUserId: 102, role: "group_admin", grantedByTelegramId: 9001 });
  });

  it("marks an owner-led bootstrap as the explicit restoration point for cleaned authorities", async () => {
    await bootstrapTelegramGroupAuthorities({
      groupId: 71,
      grantedByTelegramId: 9001,
      restoreSuspensions: true,
      administrators: [{ status: "administrator", user: user(102) }],
    });

    expect(upsertTelegramGroupAuthorityRole).toHaveBeenCalledWith({ groupId: 71, telegramUserId: 102, role: "group_admin", grantedByTelegramId: 9001, restoreSuspension: true });
  });
});
