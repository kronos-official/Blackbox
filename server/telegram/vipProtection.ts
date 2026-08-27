import { and, eq } from "drizzle-orm";
import { groupRoles, vipProtections } from "../../drizzle/schema";
import { getDb } from "../db";

export type VipProtectionPolicy = {
  protectMute: boolean;
  protectBan: boolean;
  protectKick: boolean;
  protectDelete: boolean;
  ignoreAntiSpam: boolean;
  ignoreAntiRaid: boolean;
  ignoreFilters: boolean;
  ignoreContentLocks: boolean;
  ignoreForcedJoin: boolean;
  notifyBlockedActions: boolean;
  expiresAt: Date | null;
};

export const DEFAULT_VIP_PROTECTION: VipProtectionPolicy = {
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
};

export type VipProtectionKey = keyof Omit<VipProtectionPolicy, "expiresAt">;

export async function getVipProtectionPolicy(groupId: number, telegramUserId: number): Promise<VipProtectionPolicy | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const [role, policy] = await Promise.all([
    db.select({ id: groupRoles.id }).from(groupRoles).where(and(eq(groupRoles.groupId, groupId), eq(groupRoles.telegramUserId, telegramUserId), eq(groupRoles.role, "vip"))).limit(1),
    db.select().from(vipProtections).where(and(eq(vipProtections.groupId, groupId), eq(vipProtections.telegramUserId, telegramUserId))).limit(1),
  ]);
  if (!role[0]) return undefined;
  const row = policy[0];
  if (row?.expiresAt && row.expiresAt.getTime() <= Date.now()) return undefined;
  return {
    ...DEFAULT_VIP_PROTECTION,
    ...(row ? {
      protectMute: row.protectMute,
      protectBan: row.protectBan,
      protectKick: row.protectKick,
      protectDelete: row.protectDelete,
      ignoreAntiSpam: row.ignoreAntiSpam,
      ignoreAntiRaid: row.ignoreAntiRaid,
      ignoreFilters: row.ignoreFilters,
      ignoreContentLocks: row.ignoreContentLocks,
      ignoreForcedJoin: row.ignoreForcedJoin,
      notifyBlockedActions: row.notifyBlockedActions,
      expiresAt: row.expiresAt,
    } : {}),
  };
}

export async function isVipProtected(groupId: number, telegramUserId: number, key: VipProtectionKey): Promise<boolean> {
  const policy = await getVipProtectionPolicy(groupId, telegramUserId);
  return Boolean(policy?.[key]);
}

export async function saveVipProtectionPolicy(input: {
  groupId: number;
  telegramUserId: number;
  updatedByTelegramId: number;
  policy: Partial<Omit<VipProtectionPolicy, "expiresAt">> & { expiresAt?: Date | null };
}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while updating VIP protection policy");
  const values = {
    groupId: input.groupId,
    telegramUserId: input.telegramUserId,
    ...DEFAULT_VIP_PROTECTION,
    ...input.policy,
    updatedByTelegramId: input.updatedByTelegramId,
  };
  await db.insert(vipProtections).values(values).onDuplicateKeyUpdate({ set: { ...input.policy, updatedByTelegramId: input.updatedByTelegramId } });
  return getVipProtectionPolicy(input.groupId, input.telegramUserId);
}

export async function ensureVipProtectionPolicy(input: { groupId: number; telegramUserId: number; updatedByTelegramId: number; expiresAt?: Date | null }) {
  return saveVipProtectionPolicy({ ...input, policy: { expiresAt: input.expiresAt ?? null } });
}

export async function removeVipProtectionPolicy(groupId: number, telegramUserId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(vipProtections).where(and(eq(vipProtections.groupId, groupId), eq(vipProtections.telegramUserId, telegramUserId)));
}

export function vipPolicyLabel(key: VipProtectionKey) {
  return ({ protectMute: "سکوت", protectBan: "بن", protectKick: "اخراج", protectDelete: "حذف پیام", ignoreAntiSpam: "ضداسپم", ignoreAntiRaid: "ضدحمله", ignoreFilters: "فیلترها", ignoreContentLocks: "قفل‌های محتوا", ignoreForcedJoin: "عضویت اجباری", notifyBlockedActions: "اعلان جلوگیری از مجازات" } as Record<VipProtectionKey, string>)[key];
}

export function hasActiveVipRole(policy: VipProtectionPolicy | undefined): policy is VipProtectionPolicy {
  return Boolean(policy && (!policy.expiresAt || policy.expiresAt.getTime() > Date.now()));
}

