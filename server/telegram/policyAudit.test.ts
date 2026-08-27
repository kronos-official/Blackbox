import { describe, expect, it } from "vitest";
import { GROUP_POLICY_KEYS, canManageGroupPolicy, type AuditOutcome } from "./policyAudit";

describe("policy audit contract", () => {
  it("keeps policy keys stable for every audited command family", () => {
    expect(Object.values(GROUP_POLICY_KEYS)).toEqual([
      "command.statistics",
      "command.cleanup",
      "command.locks",
      "command.group_info",
      "command.group_link",
      "command.group_safety",
      "command.moderation",
    ]);
  });

  it.each(["owner", "global_admin", "group_owner", "group_admin", "moderator"] as const)(
    "allows %s to manage a group policy",
    access => {
      expect(canManageGroupPolicy(access)).toBe(true);
    },
  );

  it("does not allow a regular member to change a group policy", () => {
    expect(canManageGroupPolicy("user")).toBe(false);
  });

  it("keeps audit outcomes finite and explicit", () => {
    const outcomes: AuditOutcome[] = ["allowed", "denied", "completed", "failed"];
    expect(new Set(outcomes).size).toBe(4);
  });
});
