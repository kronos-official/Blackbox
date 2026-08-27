import { describe, expect, it, vi } from "vitest";
import { buildModerationActionMessage, buildVipProtectionMessage, isVipProtectedAction, moderationHierarchyDeniedReply, NON_MODERATOR_COMMAND_REPLY, replyToInitiatingAdmin, unrestrictedPermissions } from "./moderation";

describe("moderation response contract", () => {
  it("protects VIP users from both mute and ban while leaving unrelated actions unchanged", () => {
    expect(isVipProtectedAction("mute")).toBe(true);
    expect(isVipProtectedAction("ban")).toBe(true);
    expect(isVipProtectedAction("warn")).toBe(false);
    expect(isVipProtectedAction("kick")).toBe(true);

    const message = buildVipProtectionMessage({ telegramUserId: 42, displayName: "A < B" });
    expect(message).toBe('کاربر <a href="tg://user?id=42">A &lt; B</a> در حال حاضر عضو ویژه است؛ این عملیات روی او اجرا نشد.');
  });

  it("uses the requested Persian encouragement text for ordinary users attempting management commands", () => {
    expect(NON_MODERATOR_COMMAND_REPLY).toBe("تو هنوز ضعیفی بیشتر تلاش کن");
    expect(moderationHierarchyDeniedReply("user", "group_admin")).toBe("تو هنوز ضعیفی بیشتر تلاش کن");
  });

  it("explains that an administrator, owner, or ranked user cannot be punished by an equal-or-lower rank", () => {
    expect(moderationHierarchyDeniedReply("moderator", "group_admin")).toContain("ادمین، مالک یا کاربر مقام‌دار");
    expect(moderationHierarchyDeniedReply("group_admin", "group_admin")).toContain("بن، سیک یا محدود");
  });

  it("mentions the target user, uses the requested sick wording, and includes Persian date and time", () => {
    const message = buildModerationActionMessage(
      { action: "ban", sourceAlias: "سیک", specialResponse: "sick_ban" },
      { telegramUserId: 42, displayName: "A < B" },
      undefined,
      false,
      new Date("2026-08-14T08:30:00.000Z"),
    );
    expect(message).toContain('کاربر <a href="tg://user?id=42">A &lt; B</a> سیکش خورده شد');
    expect(message).toContain("ساعت:");
    expect(message).toContain("تاریخ:");
  });

  it("uses the requested concise success text for ban, unban, and mute", () => {
    const target = { telegramUserId: 42, displayName: "کاربر" };
    expect(buildModerationActionMessage({ action: "ban", sourceAlias: "بن" }, target)).toBe('🚫 کاربر <a href="tg://user?id=42">کاربر</a> بن شد.');
    expect(buildModerationActionMessage({ action: "unban", sourceAlias: "حذف بن" }, target)).toBe('✅ کاربر <a href="tg://user?id=42">کاربر</a> از بن خارج شد.');
    expect(buildModerationActionMessage({ action: "mute", sourceAlias: "سکوت", durationSeconds: 30 * 86400 }, target)).toBe('🔇 کاربر <a href="tg://user?id=42">کاربر</a> برای ۳۰ روز سکوت شد.');
  });

  it("describes unmute using the Persian lift-mute wording and has every muted capability restored in fallback permissions", () => {
    const message = buildModerationActionMessage({ action: "unmute", sourceAlias: "لغو سکوت" }, { telegramUserId: 7, displayName: "کاربر" });
    expect(message).toContain('کاربر <a href="tg://user?id=7">کاربر</a> رفع سکوت شد');
    expect(Object.values(unrestrictedPermissions())).toEqual(expect.arrayContaining([true]));
    expect(Object.values(unrestrictedPermissions())).not.toContain(false);
  });

  it("does not claim an unmute when the target is not currently muted", () => {
    const message = buildModerationActionMessage({ action: "unmute", sourceAlias: "لغو سکوت" }, { telegramUserId: 7, displayName: "کاربر" }, undefined, false, new Date(), { noActiveMute: true });
    expect(message).toContain("این کاربر در حال حاضر در حالت سکوت نیست");
    expect(message).not.toContain("رفع سکوت شد");
  });

  it("does not claim an unban when the target is not currently banned", () => {
    const message = buildModerationActionMessage({ action: "unban", sourceAlias: "رفع بن" }, { telegramUserId: 7, displayName: "کاربر" }, undefined, false, new Date(), { noActiveBan: true });
    expect(message).toContain("در حال حاضر در مسدودیت نیست");
    expect(message).not.toContain("رفع مسدودیت شد");
  });

  it("does not claim warning removal when the target has no active warnings", () => {
    const message = buildModerationActionMessage({ action: "unwarn", sourceAlias: "حذف اخطار", warningRemovalCount: 2 }, { telegramUserId: 7, displayName: "کاربر" }, 0, false, new Date(), { noActiveWarnings: true });
    expect(message).toContain("در حال حاضر اخطار فعالی ندارد");
    expect(message).not.toContain("اخطار حذف شد");
  });

  it("threads each acknowledgement to the initiating administrator command", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await replyToInitiatingAdmin({ message: { message_id: 418 }, reply } as never, "کاربر رفع سکوت شد", "HTML");
    expect(reply).toHaveBeenCalledWith("کاربر رفع سکوت شد", { parse_mode: "HTML", reply_parameters: { message_id: 418 } });
  });

  it("keeps the moderation acknowledgement when Telegram reports target not specified", async () => {
    const reply = vi
      .fn()
      .mockRejectedValueOnce({ response: { error_code: 400, description: "Bad Request: target not specified" } })
      .mockResolvedValueOnce(undefined);
    await replyToInitiatingAdmin({ message: { message_id: 418 }, reply } as never, "پنل شما آماده شد", "HTML");
    expect(reply).toHaveBeenNthCalledWith(2, "پنل شما آماده شد", { parse_mode: "HTML" });
  });

  it("keeps the moderation acknowledgement when Telegram rejects a stale reply target", async () => {
    const reply = vi
      .fn()
      .mockRejectedValueOnce({ response: { error_code: 400, description: "Bad Request: message to be replied not found" } })
      .mockResolvedValueOnce(undefined);
    await replyToInitiatingAdmin({ message: { message_id: 418 }, reply } as never, "کاربر رفع سکوت شد", "HTML");
    expect(reply).toHaveBeenNthCalledWith(2, "کاربر رفع سکوت شد", { parse_mode: "HTML" });
  });
});
