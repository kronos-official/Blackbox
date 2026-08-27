import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./bot", () => ({ initializeTelegramBot: vi.fn() }));
vi.mock("./runtimeAlerts", () => ({ notifyBotInitializationFailure: vi.fn() }));
vi.mock("./routes", () => ({ botRuntimeState: { botReady: false } }));

import { initializeTelegramBot } from "./bot";
import { notifyBotInitializationFailure } from "./runtimeAlerts";
import { botRuntimeState } from "./routes";
import { startTelegramRuntime } from "./runtimeBootstrap";

describe("Telegram runtime bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    botRuntimeState.botReady = false;
  });

  it("marks the runtime ready after successful initialization", async () => {
    vi.mocked(initializeTelegramBot).mockResolvedValue(undefined);

    await startTelegramRuntime();

    expect(botRuntimeState.botReady).toBe(true);
    expect(notifyBotInitializationFailure).not.toHaveBeenCalled();
  });

  it("propagates initialization failure into an owner-alert attempt", async () => {
    const failure = new Error("startup test failure");
    vi.mocked(initializeTelegramBot).mockRejectedValue(failure);

    await startTelegramRuntime();

    expect(botRuntimeState.botReady).toBe(false);
    expect(notifyBotInitializationFailure).toHaveBeenCalledWith(failure);
  });
});
