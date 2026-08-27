import { afterEach, describe, expect, it } from "vitest";
import { prepareTelegramWebApp, readTelegramInitData } from "./dashboardTelegramBridge";
import { safeStorageGet, safeStorageRemove, safeStorageSet } from "./safeStorage";

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else globalThis.window = originalWindow;
});

describe("Telegram WebView resilience", () => {
  it("treats unavailable local and session storage as empty instead of throwing", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        get localStorage() { throw new DOMException("storage blocked", "SecurityError"); },
        get sessionStorage() { throw new DOMException("storage blocked", "SecurityError"); },
      },
    });

    expect(safeStorageGet("local", "theme")).toBeNull();
    expect(safeStorageSet("session", "token", "secret")).toBe(false);
    expect(safeStorageRemove("local", "token")).toBe(false);
  });

  it("treats a missing Telegram bridge as a recoverable state", () => {
    const target = {};
    expect(readTelegramInitData(target)).toBeNull();
    expect(() => prepareTelegramWebApp(target)).not.toThrow();
  });
});
