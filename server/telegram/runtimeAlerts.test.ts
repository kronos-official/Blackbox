import { describe, expect, it, vi } from "vitest";

const telegram = { sendMessage: vi.fn() };
vi.mock("telegraf", () => ({ Telegraf: vi.fn(() => ({ telegram })) }));
vi.mock("./alerts", () => ({ alertOwner: vi.fn() }));

import { alertOwner } from "./alerts";
import { notifyBotInitializationFailure } from "./runtimeAlerts";

describe("bot runtime alerts", () => {
  it("sends a deduplicated critical alert to the owner when initialization fails", async () => {
    const notified = await notifyBotInitializationFailure(new Error("database unavailable"), "test-token");

    expect(notified).toBe(true);
    expect(alertOwner).toHaveBeenCalledWith(telegram, expect.objectContaining({
      alertType: "database_problem",
      severity: "critical",
      title: "راه‌اندازی Kronos Guard ناموفق بود",
      body: expect.stringContaining("database unavailable"),
      relatedEntityType: "telegram_owner",
    }));
  });

  it("does not attempt a delivery when no bot token is configured", async () => {
    const notified = await notifyBotInitializationFailure(new Error("missing token"), "");
    expect(notified).toBe(false);
  });
});
