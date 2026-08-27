import type { AccessLevel } from "../telegram/constants";

export type StoredTelegramRole = "owner" | "administrator" | "member" | "restricted" | "unknown";
export type StoredMembershipStatus = "active" | "left" | "kicked" | "unknown";

/** Normalizes Bot API member statuses without claiming that the bot can enumerate the full roster. */
export function normalizeTelegramMemberStatus(status: string): { telegramRole: StoredTelegramRole; membershipStatus: StoredMembershipStatus; access: AccessLevel | null } {
  if (status === "creator" || status === "owner") return { telegramRole: "owner", membershipStatus: "active", access: "group_owner" };
  if (status === "administrator") return { telegramRole: "administrator", membershipStatus: "active", access: "group_admin" };
  if (status === "restricted") return { telegramRole: "restricted", membershipStatus: "active", access: null };
  if (status === "left") return { telegramRole: "member", membershipStatus: "left", access: null };
  if (status === "kicked") return { telegramRole: "member", membershipStatus: "kicked", access: null };
  if (status === "member") return { telegramRole: "member", membershipStatus: "active", access: null };
  return { telegramRole: "unknown", membershipStatus: "unknown", access: null };
}
