import { describe, expect, it } from "vitest";
import { buildBotHandlerErrorDetails, classifyBotHandlerError, describeTelegramError } from "./botError";

describe("bot error classification", () => {
  it("treats a missing reply target as an expected Telegram edge case", () => {
    const error = { response: { error_code: 400, description: "Bad Request: message to be replied not found" } };
    expect(classifyBotHandlerError(error)).toBe("expected_telegram_edge_case");
  });

  it("treats an idempotent message edit as an expected Telegram edge case", () => {
    const error = { response: { error_code: 400, description: "Bad Request: message is not modified" } };
    expect(classifyBotHandlerError(error)).toBe("expected_telegram_edge_case");
  });

  it("keeps unexpected Telegram failures actionable", () => {
    const error = { response: { error_code: 403, description: "Forbidden: bot was kicked" } };
    expect(classifyBotHandlerError(error)).toBe("unexpected_handler_error");
    expect(describeTelegramError(error)).toContain("bot was kicked");
  });

  it("classifies network timeouts and rate limits as transient Telegram failures", () => {
    expect(classifyBotHandlerError(new Error("Request timed out"))).toBe("transient_telegram_error");
    expect(classifyBotHandlerError({ response: { error_code: 429, description: "Too Many Requests" } })).toBe("transient_telegram_error");
  });

  it("records update context and a readable error message", () => {
    const details = buildBotHandlerErrorDetails(new Error("database unavailable"), {
      updateId: 42,
      updateType: "message",
      chatId: -100123,
      actorTelegramId: 8375579910,
    });
    expect(details).toEqual({
      updateId: 42,
      updateType: "message",
      chatId: -100123,
      actorTelegramId: 8375579910,
      kind: "unexpected_handler_error",
      message: "database unavailable",
    });
  });
});
