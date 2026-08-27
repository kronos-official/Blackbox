import { and, eq, inArray } from "drizzle-orm";
import type { Telegram } from "telegraf";
import { globalAdmins, groupAuthoritySuspensions, groupMembers, groupRoles, telegramGroups, telegramUsers } from "../../drizzle/schema";
import { createUserNotification } from "../notifications";
import { getDb } from "../db";
import { OWNER_TELEGRAM_ID } from "./constants";
import { withTelegramRetry } from "./retry";
import { getGroupEventNotificationPreferences } from "./groupEventPreferences";

export type GroupEventCategory = "membership" | "role" | "metadata" | "message" | "moderation" | "protection" | "system";

export type GroupEventIdentity = {
  telegramUserId?: number | null;
  displayName?: string | null;
  username?: string | null;
  isBot?: boolean;
};

export type GroupEventDetails = {
  summary?: string | null;
  previousValue?: string | null;
  nextValue?: string | null;
  reason?: string | null;
};

export type GroupEventNotificationInput = {
  groupId: number;
  eventType: string;
  actor?: GroupEventIdentity | null;
  subject?: GroupEventIdentity | null;
  details?: GroupEventDetails | null;
  occurredAt?: Date;
  /** Used to discard accidental duplicate fan-out calls during a short webhook race. */
  eventKey?: string | null;
  telegram?: Pick<Telegram, "sendMessage"> | null;
  sendPrivateMessage?: boolean;
  /** Persists a read-only activity record for the actor in Mini App; never sends it privately. */
  includeActorInDashboard?: boolean;
};

export type GroupEventDeliveryResult = {
  category: GroupEventCategory;
  recipientIds: number[];
  persistedRecipientIds: number[];
  privateDeliveryRecipientIds: number[];
  duplicate: boolean;
};

const EVENT_KEY_TTL_MS = 10_000;
const recentEventKeys = new Map<string, number>();
const recentProtectionPrivateDeliveries = new Map<string, number>();

