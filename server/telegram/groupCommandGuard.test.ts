import { describe, expect, it } from "vitest";
import { GROUP_COMMAND_REMOVED_REPLY, GROUP_COMMAND_UNAVAILABLE_REPLY, groupCommandAvailabilityReply, isGroupSetupAccessLevelAllowed, isGroupSetupCommand, isLikelyManagedGroupCommand, shouldRejectMissingGroupActor, shouldRejectUnavailableManagedGroupCommand, UNKNOWN_GROUP_ACTOR_REPLY } from "./groupCommandGuard";

describe("group command actor guard", () => {
  it("recognizes exact and prefix-based slashless management commands", () => {
    expect(isLikelyManagedGroupCommand("لینک")).toBe(true);
    expect(isLikelyManagedGroupCommand("وضعیت گروه")).toBe(true);
    expect(isLikelyManagedGroupCommand("لقب")).toBe(true);
    expect(isLikelyManagedGroupCommand("خوشامد پیش‌نمایش")).toBe(true);
    expect(isLikelyManagedGroupCommand("goodbye reset")).toBe(true);
    expect(isLikelyManagedGroupCommand("حذف اخطار دو")).toBe(true);
    expect(isLikelyManagedGroupCommand("mute @member 1h")).toBe(true);
  });

  it("recognizes the approved group setup spellings without broadening moderation commands", () => {
    expect(isGroupSetupCommand("setup")).toBe(true);
    expect(isGroupSetupCommand("راه‌اندازی")).toBe(true);
    expect(isGroupSetupCommand("  راه اندازی  ")).toBe(true);
    expect(isGroupSetupCommand("راهاندازی")).toBe(true);
    expect(isGroupSetupCommand("تنظیم مدیر")).toBe(false);
  });

  it("treats group setup as a protected managed command", () => {
    expect(isLikelyManagedGroupCommand("setup")).toBe(true);
    expect(isLikelyManagedGroupCommand("راه‌اندازی")).toBe(true);
    expect(shouldRejectMissingGroupActor({ chatType: "supergroup", text: "راه‌اندازی" })).toBe(true);
  });

  it("allows setup only for bot-managed moderation authority", () => {
    expect(isGroupSetupAccessLevelAllowed("owner")).toBe(true);
    expect(isGroupSetupAccessLevelAllowed("group_admin")).toBe(true);
    expect(isGroupSetupAccessLevelAllowed("moderator")).toBe(true);
    expect(isGroupSetupAccessLevelAllowed("vip")).toBe(false);
    expect(isGroupSetupAccessLevelAllowed("user")).toBe(false);
  });

  it("rejects a recognized group management update when Telegram omits from", () => {
    expect(shouldRejectMissingGroupActor({ chatType: "supergroup", text: "لینک" })).toBe(true);
    expect(shouldRejectMissingGroupActor({ chatType: "group", text: "بن 42" })).toBe(true);
    expect(shouldRejectMissingGroupActor({ chatType: "group", actorId: 8375579910, text: "لینک" })).toBe(false);
    expect(shouldRejectMissingGroupActor({ chatType: "private", text: "لینک" })).toBe(false);
  });

  it("does not classify ordinary conversation as a management command", () => {
    expect(isLikelyManagedGroupCommand("سلام دوستان")).toBe(false);
    expect(isLikelyManagedGroupCommand("این پیام دربارهٔ حذف زباله است")).toBe(false);
    expect(UNKNOWN_GROUP_ACTOR_REPLY).toContain("ناشناس");
  });

  it("stops managed changes deterministically when the bot has lost group access", () => {
    expect(isLikelyManagedGroupCommand("زمان حذف خودکار 10")).toBe(true);
    expect(shouldRejectUnavailableManagedGroupCommand({ groupStatus: "permission_lost", text: "بن @member" })).toBe(true);
    expect(shouldRejectUnavailableManagedGroupCommand({ groupStatus: "removed", text: "زمان حذف خودکار 10" })).toBe(true);
    expect(shouldRejectUnavailableManagedGroupCommand({ groupStatus: "active", text: "پاکسازی 10" })).toBe(false);
    expect(shouldRejectUnavailableManagedGroupCommand({ groupStatus: "permission_lost", text: "وضعیت گروه" })).toBe(false);
    expect(shouldRejectUnavailableManagedGroupCommand({ groupStatus: "removed", text: "راه‌اندازی" })).toBe(false);
    expect(groupCommandAvailabilityReply("permission_lost")).toBe(GROUP_COMMAND_UNAVAILABLE_REPLY);
    expect(groupCommandAvailabilityReply("removed")).toBe(GROUP_COMMAND_REMOVED_REPLY);
  });
});
