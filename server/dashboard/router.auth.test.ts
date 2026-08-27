import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import { issueDashboardSession, issueOwnerDashboardSession } from "./telegramMiniAppAuth";
import { OWNER_TELEGRAM_ID } from "../telegram/constants";
import type { TrpcContext } from "../_core/context";

function caller(token?: string) {
  const ctx: TrpcContext = {
    req: { header: (name: string) => name === "x-kronos-owner-session" ? token : undefined } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: null,
  };
  return appRouter.createCaller(ctx);
}

describe("owner dashboard procedure guard", () => {
  it("rejects unauthenticated callers across the dashboard API surface before data access", async () => {
    const api = caller();
    const actions = [
      () => api.dashboard.overview(),
      () => api.dashboard.cache.metrics(),
      () => api.dashboard.health(),
      () => api.dashboard.groups.list(),
      () => api.dashboard.groups.connected(),
      () => api.dashboard.groups.detail({ groupId: 1 }),
      () => api.dashboard.groups.updateSettings({ groupId: 1, welcomeEnabled: true, welcomeMessage: null, goodbyeEnabled: false, goodbyeMessage: null, antiSpamEnabled: true, antiRaidEnabled: true, floodMessageLimit: 7, floodWindowSeconds: 12, duplicateMessageLimit: 3, warnLimit: 3, warnAction: "mute" as const, warnMuteMinutes: 60, rulesText: null }),
      () => api.dashboard.profile(),
      () => api.dashboard.forcedJoin.list(),
      () => api.dashboard.forcedJoin.analytics(),
      () => api.dashboard.forcedJoin.upsert({ channelChatId: -1001, title: "Blocked", username: null, inviteUrl: null, scope: "global" as const, groupId: null, status: "active" as const, expiresAt: null }),
      () => api.dashboard.moderation.addNote({ groupId: 1, targetTelegramId: 2, body: "blocked" }),
      () => api.dashboard.moderation.clearWarnings({ groupId: 1, targetTelegramId: 2 }),
      () => api.dashboard.moderation.setLock({ groupId: 1, lockType: "link", enabled: true, action: "delete", exemptionRole: "vip" }),
      () => api.dashboard.marketplace.settings(),
      () => api.dashboard.marketplace.saveSettings({ starsPerDay: 10 }),
      () => api.dashboard.marketplace.starsMarketRate(),
      () => api.dashboard.marketplace.payments(),
      () => api.dashboard.marketplace.receiptUrl({ receiptId: 1 }),
      () => api.dashboard.marketplace.review({ publicId: "KG-INVALID", decision: "reject" as const }),
      () => api.dashboard.alerts.list(),
      () => api.dashboard.alerts.acknowledge({ alertId: 1 }),
      () => api.dashboard.audit(),
    ];
    for (const action of actions) await expect(action()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("allows the sole signed owner to call dashboard queries", async () => {
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID, firstName: "Owner" });
    await expect(caller(token).dashboard.overview()).resolves.toMatchObject({ groups: expect.any(Number), activeForcedJoin: expect.any(Number) });
    await expect(caller(token).dashboard.cache.metrics()).resolves.toMatchObject({ hits: expect.any(Number), misses: expect.any(Number), hitRate: expect.any(Number), entryCount: expect.any(Number) });
    await expect(caller(token).dashboard.health()).resolves.toMatchObject({ overall: expect.stringMatching(/healthy|degraded|unavailable/), database: { status: expect.stringMatching(/healthy|unavailable/) }, webhook: { received24h: expect.any(Number), failed24h: expect.any(Number) } });
    await expect(caller(token).dashboard.groups.connected()).resolves.toEqual(expect.any(Array));
  });

  it("permits a signed group user to discover only role-scoped groups while keeping global controls owner-only", async () => {
    const token = await issueDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID + 99, firstName: "Group user" });
    await expect(caller(token).dashboard.groups.list()).resolves.toEqual(expect.any(Array));
    await expect(caller(token).dashboard.groups.connected()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(token).dashboard.profile()).resolves.toMatchObject({ forcedJoinStatus: { locked: false, unavailable: false, missingCount: 0, missingChannels: [] } });
    await expect(caller(token).dashboard.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(token).dashboard.cache.metrics()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(token).dashboard.health()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(token).dashboard.forcedJoin.list()).resolves.toEqual([]);
    await expect(caller(token).dashboard.forcedJoin.analytics()).resolves.toEqual([]);
    await expect(caller(token).dashboard.forcedJoin.upsert({ destinationReference: "-1001", title: "Blocked", username: null, inviteUrl: null, scope: "global", groupId: null, status: "active", expiresAt: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