const eventDefinitions: Record<string, { category: GroupEventCategory; title: string }> = {
  "member.joined": { category: "membership", title: "ورود عضو به گروه" },
  "member.left": { category: "membership", title: "خروج عضو از گروه" },
  "member.added": { category: "membership", title: "افزودن عضو به گروه" },
  "member.kicked": { category: "membership", title: "اخراج عضو از گروه" },
  "member.muted": { category: "moderation", title: "سکوت عضو" },
  "member.unmuted": { category: "moderation", title: "رفع سکوت عضو" },
  "role.promoted": { category: "role", title: "ارتقای مقام عضو" },
  "role.demoted": { category: "role", title: "کاهش مقام عضو" },
  "role.title_changed": { category: "role", title: "تغییر لقب عضو" },
  "group.title_changed": { category: "metadata", title: "تغییر نام گروه" },
  "group.photo_changed": { category: "metadata", title: "تغییر تصویر گروه" },
  "group.photo_deleted": { category: "metadata", title: "حذف تصویر گروه" },
  "group.description_changed": { category: "metadata", title: "تغییر توضیحات گروه" },
  "message.pinned": { category: "message", title: "پین‌کردن پیام" },
  "message.unpinned": { category: "message", title: "برداشتن پین پیام" },
  "moderation.ban": { category: "moderation", title: "مسدودسازی عضو" },
  "moderation.unban": { category: "moderation", title: "رفع مسدودسازی عضو" },
  "moderation.kick": { category: "moderation", title: "اخراج عضو" },
  "moderation.mute": { category: "moderation", title: "سکوت عضو" },
  "moderation.unmute": { category: "moderation", title: "رفع سکوت عضو" },
  "moderation.warn": { category: "moderation", title: "ثبت اخطار برای عضو" },
  "moderation.unwarn": { category: "moderation", title: "حذف اخطار عضو" },
  "moderation.delete": { category: "moderation", title: "حذف پیام مدیریتی" },
  "protection.anti_spam": { category: "protection", title: "اقدام ضداسپم" },
  "protection.raid": { category: "protection", title: "فعال‌سازی محافظت ضدحمله" },
  "protection.content_lock": { category: "protection", title: "اجرای قفل محتوا" },
  "system.bot_membership": { category: "system", title: "تغییر دسترسی ربات" },
};

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function englishDigits(value: string) {
  return value.replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

function validTelegramUserId(value: number | null | undefined): value is number {
  return Boolean(value && Number.isSafeInteger(value) && value > 0);
}

function normalizedDisplayName(identity: GroupEventIdentity | null | undefined, fallback: string) {
  const displayName = identity?.displayName?.trim() || identity?.username?.replace(/^@/, "").trim() || fallback;
  return displayName.slice(0, 256);
}

function formatIdentity(identity: GroupEventIdentity | null | undefined, fallback: string) {
  const name = normalizedDisplayName(identity, fallback);
  const id = identity?.telegramUserId;
  const safeName = escapeHtml(name);
  return validTelegramUserId(id) && !identity?.isBot
    ? `<a href="tg://user?id=${id}">${safeName}</a>`
    : safeName;
}

function identityIdText(identity: GroupEventIdentity | null | undefined) {
  return validTelegramUserId(identity?.telegramUserId) ? `<code>${identity!.telegramUserId}</code>` : "<code>نامشخص</code>";
}

export function eventDefinition(eventType: string) {
  const exact = eventDefinitions[eventType];
  if (exact) return exact;
  if (eventType.startsWith("member.")) return { category: "membership" as const, title: "رویداد عضویت گروه" };
  if (eventType.startsWith("role.")) return { category: "role" as const, title: "تغییر نقش گروه" };
  if (eventType.startsWith("group.")) return { category: "metadata" as const, title: "تغییر اطلاعات گروه" };
  if (eventType.startsWith("message.")) return { category: "message" as const, title: "رویداد پیام گروه" };
  if (eventType.startsWith("moderation.")) return { category: "moderation" as const, title: "اقدام مدیریتی گروه" };
  if (eventType.startsWith("protection.")) return { category: "protection" as const, title: "رویداد حفاظتی گروه" };
  return { category: "system" as const, title: "رویداد گروه" };
}

/** Persian calendar date and English digits are deliberately fixed for every group event. */
export function formatGroupEventTimestamp(value: Date) {
  const dateParts = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    timeZone: "Asia/Tehran",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(value);
  const date = Object.fromEntries(dateParts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tehran",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(value);
  return `${englishDigits(`${date.weekday} ${date.day} ${date.month} ${date.year}`)}، ${time}`;
}

export function formatGroupEventBody(input: {
  definition: { category: GroupEventCategory; title: string };
  groupTitle: string;
  actor?: GroupEventIdentity | null;
  subject?: GroupEventIdentity | null;
  details?: GroupEventDetails | null;
  occurredAt: Date;
}) {
  const lines = [
    `<b>◆ ${input.definition.title}</b>`,
    `<code>گروه</code> │ <b>${escapeHtml(input.groupTitle)}</b>`,
    `<code>انجام‌دهنده</code> │ ${formatIdentity(input.actor, "عامل نامشخص")}`,
    `<code>شناسه</code> │ ${identityIdText(input.actor)}`,
  ];
  if (input.subject) {
    lines.push(`<code>هدف</code> │ ${formatIdentity(input.subject, "هدف نامشخص")}`);
    lines.push(`<code>شناسهٔ هدف</code> │ ${identityIdText(input.subject)}`);
  }
  if (input.details?.summary) lines.push(`<code>جزئیات</code> │ ${escapeHtml(input.details.summary)}`);
  if (input.details?.previousValue) lines.push(`<code>پیشین</code> │ ${escapeHtml(input.details.previousValue)}`);
  if (input.details?.nextValue) lines.push(`<code>جدید</code> │ ${escapeHtml(input.details.nextValue)}`);
  if (input.details?.reason) lines.push(`<code>دلیل</code> │ ${escapeHtml(input.details.reason)}`);
  lines.push(`<code>زمان تهران</code> │ <b>${formatGroupEventTimestamp(input.occurredAt)}</b>`);
  return lines.join("\n");
}

/** Pure recipient deduplication: no role or source may cause the same user to receive a duplicate. */
export function collectGroupEventRecipientIds(input: {
  groupOwnerId?: number | null;
  telegramAdminIds: readonly number[];
  kronosRoleIds: readonly number[];
  globalAdminIds: readonly number[];
  actorTelegramId?: number | null;
  botOwnerId?: number;
}) {
  const recipients = new Set<number>();
  const add = (id: number | null | undefined) => {
    if (validTelegramUserId(id) && id !== input.actorTelegramId) recipients.add(id);
  };
  add(input.groupOwnerId);
  input.telegramAdminIds.forEach(add);
  input.kronosRoleIds.forEach(add);
  input.globalAdminIds.forEach(add);
  add(input.botOwnerId ?? OWNER_TELEGRAM_ID);
  return Array.from(recipients);
}

/** Adds the actor only to the Mini App activity feed and never to private-alert recipients. */
export function collectDashboardEventRecipientIds(
  recipientIds: readonly number[],
  actorTelegramId: number | null | undefined,
  includeActorInDashboard = false,
) {
  return Array.from(new Set([
    ...recipientIds,
    ...(includeActorInDashboard && validTelegramUserId(actorTelegramId) ? [actorTelegramId] : []),
  ]));
}

/** Claims an event key for the short delivery window; a repeated claim is a duplicate. */
export function claimGroupEventKey(key: string, occurredAt = new Date()) {
  const now = occurredAt.getTime();
  recentEventKeys.forEach((expiresAt, storedKey) => {
    if (expiresAt <= now) recentEventKeys.delete(storedKey);
  });
  if (recentEventKeys.has(key)) return false;
  recentEventKeys.set(key, now + EVENT_KEY_TTL_MS);
  return true;
}

/** Protection actions remain fully auditable in the Mini App, while private alerts are throttled by group preference. */
export function claimProtectionPrivateDelivery(key: string, cooldownSeconds: number, occurredAt = new Date()) {
  const now = occurredAt.getTime();
  recentProtectionPrivateDeliveries.forEach((expiresAt, storedKey) => {
    if (expiresAt <= now) recentProtectionPrivateDeliveries.delete(storedKey);
  });
  if (recentProtectionPrivateDeliveries.has(key)) return false;
  recentProtectionPrivateDeliveries.set(key, now + cooldownSeconds * 1_000);
  return true;
}

async function resolveKnownIdentities(ids: number[]) {
  const db = await getDb();
  if (!db || ids.length === 0) return new Map<number, GroupEventIdentity>();
  const rows = await db
    .select({ telegramUserId: telegramUsers.telegramUserId, firstName: telegramUsers.firstName, lastName: telegramUsers.lastName, username: telegramUsers.username, isBot: telegramUsers.isBot })
    .from(telegramUsers)
    .where(inArray(telegramUsers.telegramUserId, ids));
  return new Map(rows.map(row => [row.telegramUserId, {
    telegramUserId: row.telegramUserId,
    displayName: [row.firstName, row.lastName].filter(Boolean).join(" ") || null,
    username: row.username,
    isBot: row.isBot,
  }]));
}

function mergeIdentity(provided: GroupEventIdentity | null | undefined, known: GroupEventIdentity | undefined) {
  if (!provided && !known) return undefined;
  return {
    telegramUserId: provided?.telegramUserId ?? known?.telegramUserId ?? null,
    displayName: provided?.displayName ?? known?.displayName ?? null,
    username: provided?.username ?? known?.username ?? null,
    isBot: provided?.isBot ?? known?.isBot,
  } satisfies GroupEventIdentity;
}

/**
 * Persist one Mini App record per authorized recipient, then try private Telegram delivery.
 * Every delivery failure is intentionally contained so the originating group action succeeds.
 */
export async function notifyGroupEvent(input: GroupEventNotificationInput): Promise<GroupEventDeliveryResult> {
  const definition = eventDefinition(input.eventType);
  const occurredAt = input.occurredAt ?? new Date();
  const actorId = input.actor?.telegramUserId ?? null;
  const subjectId = input.subject?.telegramUserId ?? null;
  const eventKey = input.eventKey?.trim() || `${input.groupId}:${input.eventType}:${actorId ?? "system"}:${subjectId ?? "none"}:${Math.floor(occurredAt.getTime() / EVENT_KEY_TTL_MS)}`;
  if (!claimGroupEventKey(eventKey, occurredAt)) {
    return { category: definition.category, recipientIds: [], persistedRecipientIds: [], privateDeliveryRecipientIds: [], duplicate: true };
  }

  try {
    const db = await getDb();
    if (!db) return { category: definition.category, recipientIds: [], persistedRecipientIds: [], privateDeliveryRecipientIds: [], duplicate: false };
    const [groupRow, telegramAdmins, kronosRoles, platformAdmins, preferences, suspensions] = await Promise.all([
      db.select({ title: telegramGroups.title, ownerTelegramId: telegramGroups.ownerTelegramId }).from(telegramGroups).where(eq(telegramGroups.id, input.groupId)).limit(1),
      db.select({ telegramUserId: groupMembers.telegramUserId }).from(groupMembers).where(and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.membershipStatus, "active"), inArray(groupMembers.telegramRole, ["owner", "administrator"]))),
      db.select({ telegramUserId: groupRoles.telegramUserId }).from(groupRoles).where(and(eq(groupRoles.groupId, input.groupId), inArray(groupRoles.role, ["group_owner", "group_admin", "kronos_owner", "moderator"]))),
      db.select({ telegramUserId: globalAdmins.telegramUserId }).from(globalAdmins),
      getGroupEventNotificationPreferences(input.groupId),
      db.select({ telegramUserId: groupAuthoritySuspensions.telegramUserId }).from(groupAuthoritySuspensions).where(eq(groupAuthoritySuspensions.groupId, input.groupId)),
    ]);
    const group = groupRow[0];
    if (!group) return { category: definition.category, recipientIds: [], persistedRecipientIds: [], privateDeliveryRecipientIds: [], duplicate: false };

    const suspendedAuthorityIds = new Set(suspensions.map(row => row.telegramUserId));
    const groupOwnerIsSuspended = typeof group.ownerTelegramId === "number" && suspendedAuthorityIds.has(group.ownerTelegramId);
    const recipientIds = collectGroupEventRecipientIds({
      groupOwnerId: groupOwnerIsSuspended ? null : group.ownerTelegramId,
      telegramAdminIds: telegramAdmins.map(row => row.telegramUserId).filter(telegramUserId => !suspendedAuthorityIds.has(telegramUserId)),
      kronosRoleIds: kronosRoles.map(row => row.telegramUserId).filter(telegramUserId => !suspendedAuthorityIds.has(telegramUserId)),
      globalAdminIds: platformAdmins.map(row => row.telegramUserId),
      actorTelegramId: actorId,
    });
    const knownIdentities = await resolveKnownIdentities([actorId, subjectId].filter(validTelegramUserId));
    const actor = mergeIdentity(input.actor, actorId ? knownIdentities.get(actorId) : undefined);
    const subject = mergeIdentity(input.subject, subjectId ? knownIdentities.get(subjectId) : undefined);
    const body = formatGroupEventBody({ definition, groupTitle: group.title, actor, subject, details: input.details, occurredAt });

    const dashboardRecipientIds = collectDashboardEventRecipientIds(recipientIds, actorId, input.includeActorInDashboard);
    const persisted = await Promise.allSettled(dashboardRecipientIds.map(async telegramUserId => ({ telegramUserId, id: await createUserNotification({
      telegramUserId,
      eventType: input.eventType,
      title: definition.title,
      body,
      relatedGroupId: input.groupId,
      relatedRole: definition.category,
      isRead: input.includeActorInDashboard && telegramUserId === actorId,
    }) })));
    const persistedRecipientIds = persisted.flatMap(result => result.status === "fulfilled" && result.value.id ? [result.value.telegramUserId] : []);

    const leadershipRecipientIds = collectGroupEventRecipientIds({
      groupOwnerId: groupOwnerIsSuspended ? null : group.ownerTelegramId,
      telegramAdminIds: telegramAdmins.map(row => row.telegramUserId).filter(telegramUserId => !suspendedAuthorityIds.has(telegramUserId)),
      kronosRoleIds: [],
      globalAdminIds: [],
      actorTelegramId: actorId,
    });
    const privateRecipientIds = definition.category === "protection" && preferences.protectionRecipientMode === "group_leadership" ? leadershipRecipientIds : recipientIds;
    const privateProtectionDeliveryAllowed = definition.category !== "protection" || claimProtectionPrivateDelivery(`${input.groupId}:${input.eventType}`, preferences.protectionCooldownSeconds, occurredAt);

    const privatePreferenceRows = db && privateRecipientIds.length
      ? await db
          .select({ telegramUserId: telegramUsers.telegramUserId, enabled: telegramUsers.privateNotificationDeliveryEnabled })
          .from(telegramUsers)
          .where(inArray(telegramUsers.telegramUserId, privateRecipientIds))
      : [];
    const privateEnabledByRecipient = new Map(privatePreferenceRows.map(row => [row.telegramUserId, row.enabled]));
    const optedInPrivateRecipientIds = privateRecipientIds.filter(telegramUserId => privateEnabledByRecipient.get(telegramUserId) === true);

    if (!input.telegram || input.sendPrivateMessage === false || (definition.category === "protection" && (!preferences.privateDeliveryEnabled || !privateProtectionDeliveryAllowed))) {
      return { category: definition.category, recipientIds, persistedRecipientIds, privateDeliveryRecipientIds: [], duplicate: false };
    }
    const privateDeliveries = await Promise.allSettled(optedInPrivateRecipientIds.map(async telegramUserId => {
      await withTelegramRetry(() => input.telegram!.sendMessage(telegramUserId, body, { parse_mode: "HTML" }));
      return telegramUserId;
    }));
    const privateDeliveryRecipientIds = privateDeliveries.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    return { category: definition.category, recipientIds, persistedRecipientIds, privateDeliveryRecipientIds, duplicate: false };
  } catch (error) {
    // Notification delivery is never allowed to turn a Telegram group action into a failed update.
    console.warn("[Kronos Guard] group event notification could not be delivered", error);
    return { category: definition.category, recipientIds: [], persistedRecipientIds: [], privateDeliveryRecipientIds: [], duplicate: false };
  }
}
