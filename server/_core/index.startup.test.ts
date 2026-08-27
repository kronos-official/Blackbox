import { describe, expect, it, vi } from "vitest";

const telegram = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock("../telegram/bot", () => ({ initializeTelegramBot: vi.fn().mockRejectedValue(new Error("entry startup failure")) }));
vi.mock("../telegram/alerts", () => ({ alertOwner: vi.fn() }));
vi.mock("telegraf", () => ({ Telegraf: vi.fn(() => ({ telegram })) }));

import { alertOwner } from "../telegram/alerts";
import { initializeServiceRuntime } from "./index";

describe("service startup entry point", () => {
  it("propagates a real bot bootstrap failure from the service entry point to the owner alert", async () => {
    await initializeServiceRuntime();

    expect(alertOwner).toHaveBeenCalledWith(telegram, expect.objectContaining({
      alertType: "database_problem",
      severity: "critical",
      title: "راه‌اندازی Kronos Guard ناموفق بود",
      body: expect.stringContaining("entry startup failure"),
    }));
  });
});
