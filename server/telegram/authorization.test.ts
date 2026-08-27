import { describe, expect, it } from "vitest";
import { OWNER_TELEGRAM_ID } from "./constants";
import {
  hasAtLeastAccess,
  hasKronosModerationAccess,
  isOwnerTelegramId,
  mayModerateTarget,
  OwnerAccessDeniedError,
  requireOwnerTelegramId,
  resolveAccessLevel,
} from "./authorization";

describe("Kronos Guard owner authorization", () => {
  it("allows only the configured owner Telegram ID", () => {
    expect(isOwnerTelegramId(OWNER_TELEGRAM_ID)).toBe(true);
    expect(isOwnerTelegramId(OWNER_TELEGRAM_ID + 1)).toBe(false);
    expect(isOwnerTelegramId(undefined)).toBe(false);
  });

  it("throws a domain-specific error for non-owner protected actions", () => {
    expect(() => requireOwnerTelegramId(123456789)).toThrow(OwnerAccessDeniedError);
    expect(() => requireOwnerTelegramId(OWNER_TELEGRAM_ID)).not.toThrow();
  });

  it("resolves each role in strict hierarchy and preserves stored authority when membership lookup fails", async () => {
    const membership = { getChatMember: async (_chatId: number, userId: number) => {
      if (userId === 7 || userId === 8) throw new Error("Telegram lookup unavailable");
      return { status: userId === 4 ? "creator" : userId === 5 ? "administrator" : "member" };
    } };
    const dependencies = {
      isGlobalAdmin: async (userId: number) => userId === 3,
      hasModeratorRole: async (_groupId: number, userId: number) => userId === 6,
      getStoredGroupAccessLevel: async (_groupId: number, userId: number) => userId === 7 ? "group_admin" as const : userId === 8 ? "group_owner" as const : null,
    };

    await expect(resolveAccessLevel({ groupId: 1, groupChatId: -1001, telegramUserId: OWNER_TELEGRAM_ID }, membership, dependencies)).resolves.toBe("owner");
    await expect(resolveAccessLevel({ groupId: 1, groupChatId: -1001, telegramUserId: 3 }, membership, dependencies)).resolves.toBe("global_admin");
    await expect(resolveAccessLevel({ groupId: 1, groupChatId: -1001, telegramUserId: 4 }, membership, dependencies)).resolves.toBe("group_owner");
    await expect(resolveAccessLevel({ groupId: 1, groupChatId: -1001, telegramUserId: 5 }, membership, dependencies)).resolves.toBe("group_admin");
    await expect(resolveAccessLevel({ groupId: 1, groupChatId: -1001, telegramUserId: 6 }, membership, dependencies)).resolves.toBe("moderator");
    await expect(resolveAccessLevel({ groupId: 1, groupChatId: -1001, telegramUserId: 7 }, membership, dependencies)).resolves.toBe("group_admin");
    await expect(resolveAccessLevel({ groupId: 1, groupChatId: -1001, telegramUserId: 8 }, membership, dependencies)).resolves.toBe("group_owner");

    const brokenMembership = { getChatMember: async () => Promise.reject(new Error("not enough rights")) };
    await expect(resolveAccessLevel({ groupId: 1, groupChatId: -1001, telegramUserId: 6 }, brokenMembership, dependencies)).resolves.toBe("moderator");
    await expect(resolveAccessLevel({ groupId: 1, groupChatId: -1001, telegramUserId: 7 }, brokenMembership, dependencies)).resolves.toBe("group_admin");
  });

  it("does not trust stale stored Telegram administration after a live member response", async () => {
    const membership = { getChatMember: async () => ({ status: "member" }) };
    const dependencies = {
      isGlobalAdmin: async () => false,
      hasModeratorRole: async () => false,
      getStoredGroupAccessLevel: async () => "group_admin" as const,
    };

    await expect(resolveAccessLevel({ groupId: 1, groupChatId: -1001, telegramUserId: 77 }, membership, dependencies)).resolves.toBe("user");
  });

  it("suppresses a live Telegram administrator when Kronos authority was explicitly cleaned", async () => {
    const membership = { getChatMember: async () => ({ status: "administrator" }) };
    const dependencies = {
      isGlobalAdmin: async () => false,
      isGroupAuthoritySuspended: async (_groupId: number, userId: number) => userId === 79,
      hasModeratorRole: async () => false,
      getStoredGroupAccessLevel: async () => "group_admin" as const,
    };

    await expect(resolveAccessLevel({ groupId: 1, groupChatId: -1001, telegramUserId: 79 }, membership, dependencies)).resolves.toBe("user");
    await expect(resolveAccessLevel({ groupId: 1, groupChatId: -1001, telegramUserId: 80 }, membership, dependencies)).resolves.toBe("group_admin");
  });

  it("preserves an internal Kronos moderator while keeping Telegram rank non-administrative", async () => {
    const membership = { getChatMember: async () => ({ status: "member" }) };
    const dependencies = {
      isGlobalAdmin: async () => false,
      hasModeratorRole: async () => false,
      getStoredGroupAccessLevel: async () => "moderator" as const,
    };

    await expect(resolveAccessLevel({ groupId: 1, groupChatId: -1001, telegramUserId: 78 }, membership, dependencies)).resolves.toBe("moderator");
  });

  it("requires a strictly higher authority level for moderation", () => {
    expect(hasAtLeastAccess("group_admin", "moderator")).toBe(true);
    expect(mayModerateTarget("group_admin", "moderator")).toBe(true);
    expect(mayModerateTarget("moderator", "moderator")).toBe(false);
    expect(mayModerateTarget("moderator", "group_admin")).toBe(false);
    expect(mayModerateTarget("owner", "global_admin")).toBe(true);
  });

  it("allows the internal moderation tier to operate bot-managed group controls only", () => {
    expect(hasKronosModerationAccess("owner")).toBe(true);
    expect(hasKronosModerationAccess("global_admin")).toBe(true);
    expect(hasKronosModerationAccess("group_owner")).toBe(true);
    expect(hasKronosModerationAccess("group_admin")).toBe(true);
    expect(hasKronosModerationAccess("moderator")).toBe(true);
    expect(hasKronosModerationAccess("user")).toBe(false);
  });
});
