import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../storage", () => ({ storageGetSignedUrl: vi.fn(async (key: string) => `https://signed.example/${key}`) }));

import { getDb } from "../db";
import { storageGetSignedUrl } from "../storage";
import { appRouter } from "../routers";
import { issueOwnerDashboardSession } from "./telegramMiniAppAuth";
import { OWNER_TELEGRAM_ID } from "../telegram/constants";
import type { TrpcContext } from "../_core/context";

function ownerCaller(token: string) {
  const ctx: TrpcContext = {
    req: { header: (name: string) => name === "x-kronos-owner-session" ? token : undefined } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: null,
  };
  return appRouter.createCaller(ctx);
}

function mockReceiptLookup(receipt: { id: number; storageKey: string; deletedAt: null } | undefined) {
  const limit = vi.fn().mockResolvedValue(receipt ? [receipt] : []);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  vi.mocked(getDb).mockResolvedValue({ select: vi.fn().mockReturnValue({ from }) } as never);
}

describe("owner dashboard receiptUrl procedure", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a signed receipt link for an authenticated owner and an existing non-deleted receipt", async () => {
    mockReceiptLookup({ id: 9, storageKey: "payment-receipts/9/receipt.jpg", deletedAt: null });
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    await expect(ownerCaller(token).dashboard.marketplace.receiptUrl({ receiptId: 9 })).resolves.toEqual({ url: "https://signed.example/payment-receipts/9/receipt.jpg", expiresInSeconds: 300 });
    expect(storageGetSignedUrl).toHaveBeenCalledWith("payment-receipts/9/receipt.jpg");
  });

  it("returns NOT_FOUND without signing a URL when the receipt is missing or removed", async () => {
    mockReceiptLookup(undefined);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    await expect(ownerCaller(token).dashboard.marketplace.receiptUrl({ receiptId: 404 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(storageGetSignedUrl).not.toHaveBeenCalled();
  });
});
