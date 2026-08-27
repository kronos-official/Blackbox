import { and, desc, eq, isNull, like, not, or, sql } from "drizzle-orm";
import { telegramUsers, userNotifications } from "../drizzle/schema";
import { getDb } from "./db";

export const USER_NOTIFICATION_CATEGORIES = ["membership", "role", "metadata", "message", "moderation", "protection", "system"] as const;
export type UserNotificationCategory = (typeof USER_NOTIFICATION_CATEGORIES)[number];

export function normalizeUserNotificationMutes(value: unknown): UserNotificationCategory[] {
  const requested = Array.isArray(value) ? value : [];
  const allowed = new Set(requested.filter((category): category is UserNotificationCategory => typeof category === "string" && (USER_NOTIFICATION_CATEGORIES as readonly string[]).includes(category)));
  return USER_NOTIFICATION_CATEGORIES.filter(category => allowed.has(category));
}

function notificationCategoryCondition(category: UserNotificationCategory) {
  if (category === "membership") return or(eq(userNotifications.relatedRole, "membership"), like(userNotifications.eventType, "member.%"));
  if (category === "role") return or(eq(userNotifications.relatedRole, "role"), like(userNotifications.eventType, "role.%"));
  if (category === "metadata") return or(eq(userNotifications.relatedRole, "metadata"), like(userNotifications.eventType, "group.%"));
  if (category === "message") return or(eq(userNotifications.relatedRole, "message"), like(userNotifications.eventType, "message.%"));
  if (category === "moderation") return or(eq(userNotifications.relatedRole, "moderation"), like(userNotifications.eventType, "moderation.%"));
  if (category === "protection") return or(eq(userNotifications.relatedRole, "protection"), like(userNotifications.eventType, "protection.%"));
  return or(isNull(userNotifications.relatedRole), not(or(
    or(eq(userNotifications.relatedRole, "membership"), like(userNotifications.eventType, "member.%")),
    or(eq(userNotifications.relatedRole, "role"), like(userNotifications.eventType, "role.%")),
    or(eq(userNotifications.relatedRole, "metadata"), like(userNotifications.eventType, "group.%")),
    or(eq(userNotifications.relatedRole, "message"), like(userNotifications.eventType, "message.%")),
    or(eq(userNotifications.relatedRole, "moderation"), like(userNotifications.eventType, "moderation.%")),
    or(eq(userNotifications.relatedRole, "protection"), like(userNotifications.eventType, "protection.%")),
  )!));
}

export async function getUserNotificationMutes(telegramUserId: number): Promise<UserNotificationCategory[]> {
  const db = await getDb();
  if (!db) return [];
  const row = (await db.select({ notificationMutes: telegramUsers.notificationMutes }).from(telegramUsers).where(eq(telegramUsers.telegramUserId, telegramUserId)).limit(1))[0];
  return normalizeUserNotificationMutes(row?.notificationMutes);
}

export async function setUserNotificationMutes(telegramUserId: number, mutedCategories: unknown): Promise<UserNotificationCategory[]> {
  const db = await getDb();
  const normalized = normalizeUserNotificationMutes(mutedCategories);
  if (!db) return normalized;
  await db.insert(telegramUsers).values({ telegramUserId, notificationMutes: normalized }).onDuplicateKeyUpdate({ set: { notificationMutes: normalized, updatedAt: new Date() } });
  return normalized;
}

/** Returns the user's global preference for Telegram private-chat copies of eligible notifications. */
export async function getUserPrivateDelivery(telegramUserId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const row = (await db.select({ enabled: telegramUsers.privateNotificationDeliveryEnabled }).from(telegramUsers).where(eq(telegramUsers.telegramUserId, telegramUserId)).limit(1))[0];
  return row?.enabled === true;
}

/** Persists the global private-chat delivery preference without altering notification content or history. */
export async function setUserPrivateDelivery(telegramUserId: number, enabled: boolean): Promise<boolean> {
  const db = await getDb();
  if (!db) return enabled;
  await db.insert(telegramUsers).values({ telegramUserId, privateNotificationDeliveryEnabled: enabled }).onDuplicateKeyUpdate({ set: { privateNotificationDeliveryEnabled: enabled, updatedAt: new Date() } });
  return enabled;
}

export type UserNotificationInput = {
  telegramUserId: number;
  eventType: string;
  title: string;
  body: string;
  relatedGroupId?: number | null;
  relatedRole?: string | null;
  /** Activity records can be visible in the Mini App without creating an unread alert. */
  isRead?: boolean;
};

export async function createUserNotification(input: UserNotificationInput) {
  const db = await getDb();
  if (!db) return null;
  const [created] = await db.insert(userNotifications).values({
    telegramUserId: input.telegramUserId,
    eventType: input.eventType,
    title: input.title,
    body: input.body,
    relatedGroupId: input.relatedGroupId ?? null,
    relatedRole: input.relatedRole ?? null,
    isRead: input.isRead ?? false,
    readAt: input.isRead ? new Date() : null,
  }).$returningId() as Array<{ id?: number }>;
  return created?.id ?? null;
}

export type UserNotificationFilters = {
  relatedGroupId?: number | null;
  eventType?: string | null;
  mutedCategories?: UserNotificationCategory[];
};

function notificationWhere(telegramUserId: number, filters?: UserNotificationFilters) {
  const conditions = [eq(userNotifications.telegramUserId, telegramUserId)];
  if (filters?.relatedGroupId) conditions.push(eq(userNotifications.relatedGroupId, filters.relatedGroupId));
  if (filters?.eventType) conditions.push(eq(userNotifications.eventType, filters.eventType));
  const mutedCategoryConditions = normalizeUserNotificationMutes(filters?.mutedCategories).map(notificationCategoryCondition);
  if (mutedCategoryConditions.length) {
    const mutedMatch = or(...mutedCategoryConditions);
    if (mutedMatch) conditions.push(not(mutedMatch));
  }
  return and(...conditions);
}

export async function listUserNotifications(telegramUserId: number, limit = 50, filters?: UserNotificationFilters) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(userNotifications)
    .where(notificationWhere(telegramUserId, filters))
    .orderBy(desc(userNotifications.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

export async function countUnreadUserNotifications(telegramUserId: number, filters?: UserNotificationFilters) {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(userNotifications)
    .where(and(notificationWhere(telegramUserId, filters), eq(userNotifications.isRead, false)));
  return Number(row?.count ?? 0);
}

export async function markUserNotificationRead(telegramUserId: number, notificationId: number) {
  const db = await getDb();
  if (!db) return false;
  const result = await db.update(userNotifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(userNotifications.id, notificationId), eq(userNotifications.telegramUserId, telegramUserId)));
  return result[0].affectedRows > 0;
}

export async function markAllUserNotificationsRead(telegramUserId: number, filters?: UserNotificationFilters) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.update(userNotifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(notificationWhere(telegramUserId, filters), eq(userNotifications.isRead, false)));
  return result[0].affectedRows;
}
