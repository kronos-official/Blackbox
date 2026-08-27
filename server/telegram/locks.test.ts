import { describe, expect, it } from "vitest";
import { buildGroupLockConfirmationMessage, buildLockStatusMessage, isGroupLockManagementAccessLevelAllowed, isLockStatusCommand, parseGroupLockCommand, parseLockCommand, shouldAutoDeleteLockSuccess } from "./locks";

describe("content lock status", () => {
  it("recognizes Persian and English status commands", () => {
    expect(isLockStatusCommand("وضعیت قفل")).toBe(true);
    expect(isLockStatusCommand(" lock status ")).toBe(true);
    expect(isLockStatusCommand("قفل گیف")).toBe(false);
  });

  it("renders an explicit empty state", () => {
    expect(buildLockStatusMessage([])).toContain("هیچ قفل محتوایی");
  });

  it("renders enabled lock labels without inventing state", () => {
    const message = buildLockStatusMessage(["gif", "sticker"]);
    expect(message).toContain("گیف");
    expect(message).toContain("استیکر");
    expect(message).not.toContain("همهٔ محتوا");
  });

  it("keeps Link confirmations persistent while other lock confirmations expire", () => {
    expect(shouldAutoDeleteLockSuccess("link")).toBe(false);
    expect(shouldAutoDeleteLockSuccess("photo")).toBe(true);
    expect(shouldAutoDeleteLockSuccess("all")).toBe(true);
  });

  it("parses حذف قفل for every supported content type", () => {
    const lockTypes = ["link", "photo", "video", "sticker", "gif", "document", "forward", "mention", "hashtag", "emoji", "phone", "poll", "bot", "command", "english", "persian", "text", "all"] as const;
    for (const lockType of lockTypes) {
      expect(parseLockCommand(`حذف قفل ${lockType}`)).toEqual({ enabled: false, lockType });
    }
    expect(parseLockCommand("delete lock sticker")).toEqual({ enabled: false, lockType: "sticker" });
    expect(parseLockCommand("قفل لینک")).toEqual({ enabled: true, lockType: "link" });
    expect(parseLockCommand("باز استیکر")).toEqual({ enabled: false, lockType: "sticker" });
  });

  it("parses the full group lock commands and limits them to Telegram administrators or higher", () => {
    expect(parseGroupLockCommand("قفل گروه")).toEqual({ enabled: true });
    expect(parseGroupLockCommand("باز کردن گروه")).toEqual({ enabled: false });
    expect(parseGroupLockCommand("بازکردن گروه")).toEqual({ enabled: false });
    expect(isGroupLockManagementAccessLevelAllowed("owner")).toBe(true);
    expect(isGroupLockManagementAccessLevelAllowed("group_admin")).toBe(true);
    expect(isGroupLockManagementAccessLevelAllowed("moderator")).toBe(false);
    expect(isGroupLockManagementAccessLevelAllowed("user")).toBe(false);
  });

  it("keeps compact group-lock confirmations as persistent status messages", () => {
    expect(buildGroupLockConfirmationMessage(true)).toBe("🔒 <b>گروه قفل شد</b>\nفقط مالک و ادمین‌ها می‌توانند پیام یا رسانه ارسال کنند.");
    expect(buildGroupLockConfirmationMessage(false)).toBe("🔓 <b>گروه باز شد</b>\nارسال پیام و رسانه برای کاربران دوباره مجاز است.");
  });
});
