/** The only Telegram account permitted to administer the whole platform. */
export function resolveOwnerTelegramId(value = process.env.OWNER_TELEGRAM_ID): number {
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  // Preserves the coded default access policy for existing installations while
  // allowing the deployment secret to be the authoritative production value.
  return 8375579910;
}

export const OWNER_TELEGRAM_ID = resolveOwnerTelegramId();

export const BOT_NAME = "Kronos Guard";

export type AccessLevel = "owner" | "global_admin" | "group_owner" | "group_admin" | "moderator" | "user";

export const accessRank: Record<AccessLevel, number> = {
  owner: 60,
  global_admin: 50,
  group_owner: 40,
  group_admin: 30,
  moderator: 20,
  user: 10,
};
