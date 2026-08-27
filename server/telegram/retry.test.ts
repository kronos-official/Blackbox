import { describe, expect, it, vi } from "vitest";
import { withTelegramRetry } from "./retry";

describe("Telegram retry helper", () => {
  it("recovers from a rate-limit response and succeeds", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ response: { error_code: 429, parameters: { retry_after: 0 } } })
      .mockResolvedValue("ok");

    await expect(withTelegramRetry(operation, { attempts: 2, baseDelayMs: 0, maxDelayMs: 0 })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("honors a Telegram retry_after delay before retrying", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ response: { error_code: 429, parameters: { retry_after: 0.001 } } })
      .mockResolvedValue("recovered");

    await expect(withTelegramRetry(operation, { attempts: 2, baseDelayMs: 0, maxDelayMs: 10 })).resolves.toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry definitive Telegram client errors", async () => {
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue({ response: { error_code: 400 } });

    await expect(withTelegramRetry(operation, { attempts: 4, baseDelayMs: 0, maxDelayMs: 0 })).rejects.toMatchObject({
      response: { error_code: 400 },
    });
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

