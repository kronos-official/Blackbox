import { OWNER_TELEGRAM_ID } from "./constants";
import { accessRank, type AccessLevel } from "./constants";
import { getStoredGroupAccessLevel, hasModeratorRole, isGlobalAdmin, isGroupAuthoritySuspended } from "./repository";

export class OwnerAccessDeniedError extends Error {
  constructor() {
    super("This operation is restricted to the Kronos Guard owner");
    this.name = "OwnerAccessDeniedError";
  }
}

/** Central policy guard for all bot-wide management actions. */
export function isOwnerTelegramId(telegramUserId: number | undefined | null): boolean {
  return telegramUserId === OWNER_TELEGRAM_ID;
}

export function requireOwnerTelegramId(telegramUserId: number | undefined | null): asserts telegramUserId is number {
  if (!isOwnerTelegramId(telegramUserId)) throw new OwnerAccessDeniedError();
}

export type TelegramMembershipReader = {
  getChatMember: (chatId: number, telegramUserId: number) => Promise<{ status: string }>;
};

export type AuthorizationDependencies = {
  isGlobalAdmin?: (telegramUserId: number) => Promise<boolean>;
  hasModeratorRole?: (groupId: number, telegramUserId: number) => Promise<boolean>;
  getStoredGroupAccessLevel?: (groupId: number, telegramUserId: number) => Promise<"group_owner" | "group_admin" | "moderator" | null>;
  isGroupAuthoritySuspended?: (groupId: number, telegramUserId: number) => Promise<boolean>;
};

/** Resolves authority with the invariant owner > global admin > group owner > group admin > moderator > user. */
export async function resolveAccessLevel(
  input: { groupId: number; groupChatId: number; telegramUserId: number },
  membershipReader: TelegramMembershipReader,
  dependencies: AuthorizationDependencies = {}
): Promise<AccessLevel> {
  if (isOwnerTelegramId(input.telegramUserId)) return "owner";

  const isGlobal = dependencies.isGlobalAdmin ?? isGlobalAdmin;
  if (await isGlobal(input.telegramUserId)) return "global_admin";

  const isSuspended = dependencies.isGroupAuthoritySuspended ?? isGroupAuthoritySuspended;
  if (await isSuspended(input.groupId, input.telegramUserId)) return "user";

  let liveTelegramStatus: string | undefined;
  try {
    const member = await membershipReader.getChatMember(input.groupChatId, input.telegramUserId);
    liveTelegramStatus = member.status;
    if (member.status === "creator" || member.status === "owner") return "group_owner";
    if (member.status === "administrator") return "group_admin";
  } catch {
    // Continue with the durable group authority record only when Telegram could
    // not be queried. A successful non-admin response is authoritative and must
    // not be overridden by stale group_owner/group_admin rows.
  }

  const getStored = dependencies.getStoredGroupAccessLevel ?? getStoredGroupAccessLevel;
  const storedAccess = await getStored(input.groupId, input.telegramUserId);
  if (storedAccess && (!liveTelegramStatus || storedAccess === "moderator")) return storedAccess;

  const isModerator = dependencies.hasModeratorRole ?? hasModeratorRole;
  return (await isModerator(input.groupId, input.telegramUserId)) ? "moderator" : "user";
}

export function hasAtLeastAccess(actual: AccessLevel, required: AccessLevel): boolean {
  return accessRank[actual] >= accessRank[required];
}

/**
 * Internal Kronos owners and moderators may operate the bot-managed moderation
 * controls. This does not grant Telegram-native administrator status or role
 * delegation authority.
 */
export function hasKronosModerationAccess(access: AccessLevel): boolean {
  return hasAtLeastAccess(access, "moderator");
}

/** A user may moderate a target only if their resolved authority is strictly higher. */
export function mayModerateTarget(actor: AccessLevel, target: AccessLevel): boolean {
  return accessRank[actor] > accessRank[target] && hasAtLeastAccess(actor, "moderator");
}
