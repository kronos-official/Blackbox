import { describe, expect, it } from "vitest";

function isTelegramNetworkUnavailable(error: unknown) {
  if (!(error instanceof TypeError) && !(error instanceof Error)) return false;
  const candidate = error as Error & { cause?: { code?: string } };
  const code = candidate.cause?.code;
  return ["UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT", "ECONNRESET", "ENETUNREACH", "EAI_AGAIN"].includes(code ?? "") || candidate.name === "TimeoutError";
}

describe("Telegram bot credential", () => {
  it("authenticates with Telegram getMe using the server-only bot token", async ({ skip }) => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    expect(token).toBeTruthy();

    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      if (isTelegramNetworkUnavailable(error)) {
        skip("Telegram API is unreachable from this test environment; live credential validation is deferred to production validation.");
        return;
      }
      throw error;
    }

    const payload = await response.json() as { ok: boolean; result?: { id: number; is_bot: boolean } };
    expect(response.ok).toBe(true);
    expect(payload.ok).toBe(true);
    expect(payload.result?.is_bot).toBe(true);
    expect(payload.result?.id).toBe(8809324062);
  }, 20_000);
});
