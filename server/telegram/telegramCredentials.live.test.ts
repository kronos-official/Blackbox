import { describe, expect, it } from "vitest";
import { hasValidWebhookSecret } from "./webhookSecurity";

describe("Telegram deployment credentials", () => {
  it("accepts only the configured webhook secret", () => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    expect(secret).toBeTruthy();
    expect(hasValidWebhookSecret(secret)).toBe(true);
    expect(hasValidWebhookSecret(`${secret ?? ""}x`)).toBe(false);
  });

  it.skipIf(process.env.RUN_LIVE_TELEGRAM_TESTS !== "1")("authenticates the configured bot with Telegram's lightweight getMe endpoint", async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    expect(token).toMatch(/^\d+:[A-Za-z0-9_-]{20,}$/);

    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json() as { ok?: boolean; result?: { username?: string; is_bot?: boolean } };

    expect(response.ok).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.result?.is_bot).toBe(true);
    expect(body.result?.username).toBe("kronosguard_bot");
  });
});
