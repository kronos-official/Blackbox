import { describe, expect, it, vi } from "vitest";
import { prepareTelegramWebApp, readTelegramInitData, waitForTelegramInitData, type TelegramBridgeWindow } from "./dashboardTelegramBridge";

describe("dashboard Telegram WebApp bridge", () => {
  it("reads only non-empty signed initData", () => {
    expect(readTelegramInitData({ Telegram: { WebApp: { initData: "  signed-payload  " } } })).toBe("signed-payload");
    expect(readTelegramInitData({ Telegram: { WebApp: { initData: "   " } } })).toBeNull();
    expect(readTelegramInitData({})).toBeNull();
  });

  it("waits for a bridge that becomes available after the initial render", async () => {
    let tick = 0;
    const ready = vi.fn();
    const target: TelegramBridgeWindow = { Telegram: { WebApp: { initData: "", ready } } };
    const sleep = vi.fn(async () => {
      tick += 1;
      if (tick === 2 && target.Telegram?.WebApp) target.Telegram.WebApp.initData = "desktop-signed-payload";
    });

    await expect(waitForTelegramInitData(target, { timeoutMs: 10, intervalMs: 1, sleep, now: () => tick })).resolves.toBe("desktop-signed-payload");
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("times out with an actionable bridge error instead of hanging forever", async () => {
    let now = 0;
    const target: TelegramBridgeWindow = { Telegram: { WebApp: { initData: "" } } };
    await expect(waitForTelegramInitData(target, { timeoutMs: 2, intervalMs: 1, now: () => now++, sleep: async () => undefined })).rejects.toThrow("signed initData");
  });

  it("treats ready and expand as best-effort Desktop presentation helpers", () => {
    const ready = vi.fn(() => { throw new Error("desktop bridge timing"); });
    const expand = vi.fn();
    expect(() => prepareTelegramWebApp({ Telegram: { WebApp: { initData: "signed", ready, expand } } })).not.toThrow();
    expect(ready).toHaveBeenCalledTimes(1);
    expect(expand).not.toHaveBeenCalled();
  });
});
