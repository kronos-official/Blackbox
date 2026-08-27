import { describe, expect, it } from "vitest";
import { isCleanupAccessLevelAllowed } from "./cleanup";
import { isGroupInformationAccessLevelAllowed, isGroupLinkAccessLevelAllowed } from "./groupInfo";
import { isGroupSafetyConfigurationAccessLevelAllowed } from "./groupSafety";
import { isLockManagementAccessLevelAllowed } from "./locks";
import { isStatisticsAccessLevelAllowed } from "./statistics";

const botManagedCommandPolicies = [
  ["آمار", isStatisticsAccessLevelAllowed],
  ["پاکسازی", isCleanupAccessLevelAllowed],
  ["قفل‌های محتوا", isLockManagementAccessLevelAllowed],
  ["اطلاعات گروه", isGroupInformationAccessLevelAllowed],
  ["لینک", isGroupLinkAccessLevelAllowed],
  ["تنظیمات ایمنی گروه", isGroupSafetyConfigurationAccessLevelAllowed],
  ["کنترل ضدحمله", isGroupSafetyConfigurationAccessLevelAllowed],
] as const;

describe("bot-managed group command access policy", () => {
  it.each(botManagedCommandPolicies)("permits an internal Kronos moderator to use %s", (_command, allows) => {
    expect(allows("moderator")).toBe(true);
  });

  it.each(botManagedCommandPolicies)("continues to deny a regular member from %s", (_command, allows) => {
    expect(allows("user")).toBe(false);
  });
});
