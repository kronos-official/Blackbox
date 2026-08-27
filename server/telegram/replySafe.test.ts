import { describe, expect, it, vi } from "vitest";
import { hasMissingReplyTarget, isMessageNotModified, replySafely } from "./replySafe";

describe("replySafely", () => {
  it("falls back to a standalone reply when Telegram cannot find the source message", async () => {
    const reply = vi
      .fn()
      .mockRejectedValueOnce({ response: { error_code: 400, description: "Bad Request: message to be replied not found" } })
      .mockResolvedValueOnce({ message_id: 99 });
    const ctx = { reply } as never;

    await expect(replySafely(ctx, "status", { parse_mode: "HTML", reply_parameters: { message_id: 12 } })).resolves.toEqual({ message_id: 99 });
    expect(reply).toHaveBeenNthCalledWith(1, "status", { parse_mode: "HTML", reply_parameters: { message_id: 12 } });
    expect(reply).toHaveBeenNthCalledWith(2, "status", { parse_mode: "HTML" });
  });

  it("does not hide unrelated Telegram errors", async () => {
    const error = { response: { error_code: 403, description: "Forbidden" } };
    const reply = vi.fn().mockRejectedValue(error);
    await expect(replySafely({ reply } as never, "status", { reply_parameters: { message_id: 12 } })).rejects.toBe(error);
  });

  it("recognizes the exact missing-target Telegram error", () => {
    expect(hasMissingReplyTarget({ response: { error_code: 400, description: "Bad Request: message to be replied not found" } })).toBe(true);
    expect(hasMissingReplyTarget({ response: { error_code: 400, description: "Bad Request: chat not found" } })).toBe(false);
  });

  it("classifies identical Telegram edits as an expected idempotent edge case", () => {
    expect(isMessageNotModified({ response: { error_code: 400, description: "Bad Request: message is not modified" } })).toBe(true);
    expect(isMessageNotModified({ response: { error_code: 400, description: "Bad Request: message to be edited not found" } })).toBe(false);
  });
});
