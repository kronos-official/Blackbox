import { describe, expect, it } from "vitest";
import { KRONOS_INTERNAL_ROLE_POLICY, mayDelegateKronosRole } from "./rolePolicy";

describe("internal Kronos role policy", () => {
  it("documents the least-privilege matrix for every internal role", () => {
    expect(KRONOS_INTERNAL_ROLE_POLICY.kronos_owner).toMatchObject({ canModerate: true, canReceiveLockExemption: true, grantsMiniAppVisibility: false, grantsTelegramNativeControl: false });
    expect(KRONOS_INTERNAL_ROLE_POLICY.moderator).toMatchObject({ canModerate: true, canReceiveLockExemption: true, grantsMiniAppVisibility: false, grantsTelegramNativeControl: false });
    expect(KRONOS_INTERNAL_ROLE_POLICY.vip).toMatchObject({ canModerate: false, canReceiveLockExemption: true, grantsMiniAppVisibility: false, grantsTelegramNativeControl: false });
    expect(KRONOS_INTERNAL_ROLE_POLICY.user).toMatchObject({ canModerate: false, canReceiveLockExemption: false, grantsMiniAppVisibility: false, grantsTelegramNativeControl: false });
  });

  it("allows only the sole bot owner to delegate the protected owner tier", () => {
    expect(mayDelegateKronosRole({ actorAccess: "group_owner", actorIsSoleBotOwner: false, role: "kronos_owner" })).toBe(false);
    expect(mayDelegateKronosRole({ actorAccess: "owner", actorIsSoleBotOwner: true, role: "kronos_owner" })).toBe(true);
    expect(mayDelegateKronosRole({ actorAccess: "group_admin", actorIsSoleBotOwner: false, role: "moderator" })).toBe(true);
    expect(mayDelegateKronosRole({ actorAccess: "moderator", actorIsSoleBotOwner: false, role: "vip" })).toBe(false);
    expect(mayDelegateKronosRole({ actorAccess: "group_admin", actorIsSoleBotOwner: false, role: "user" })).toBe(true);
  });
});
