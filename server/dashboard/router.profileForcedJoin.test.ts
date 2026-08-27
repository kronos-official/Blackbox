import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const mocks = vi.hoisted(() => ({
  required: vi.fn(),
  checked: vi.fn(),
}));

vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [] }),
      }),
    }),
  }),
}));

vi.mock("../telegram/forcedJoin", async importOriginal => {
  const actual = await importOriginal<typeof import("../telegram/forcedJoin")>();
  return { ...actual, getRequiredForcedJoinChannels: mocks.required, checkMiniAppForcedJoin: mocks.checked };
});

vi.mock("../telegram/bot", () => ({ getTelegramBot: () => ({ telegram: {} }) }));

import { appRouter } from "../routers";
import { issueDashboardSession } from "./telegramMiniAppAuth";

const channel = { id: 41, title: "Required channel", inviteUrl: "https://t.me/required", username: "required" };

async function profile() {
  const token = await issueDashboardSession({ telegramUserId: 800_001, firstName: "New user" });
  const ctx: TrpcContext = { req: { header: (name: string) => name === "x-kronos-owner-session" ? token : undefined } as TrpcContext["req"], res: {} as TrpcContext["res"], user: null };
  return appRouter.createCaller(ctx).dashboard.profile();
}

describe("Mini App profile forced-join gate", () => {
  beforeEach(() => {
    mocks.required.mockResolvedValue([channel]);
  });

  it("locks a signed user only when the active requirement is missing", async () => {
    mocks.checked.mockResolvedValue({ locked: true, unavailable: false, missing: [channel] });
    await expect(profile()).resolves.toMatchObject({ forcedJoinStatus: { locked: true, unavailable: false, missingCount: 1, missingChannels: [{ id: 41, title: "Required channel" }] } });
  });

  it("leaves the signed user unlocked after membership is verified for the same active requirement", async () => {
    mocks.checked.mockResolvedValue({ locked: false, unavailable: false, missing: [] });
    await expect(profile()).resolves.toMatchObject({ forcedJoinStatus: { locked: false, unavailable: false, missingCount: 0, missingChannels: [] } });
  });
});
