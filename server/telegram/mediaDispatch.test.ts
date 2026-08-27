import { describe, expect, it, vi } from "vitest";
import { passMediaThroughReceipt } from "./bot";

describe("Telegram media dispatch", () => {
  it.each(["photo", "document"])("passes %s updates onward after receipt inspection", async kind => {
    const ctx = { kind };
    const order: string[] = [];
    const receipt = vi.fn(async () => {
      order.push("receipt");
    });
    const next = vi.fn(async () => {
      order.push("content-safety");
    });

    await passMediaThroughReceipt(ctx, next, receipt);

    expect(receipt).toHaveBeenCalledWith(ctx);
    expect(next).toHaveBeenCalledOnce();
    expect(order).toEqual(["receipt", "content-safety"]);
  });

  it("does not swallow a receipt handler failure", async () => {
    const error = new Error("receipt lookup failed");
    const next = vi.fn();

    await expect(passMediaThroughReceipt({}, next, async () => { throw error; })).rejects.toBe(error);
    expect(next).not.toHaveBeenCalled();
  });
});

