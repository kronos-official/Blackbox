import { describe, expect, it } from "vitest";
import { DEFAULT_VIP_PROTECTION, hasActiveVipRole, vipPolicyLabel } from "./vipProtection";

describe("VIP protection policy contract", () => {
  it("protects VIP members from punitive actions and automatic safety systems by default", () => {
    expect(DEFAULT_VIP_PROTECTION).toMatchObject({
      protectMute: true,
      protectBan: true,
      protectKick: true,
      protectDelete: false,
      ignoreAntiSpam: true,
      ignoreAntiRaid: true,
      ignoreFilters: true,
      ignoreContentLocks: true,
      ignoreForcedJoin: true,
      notifyBlockedActions: true,
      expiresAt: null,
    });
  });

  it("treats a future policy as active and an expired policy as inactive", () => {
    expect(hasActiveVipRole({ ...DEFAULT_VIP_PROTECTION, expiresAt: new Date(Date.now() + 60_000) })).toBe(true);
    expect(hasActiveVipRole({ ...DEFAULT_VIP_PROTECTION, expiresAt: new Date(Date.now() - 60_000) })).toBe(false);
    expect(hasActiveVipRole(undefined)).toBe(false);
  });

  it("provides Persian labels for every configurable protection", () => {
    expect(vipPolicyLabel("protectMute")).toBe("سکوت");
    expect(vipPolicyLabel("protectBan")).toBe("بن");
    expect(vipPolicyLabel("ignoreAntiRaid")).toBe("ضدحمله");
    expect(vipPolicyLabel("ignoreForcedJoin")).toBe("عضویت اجباری");
  });
});
