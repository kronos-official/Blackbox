import { eq } from "drizzle-orm";
import { groupSettings } from "../../drizzle/schema";
import { getDb } from "../db";

export const GROUP_EVENT_DELIVERY_MODES = ["authorized_admins", "group_leadership"] as const;
export type GroupEventDeliveryMode = (typeof GROUP_EVENT_DELIVERY_MODES)[number];

export type GroupEventNotificationPreferences = {
  /** Whether authorized recipients also receive a best-effort Telegram private message. */
  privateDeliveryEnabled: boolean;
  /** Which eligible recipients may receive private protection-event alerts. Mini App records remain available to every authorized recipient. */
  protectionRecipientMode: GroupEventDeliveryMode;
  /** Minimum time between equivalent high-volume protection alerts for one group. */
  protectionCooldownSeconds: number;
  /** Delay before Kronos Guard automatically deletes each newly sent group message. */
  botMessageAutoDeleteDelaySeconds: number;
  /** Delay before a successful command acknowledgement is automatically deleted. */
  temporarySuccessDeleteDelaySeconds: number;
};

type GroupCustomSettings = Record<string, unknown> & {
  groupEventNotifications?: Partial<GroupEventNotificationPreferences>;
};

export const DEFAULT_GROUP_EVENT_NOTIFICATION_PREFERENCES: GroupEventNotificationPreferences = {
  privateDeliveryEnabled: true,
  protectionRecipientMode: "authorized_admins",
  protectionCooldownSeconds: 60,
  botMessageAutoDeleteDelaySeconds: 300,
  temporarySuccessDeleteDelaySeconds: 5,
};

const cache = new Map<number, { value: GroupEventNotificationPreferences; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

function boundedCooldown(value: unknown) {
  const seconds = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_GROUP_EVENT_NOTIFICATION_PREFERENCES.protectionCooldownSeconds;
  return Math.min(3_600, Math.max(15, seconds));
}

function boundedBotMessageAutoDeleteDelay(value: unknown) {
  const seconds = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_GROUP_EVENT_NOTIFICATION_PREFERENCES.botMessageAutoDeleteDelaySeconds;
  return Math.min(86_400, Math.max(60, seconds));
}

function boundedTemporarySuccessDeleteDelay(value: unknown) {
  const seconds = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_GROUP_EVENT_NOTIFICATION_PREFERENCES.temporarySuccessDeleteDelaySeconds;
  return Math.min(86_400, Math.max(5, seconds));
}

export function normalizeGroupEventNotificationPreferences(value: unknown): GroupEventNotificationPreferences {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<GroupEventNotificationPreferences> : {};
  return {
    privateDeliveryEnabled: typeof raw.privateDeliveryEnabled === "boolean" ? raw.privateDeliveryEnabled : DEFAULT_GROUP_EVENT_NOTIFICATION_PREFERENCES.privateDeliveryEnabled,
    protectionRecipientMode: raw.protectionRecipientMode === "group_leadership" ? "group_leadership" : "authorized_admins",
    protectionCooldownSeconds: boundedCooldown(raw.protectionCooldownSeconds),
    botMessageAutoDeleteDelaySeconds: boundedBotMessageAutoDeleteDelay(raw.botMessageAutoDeleteDelaySeconds),
    temporarySuccessDeleteDelaySeconds: boundedTemporarySuccessDeleteDelay(raw.temporarySuccessDeleteDelaySeconds),
  };
}

export async function getGroupEventNotificationPreferences(groupId: number): Promise<GroupEventNotificationPreferences> {
  const cached = cache.get(groupId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const db = await getDb();
  if (!db) return DEFAULT_GROUP_EVENT_NOTIFICATION_PREFERENCES;
  const row = (await db.select({ customSettings: groupSettings.customSettings }).from(groupSettings).where(eq(groupSettings.groupId, groupId)).limit(1))[0];
  const settings = row?.customSettings && typeof row.customSettings === "object" && !Array.isArray(row.customSettings) ? row.customSettings as GroupCustomSettings : {};
  const value = normalizeGroupEventNotificationPreferences(settings.groupEventNotifications);
  cache.set(groupId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function updateGroupEventNotificationPreferences(groupId: number, input: Partial<GroupEventNotificationPreferences>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const row = (await db.select({ customSettings: groupSettings.customSettings }).from(groupSettings).where(eq(groupSettings.groupId, groupId)).limit(1))[0];
  const current = row?.customSettings && typeof row.customSettings === "object" && !Array.isArray(row.customSettings) ? row.customSettings as GroupCustomSettings : {};
  const value = normalizeGroupEventNotificationPreferences({ ...current.groupEventNotifications, ...input });
  await db.insert(groupSettings).values({ groupId, customSettings: { ...current, groupEventNotifications: value } }).onDuplicateKeyUpdate({ set: { customSettings: { ...current, groupEventNotifications: value } } });
  cache.set(groupId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export function clearGroupEventNotificationPreferencesCache(groupId?: number) {
  if (typeof groupId === "number") cache.delete(groupId);
  else cache.clear();
}
