import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../telegram/repository", () => ({ recordKnownGroupMember: vi.fn(), recordTelegramUser: vi.fn(), writeAuditLog: vi.fn() }));
vi.mock("../telegram/bot", () => ({ getTelegramBot: vi.fn() }));
vi.mock("../payments/marketplace", () => ({
  approveManualOrderByOwner: vi.fn(),
  createStarsInvoiceLinkForDashboard: vi.fn(),
  getMarketplaceCapacity: vi.fn(),
  sendCustomStarsInvoice: vi.fn(),
  STARS_PER_DAY: 10,
}));

import { getDb } from "../db";
import { sendCustomStarsInvoice } from "../payments/marketplace";
import { getTelegramBot } from "../telegram/bot";
import { appRouter } from "../routers";
import { issueDashboardSession, issueOwnerDashboardSession } from "./telegramMiniAppAuth";
import { OWNER_TELEGRAM_ID } from "../telegram/constants";
import type { TrpcContext } from "../_core/context";

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

const payload = { targetReference: "@ChannelOwner", channelChatId: -1003795743979, amountStars: 77, days: 30, expiresInHours: 24 };

describe("owner custom Stars invoice endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendCustomStarsInvoice).mockResolvedValue({ publicId: "KG-CUSTOM77", amountStars: 77, targetTelegramId: 12345, channel: { chatId: payload.channelChatId, title: "Channel" }, expiresAt: new Date("2026-08-17T00:00:00Z") });
  });

  it("permits only the Telegram bot owner and resolves a case-insensitive @username", async () => {
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => readChain([{ telegramUserId: 12345, startedBotAt: new Date("2026-08-16T00:00:00Z") }])) } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    await expect(caller(token).dashboard.marketplace.sendCustomInvoice(payload)).resolves.toMatchObject({ publicId: "KG-CUSTOM77", targetTelegramId: 12345 });
    expect(sendCustomStarsInvoice).toHaveBeenCalledWith(expect.objectContaining({ ownerTelegramId: OWNER_TELEGRAM_ID, targetTelegramId: 12345, channelChatId: payload.channelChatId, amountStars: 77, days: 30, expiresInHours: 24 }));
  });

  it("accepts a direct t.me link as the recipient reference", async () => {
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => readChain([{ telegramUserId: 12345, startedBotAt: new Date("2026-08-16T00:00:00Z") }])) } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    await expect(caller(token).dashboard.marketplace.sendCustomInvoice({ ...payload, targetReference: "https://t.me/ChannelOwner?start=invoice" })).resolves.toMatchObject({ publicId: "KG-CUSTOM77", targetTelegramId: 12345 });
    expect(sendCustomStarsInvoice).toHaveBeenCalledWith(expect.objectContaining({ targetTelegramId: 12345 }));
  });

  it("rejects a non-owner before resolving or invoicing a recipient", async () => {
    const token = await issueDashboardSession({ telegramUserId: 12345 });
    await expect(caller(token).dashboard.marketplace.sendCustomInvoice(payload)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getDb).not.toHaveBeenCalled();
    expect(sendCustomStarsInvoice).not.toHaveBeenCalled();
  });

  it("requires the recipient to have started a private conversation with the bot", async () => {
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn(() => readChain([{ telegramUserId: 12345, startedBotAt: null }])) } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    await expect(caller(token).dashboard.marketplace.sendCustomInvoice(payload)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(sendCustomStarsInvoice).not.toHaveBeenCalled();
  });

  it("rejects private invite links before calling Telegram getChat", async () => {
    const getChat = vi.fn();
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getChat } } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    await expect(caller(token).dashboard.marketplace.resolveCustomInvoiceChannel({ reference: "https://t.me/+fWU96lWDK_NkZTY0" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(getChat).not.toHaveBeenCalled();
  });

  it("accepts a numeric -100 destination in private mode and verifies it with Telegram", async () => {
    const getChat = vi.fn().mockResolvedValue({ id: -1004355838222, title: "Private Channel", type: "supergroup" });
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getChat, getMe: vi.fn().mockResolvedValue({ id: 8809324062 }), getChatMember: vi.fn().mockResolvedValue({ status: "administrator" }) } } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    await expect(caller(token).dashboard.marketplace.resolveCustomInvoiceChannel({ reference: "-1004355838222", destinationMode: "private" })).resolves.toMatchObject({ channelChatId: -1004355838222, title: "Private Channel" });
    expect(getChat).toHaveBeenCalledWith(-1004355838222);
  });

  it("rejects a username in private mode before contacting Telegram", async () => {
    const getChat = vi.fn();
    vi.mocked(getTelegramBot).mockReturnValue({ telegram: { getChat } } as never);
    const token = await issueOwnerDashboardSession({ telegramUserId: OWNER_TELEGRAM_ID });
    await expect(caller(token).dashboard.marketplace.resolveCustomInvoiceChannel({ reference: "@privatechannel", destinationMode: "private" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(getChat).not.toHaveBeenCalled();
  });
});
