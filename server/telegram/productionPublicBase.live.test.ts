import { describe, expect, it } from "vitest";
import { getTelegramMiniAppUrl } from "./persistentKeyboard";

describe("production public base", () => {
  it.skipIf(process.env.RUN_LIVE_PRODUCTION_TESTS !== "1")("resolves a secure Mini App URL and responds over HTTPS", async () => {
    const baseUrl = process.env.TELEGRAM_PUBLIC_BASE_URL;
    expect(baseUrl).toBe("https://kronosbot-krjvudkw.manus.space");
    expect(getTelegramMiniAppUrl()).toBe("https://kronosbot-krjvudkw.manus.space/dashboard");

    const response = await fetch(baseUrl!, { signal: AbortSignal.timeout(15_000) });
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});
