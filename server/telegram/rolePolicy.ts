import type { AccessLevel } from "./constants";

/**
 * The internal Kronos authority layer is intentionally independent from Telegram
 * ownership/administrator status. It never grants Mini App visibility or the
 * ability to change Telegram-native administrator roles.
 *
 * | Internal role | Group moderation | Lock exemption | Delegate role | Native Telegram role |
 * | --- | --- | --- | --- | --- |
 * | kronos_owner | Yes | Yes | Only the sole bot owner may assign/revoke it | No |
 * | moderator | Yes | Yes | Group owner/admin may assign/revoke it | No |
 * | vip | No | Only where a lock explicitly exempts VIPs | Group owner/admin may assign/revoke it | No |
 * | user | No | No | Reset state available to group owner/admin | No |
 */
export const KRONOS_INTERNAL_ROLE_POLICY = {
  kronos_owner: {
    label: "مالک Kronos",
    canModerate: true,
    canReceiveLockExemption: true,
    requiresSoleBotOwnerDelegation: true,
    grantsMiniAppVisibility: false,
    grantsTelegramNativeControl: false,
  },
  moderator: {
    label: "مدیر Kronos",
    canModerate: true,
    canReceiveLockExemption: true,
    requiresSoleBotOwnerDelegation: false,
    grantsMiniAppVisibility: false,
    grantsTelegramNativeControl: false,
  },
  vip: {
    label: "کاربر ویژه",
    canModerate: false,
    canReceiveLockExemption: true,
    requiresSoleBotOwnerDelegation: false,
    grantsMiniAppVisibility: false,
    grantsTelegramNativeControl: false,
  },
  user: {
    label: "کاربر عادی",
    canModerate: false,
    canReceiveLockExemption: false,
    requiresSoleBotOwnerDelegation: false,
    grantsMiniAppVisibility: false,
    grantsTelegramNativeControl: false,
  },
} as const;

export type KronosInternalRole = keyof typeof KRONOS_INTERNAL_ROLE_POLICY;

export const MODERATION_INTERNAL_ROLES: ReadonlyArray<Exclude<KronosInternalRole, "vip" | "user">> = ["kronos_owner", "moderator"];

/** A group owner/admin may delegate ordinary internal roles; the protected owner tier is sole-owner only. */
export function mayDelegateKronosRole(input: { actorAccess: AccessLevel; actorIsSoleBotOwner: boolean; role: KronosInternalRole }) {
  if (KRONOS_INTERNAL_ROLE_POLICY[input.role].requiresSoleBotOwnerDelegation) return input.actorIsSoleBotOwner;
  return input.actorAccess === "owner" || input.actorAccess === "group_owner" || input.actorAccess === "group_admin";
}
