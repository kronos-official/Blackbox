import { and, desc, eq, gte, lte } from "drizzle-orm";
import { groupAuditEvents, groupPolicyOverrides, groupPolicyVersions } from "../../drizzle/schema";
import { getDb } from "../db";
import { hasKronosModerationAccess } from "./authorization";
import type { AccessLevel } from "./constants";

export const GROUP_POLICY_KEYS = {
  statistics: "command.statistics",
  cleanup: "command.cleanup",
  locks: "command.locks",
  groupInfo: "command.group_info",
  groupLink: "command.group_link",
  groupSafety: "command.group_safety",
  moderation: "command.moderation",
} as const;

export type GroupPolicyKey = (typeof GROUP_POLICY_KEYS)[keyof typeof GROUP_POLICY_KEYS];
export type AuditOutcome = "allowed" | "denied" | "completed" | "failed";
export type GroupPolicyVersionOperation = "set" | "rollback";

export type GroupAuditEventInput = {
  groupId: number;
  actorTelegramId?: number;
  subjectTelegramId?: number;
  action: string;
  source?: string;
  outcome: AuditOutcome;
  requestId?: string;
  details?: Record<string, unknown>;
};

/** Audit is best-effort: a database outage must never break the Telegram action itself. */
export async function recordGroupAuditEvent(input: GroupAuditEventInput): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(groupAuditEvents).values({
      groupId: input.groupId,
      actorTelegramId: input.actorTelegramId ?? null,
      subjectTelegramId: input.subjectTelegramId ?? null,
      action: input.action,
      source: input.source ?? "telegram",
      outcome: input.outcome,
      requestId: input.requestId ?? null,
      details: input.details ?? null,
    });
  } catch (error) {
    console.warn("[Kronos Guard] audit event could not be recorded", error);
  }
}

export async function getGroupPolicyOverride(groupId: number, policyKey: GroupPolicyKey): Promise<unknown | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const row = (await db
    .select({ value: groupPolicyOverrides.value })
    .from(groupPolicyOverrides)
    .where(and(eq(groupPolicyOverrides.groupId, groupId), eq(groupPolicyOverrides.policyKey, policyKey)))
    .limit(1))[0];
  return row?.value;
}

/** Returns the configured boolean when present; otherwise preserves the code default. */
export async function resolveGroupBooleanPolicy(groupId: number, policyKey: GroupPolicyKey, fallback: boolean): Promise<boolean> {
  const value = await getGroupPolicyOverride(groupId, policyKey);
  return typeof value === "boolean" ? value : fallback;
}

export async function previewGroupPolicyOverride(input: {
  groupId: number;
  policyKey: GroupPolicyKey;
  value: unknown;
}) {
  const currentValue = await getGroupPolicyOverride(input.groupId, input.policyKey);
  const changed = JSON.stringify(currentValue ?? null) !== JSON.stringify(input.value);
  return {
    policyKey: input.policyKey,
    currentValue: currentValue ?? null,
    nextValue: input.value,
    changed,
    summary: changed ? "policy value will change" : "policy value is already current",
  } as const;
}

export async function setGroupPolicyOverride(input: {
  groupId: number;
  policyKey: GroupPolicyKey;
  value: unknown;
  updatedByTelegramId: number;
  operation?: GroupPolicyVersionOperation;
  sourceVersionId?: number;
}): Promise<{ changed: boolean; versionId: number | null }> {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const currentValue = await getGroupPolicyOverride(input.groupId, input.policyKey);
  if (JSON.stringify(currentValue ?? null) === JSON.stringify(input.value)) return { changed: false, versionId: null };

  const inserted = await db.transaction(async tx => {
    const versionRows = await tx.insert(groupPolicyVersions).values({
      groupId: input.groupId,
      policyKey: input.policyKey,
      value: input.value,
      previousValue: currentValue ?? null,
      operation: input.operation ?? "set",
      sourceVersionId: input.sourceVersionId ?? null,
      updatedByTelegramId: input.updatedByTelegramId,
    }).$returningId() as Array<{ id?: number }>;
    await tx.insert(groupPolicyOverrides).values({
      groupId: input.groupId,
      policyKey: input.policyKey,
      value: input.value,
      updatedByTelegramId: input.updatedByTelegramId,
    }).onDuplicateKeyUpdate({
      set: { value: input.value, updatedByTelegramId: input.updatedByTelegramId },
    });
    return versionRows[0];
  });
  await recordGroupAuditEvent({
    groupId: input.groupId,
    actorTelegramId: input.updatedByTelegramId,
    action: input.operation === "rollback" ? "policy.override.rolled_back" : "policy.override.updated",
    outcome: "completed",
    details: { policyKey: input.policyKey, versionId: inserted?.id ?? null, sourceVersionId: input.sourceVersionId ?? null },
  });
  return { changed: true, versionId: inserted?.id ?? null };
}

export async function listGroupPolicyVersions(input: { groupId: number; policyKey?: GroupPolicyKey; limit?: number }) {
  const db = await getDb();
  if (!db) return [];
  const predicates = [eq(groupPolicyVersions.groupId, input.groupId)];
  if (input.policyKey) predicates.push(eq(groupPolicyVersions.policyKey, input.policyKey));
  return db.select().from(groupPolicyVersions).where(and(...predicates)).orderBy(desc(groupPolicyVersions.createdAt), desc(groupPolicyVersions.id)).limit(Math.min(Math.max(input.limit ?? 50, 1), 200));
}

export async function rollbackGroupPolicyOverride(input: {
  groupId: number;
  policyKey: GroupPolicyKey;
  versionId: number;
  updatedByTelegramId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const version = (await db.select().from(groupPolicyVersions).where(and(
    eq(groupPolicyVersions.id, input.versionId),
    eq(groupPolicyVersions.groupId, input.groupId),
    eq(groupPolicyVersions.policyKey, input.policyKey),
  )).limit(1))[0];
  if (!version) throw new Error("Policy version was not found for this group");
  return setGroupPolicyOverride({
    groupId: input.groupId,
    policyKey: input.policyKey,
    value: version.value,
    updatedByTelegramId: input.updatedByTelegramId,
    operation: "rollback",
    sourceVersionId: version.id,
  });
}

export async function listGroupAuditEvents(input: {
  groupId: number;
  actorTelegramId?: number;
  action?: string;
  outcome?: AuditOutcome;
  from?: Date;
  to?: Date;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const predicates = [eq(groupAuditEvents.groupId, input.groupId)];
  if (input.actorTelegramId !== undefined) predicates.push(eq(groupAuditEvents.actorTelegramId, input.actorTelegramId));
  if (input.action) predicates.push(eq(groupAuditEvents.action, input.action));
  if (input.outcome) predicates.push(eq(groupAuditEvents.outcome, input.outcome));
  if (input.from) predicates.push(gte(groupAuditEvents.createdAt, input.from));
  if (input.to) predicates.push(lte(groupAuditEvents.createdAt, input.to));
  return db.select().from(groupAuditEvents).where(and(...predicates)).orderBy(desc(groupAuditEvents.createdAt)).limit(Math.min(Math.max(input.limit ?? 50, 1), 200));
}

export function canManageGroupPolicy(access: AccessLevel): boolean {
  return hasKronosModerationAccess(access);
}
