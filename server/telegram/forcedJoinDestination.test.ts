import { describe, expect, it, vi } from "vitest";
import { forcedJoinDestinationErrorMessage, resolveForcedJoinDestinationReference, verifyForcedJoinDestination } from "./forcedJoinDestination";

describe("forced-join destination verification", () => {
  it("retries a transient Telegram socket failure and accepts an administrator destination", async () => {
    const getChat = vi.fn()
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValue({ title: "کانال آزمایشی" });
    const telegram = {
      getMe: vi.fn().mockResolvedValue({ id: 8809324062 }),
      getChat,
      getChatMember: vi.fn().mockResolvedValue({ status: "administrator" }),
    };

    await expect(verifyForcedJoinDestination(telegram, -1003795743979)).resolves.toEqual({ title: "کانال آزمایشی" });
    expect(getChat).toHaveBeenCalledTimes(2);
  }, 5_000);

  it("identifies the real access and transient-network cases in Persian", () => {
    expect(forcedJoinDestinationErrorMessage(new Error("400: Bad Request: participant_id_invalid"))).toContain("عضو و مدیر");
    expect(forcedJoinDestinationErrorMessage(new Error("400: Bad Request: member list is inaccessible"))).toContain("عضو و مدیر");
    expect(forcedJoinDestinationErrorMessage(new Error("socket hang up"))).toContain("ارتباط موقت");
    expect(forcedJoinDestinationErrorMessage(new Error("400: Bad Request: chat not found"))).toContain("پیدا نشد");
  });

  it("resolves a public link, bare t.me link, username, or numeric ID into the canonical numeric chat ID", async () => {
    const getChat = vi.fn().mockResolvedValue({ id: -1003795743979, type: "channel", title: "کانال آزمایشی", username: "KronosChannel" });
    const telegram = { getMe: vi.fn(), getChat, getChatMember: vi.fn() };

    await expect(resolveForcedJoinDestinationReference(telegram, "https://t.me/KronosChannel")).resolves.toMatchObject({ channelChatId: -1003795743979, username: "KronosChannel" });
    await expect(resolveForcedJoinDestinationReference(telegram, "t.me/KronosChannel")).resolves.toMatchObject({ channelChatId: -1003795743979 });
    await expect(resolveForcedJoinDestinationReference(telegram, "@KronosChannel")).resolves.toMatchObject({ channelChatId: -1003795743979 });
    await expect(resolveForcedJoinDestinationReference(telegram, "-1003795743979")).resolves.toMatchObject({ channelChatId: -1003795743979 });
    expect(getChat).toHaveBeenLastCalledWith(-1003795743979);
  });

  it("rejects private invite links with an explicit Persian recovery message", async () => {
    const telegram = { getMe: vi.fn(), getChat: vi.fn(), getChatMember: vi.fn() };
    await expect(resolveForcedJoinDestinationReference(telegram, "https://t.me/+privateInvite")).rejects.toThrow("invalid_forced_join_reference");
    expect(forcedJoinDestinationErrorMessage(new Error("invalid_forced_join_reference"))).toContain("لینک‌های دعوت خصوصی");
  });
});
