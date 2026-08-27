import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock, createNotificationMock, getStarsReferenceMock, getTelegramBotMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  createNotificationMock: vi.fn(),
  getStarsReferenceMock: vi.fn(),
  getTelegramBotMock: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: getDbMock }));
vi.mock("../notifications", () => ({ createUserNotification: createNotificationMock }));
vi.mock("../marketplace/starsReferenceRate", () => ({ getStarsReferenceMarketData: getStarsReferenceMock }));
vi.mock("../telegram/bot", () => ({ getTelegramBot: getTelegramBotMock }));
vi.mock("../telegram/retry", () => ({ withTelegramRetry: (operation: () => Promise<unknown>) => operation() }));
vi.mock("../_core/heartbeat", () => ({ createHeartbeatJob: vi.fn(), updateHeartbeatJob: vi.fn() }));

import { runXtrRateAlert } from "./xtrRateAlerts";

describe("retired XTR rate alerts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("safely ignores legacy scheduled callbacks without reading prices or notifying users", async () => {
    await expect(runXtrRateAlert("task-xtr-91")).resolves.toEqual({
      skipped: "market_alerts_retired",
      taskUid: "task-xtr-91",
    });
    expect(getDbMock).not.toHaveBeenCalled();
    expect(getStarsReferenceMock).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(getTelegramBotMock).not.toHaveBeenCalled();
  });
});
