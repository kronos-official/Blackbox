import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock, createNotificationMock, getPrivateDeliveryMock, getCryptoMarketAssetMock, getTelegramBotMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  createNotificationMock: vi.fn(),
  getPrivateDeliveryMock: vi.fn(),
  getCryptoMarketAssetMock: vi.fn(),
  getTelegramBotMock: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: getDbMock }));
vi.mock("../notifications", () => ({ createUserNotification: createNotificationMock, getUserPrivateDelivery: getPrivateDeliveryMock }));
vi.mock("./cryptoMarket", () => ({ getCryptoMarketAsset: getCryptoMarketAssetMock }));
vi.mock("../telegram/bot", () => ({ getTelegramBot: getTelegramBotMock }));
vi.mock("../telegram/retry", () => ({ withTelegramRetry: (operation: () => Promise<unknown>) => operation() }));
vi.mock("../_core/heartbeat", () => ({ createHeartbeatJob: vi.fn(), updateHeartbeatJob: vi.fn() }));

import { runCryptoMarketAlerts } from "./cryptoMarketAlerts";

describe("retired crypto-market alerts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("safely ignores every legacy market-alert callback before any price request or delivery", async () => {
    await expect(runCryptoMarketAlerts("task-market-910")).resolves.toEqual({
      skipped: "market_alerts_retired",
      taskUid: "task-market-910",
    });
    expect(getDbMock).not.toHaveBeenCalled();
    expect(getCryptoMarketAssetMock).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(getPrivateDeliveryMock).not.toHaveBeenCalled();
    expect(getTelegramBotMock).not.toHaveBeenCalled();
  });
});
