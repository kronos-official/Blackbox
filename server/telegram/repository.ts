import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { Chat, User } from "telegraf/types";
import {
  auditLogs,
  globalAdmins,
	groupMembers,
	groupAuthoritySuspensions,
	groupRecentMessages,
  groupMemberDailyStats,
  groupRoles,
  groupSettings,
  groupUserDailyStats,
  ownerAlerts,
  telegramGroups,
  telegramUsers,
  webhookEvents,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { MODERATION_INTERNAL_ROLES } from "./rolePolicy";

type TelegramUserUpsertValues = Pick<
  typeof telegramUsers.$inferInsert,
  "telegramUserId" | "username" | "firstName" | "lastName" | "languageCode" | "isBot" | "startedBotAt"
>;

export function buildTelegramUserUpsertValues(user: User, options?: { startedBot?: boolean }): TelegramUserUpsertValues {
  return {
    telegramUserId: user.id,
    username: user.username ?? null,
    firstName: user.first_name,
    lastName: user.last_name ?? null,
    languageCode: user.language_code ?? null,
    isBot: user.is_bot,
    ...(options?.startedBot ? { startedBotAt: new Date() } : {}),
  };
}

export async function recordTelegramUser(user: User, options?: { startedBot?: boolean }) {
  const db = await getDb();
  if (!db) return;
  const insertValues = buildTelegramUserUpsertValues(user, options);
  const { telegramUserId: _telegramUserId, ...updateValues } = insertValues;
  await db
    .insert(telegramUsers)
    .values(insertValues)
    .onDuplicateKeyUpdate({
      set: updateValues,
    });
}

/** Records only participants observed in a bot update; it never claims to be Telegram's complete roster. */
export async function recordKnownGroupMember(input: {
  groupId: number;
  telegramUserId: number;
  status?: "active" | "left" | "kicked" | "unknown";
  telegramRole?: "owner" | "administrator" | "member" | "restricted" | "unknown";
}) {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  const status = input.status ?? "active";
  await db
    .insert(groupMembers)
    .values({ groupId: input.groupId, telegramUserId: input.telegramUserId, membershipStatus: status, telegramRole: input.telegramRole ?? "unknown", firstSeenAt: now, lastSeenAt: now, lastStatusAt: now })
    .onDuplicateKeyUpdate({
      set: {
        membershipStatus: status,
        telegramRole: input.telegramRole ?? sql`${groupMembers.telegramRole}`,
        lastSeenAt: status === "active" ? now : sql`${groupMembers.lastSeenAt}`,
        lastStatusAt: now,
      },
    });
}

/** Mirrors Telegram's currently observed owner/admin authority into the internal role used by the group. */
export async function upsertTelegramGroupAuthorityRole(input: { groupId: number; telegramUserId: number; role: "group_owner" | "group_admin"; grantedByTelegramId?: number; restoreSuspension?: boolean }) {
	const db = await getDb();
	if (!db) return false;
	if (input.restoreSuspension) await clearGroupAuthoritySuspension(input.groupId, input.telegramUserId);
	else if (await isGroupAuthoritySuspended(input.groupId, input.telegramUserId)) return false;
	await db.insert(groupRoles).values({
    groupId: input.groupId,
    telegramUserId: input.telegramUserId,
    role: input.role,
    grantedByTelegramId: input.grantedByTelegramId ?? null,
  }).onDuplicateKeyUpdate({
		set: { grantedByTelegramId: input.grantedByTelegramId ?? sql`${groupRoles.grantedByTelegramId}` },
	});
	return true;
}

/** Blocks a Telegram-native authority from Kronos until the owner initiates bootstrap again. */
export async function suspendGroupAuthority(input: { groupId: number; telegramUserId: number; suspendedByTelegramId: number }) {
	const db = await getDb();
	if (!db) return;
	await db.insert(groupAuthoritySuspensions).values(input).onDuplicateKeyUpdate({ set: { suspendedByTelegramId: input.suspendedByTelegramId } });
}

/** Removes the explicit Kronos suspension; called only by an owner-led authority bootstrap. */
export async function clearGroupAuthoritySuspension(groupId: number, telegramUserId: number) {
	const db = await getDb();
	if (!db) return;
	await db.delete(groupAuthoritySuspensions).where(and(eq(groupAuthoritySuspensions.groupId, groupId), eq(groupAuthoritySuspensions.telegramUserId, telegramUserId)));
}

export async function isGroupAuthoritySuspended(groupId: number, telegramUserId: number) {
	const db = await getDb();
	if (!db) return false;
	const rows = await db.select({ id: groupAuthoritySuspensions.id }).from(groupAuthoritySuspensions).where(and(eq(groupAuthoritySuspensions.groupId, groupId), eq(groupAuthoritySuspensions.telegramUserId, telegramUserId))).limit(1);
	return rows.length > 0;
}

/** Persists actual message IDs observed by Kronos so cleanup never invents a contiguous Telegram message range. */
export async function recordRecentGroupMessage(input: { groupId: number; messageId: number; senderTelegramId?: number; observedAt?: Date; autoDeleteAt?: Date }) {
  const db = await getDb();
  if (!db) return;
  await db.insert(groupRecentMessages).values({
    groupId: input.groupId,
    messageId: input.messageId,
    senderTelegramId: input.senderTelegramId ?? null,
    observedAt: input.observedAt ?? new Date(),
    autoDeleteAt: input.autoDeleteAt ?? null,
  }).onDuplicateKeyUpdate({
    set: {
      observedAt: input.observedAt ?? new Date(),
      autoDeleteAt: input.autoDeleteAt ?? sql`${groupRecentMessages.autoDeleteAt}`,
    },
  });
}

/** Returns only real, observed messages in reverse chronological order; Telegram bots cannot retrieve arbitrary chat history. */
export async function listRecentGroupMessageIds(groupId: number, limit: number) {
  const db = await getDb();
  if (!db || limit < 1) return [];
  const rows = await db.select({ messageId: groupRecentMessages.messageId })
    .from(groupRecentMessages)
    .where(eq(groupRecentMessages.groupId, groupId))
    .orderBy(desc(groupRecentMessages.messageId))
    .limit(limit);
  return rows.map(row => row.messageId);
}

/** Removed IDs are no longer valid cleanup candidates once Telegram has accepted or permanently rejected deletion. */
export async function removeRecentGroupMessageIds(groupId: number, messageIds: number[]) {
  const db = await getDb();
  if (!db || !messageIds.length) return;
  await db.delete(groupRecentMessages).where(and(eq(groupRecentMessages.groupId, groupId), inArray(groupRecentMessages.messageId, messageIds)));
}

/** Stores a Kronos display title for any known group member; this is separate from Telegram's native admin title. */
export async function setKronosMemberTitle(input: { groupId: number; telegramUserId: number; title: string | null }) {
  const db = await getDb();
  if (!db) return false;
  const result = await db.update(groupMembers).set({ kronosTitle: input.title }).where(and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.telegramUserId, input.telegramUserId)));
  return result[0].affectedRows > 0;
}

export async function getKronosMemberTitle(input: { groupId: number; telegramUserId: number }) {
  const db = await getDb();
  if (!db) return null;
  const row = (await db.select({ kronosTitle: groupMembers.kronosTitle }).from(groupMembers).where(and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.telegramUserId, input.telegramUserId))).limit(1))[0];
  return row?.kronosTitle ?? null;
}

function activityDayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export async function recordGroupUserActivity(input: {
  groupId: number;
  telegramUserId: number;
  messages?: number;
  addedMembers?: number;
  forwardedMessages?: number;
  photos?: number;
  videos?: number;
  videoNotes?: number;
  animations?: number;
  documents?: number;
  audios?: number;
  stickers?: number;
  animatedStickers?: number;
  voices?: number;
  at?: Date;
}) {
  const db = await getDb();
  if (!db) return;
  const dayKey = activityDayKey(input.at);
  await db.insert(groupUserDailyStats).values({
    groupId: input.groupId,
    telegramUserId: input.telegramUserId,
    dayKey,
    messageCount: input.messages ?? 0,
    addedMemberCount: input.addedMembers ?? 0,
    forwardedMessageCount: input.forwardedMessages ?? 0,
    photoCount: input.photos ?? 0,
    videoCount: input.videos ?? 0,
    videoNoteCount: input.videoNotes ?? 0,
    animationCount: input.animations ?? 0,
    documentCount: input.documents ?? 0,
    audioCount: input.audios ?? 0,
    stickerCount: input.stickers ?? 0,
    animatedStickerCount: input.animatedStickers ?? 0,
    voiceCount: input.voices ?? 0,
  }).onDuplicateKeyUpdate({
    set: {
      messageCount: sql`${groupUserDailyStats.messageCount} + ${input.messages ?? 0}`,
      addedMemberCount: sql`${groupUserDailyStats.addedMemberCount} + ${input.addedMembers ?? 0}`,
      forwardedMessageCount: sql`${groupUserDailyStats.forwardedMessageCount} + ${input.forwardedMessages ?? 0}`,
      photoCount: sql`${groupUserDailyStats.photoCount} + ${input.photos ?? 0}`,
      videoCount: sql`${groupUserDailyStats.videoCount} + ${input.videos ?? 0}`,
      videoNoteCount: sql`${groupUserDailyStats.videoNoteCount} + ${input.videoNotes ?? 0}`,
      animationCount: sql`${groupUserDailyStats.animationCount} + ${input.animations ?? 0}`,
      documentCount: sql`${groupUserDailyStats.documentCount} + ${input.documents ?? 0}`,
      audioCount: sql`${groupUserDailyStats.audioCount} + ${input.audios ?? 0}`,
      stickerCount: sql`${groupUserDailyStats.stickerCount} + ${input.stickers ?? 0}`,
      animatedStickerCount: sql`${groupUserDailyStats.animatedStickerCount} + ${input.animatedStickers ?? 0}`,
      voiceCount: sql`${groupUserDailyStats.voiceCount} + ${input.voices ?? 0}`,
    },
  });
}

/** Records movement only from explicit Telegram service messages; it does not estimate unseen roster changes. */
export async function recordGroupMemberFlow(input: { groupId: number; joined?: number; left?: number; joinedViaInviteLink?: number; manuallyAdded?: number; expelled?: number; muted?: number; at?: Date }) {
  const db = await getDb();
  if (!db) return;
  const dayKey = activityDayKey(input.at);
  await db.insert(groupMemberDailyStats).values({ groupId: input.groupId, dayKey, joinedCount: input.joined ?? 0, leftCount: input.left ?? 0, joinedViaInviteLinkCount: input.joinedViaInviteLink ?? 0, manuallyAddedCount: input.manuallyAdded ?? 0, expelledCount: input.expelled ?? 0, mutedCount: input.muted ?? 0 }).onDuplicateKeyUpdate({
    set: {
      joinedCount: sql`${groupMemberDailyStats.joinedCount} + ${input.joined ?? 0}`,
      leftCount: sql`${groupMemberDailyStats.leftCount} + ${input.left ?? 0}`,
      joinedViaInviteLinkCount: sql`${groupMemberDailyStats.joinedViaInviteLinkCount} + ${input.joinedViaInviteLink ?? 0}`,
      manuallyAddedCount: sql`${groupMemberDailyStats.manuallyAddedCount} + ${input.manuallyAdded ?? 0}`,
      expelledCount: sql`${groupMemberDailyStats.expelledCount} + ${input.expelled ?? 0}`,
      mutedCount: sql`${groupMemberDailyStats.mutedCount} + ${input.muted ?? 0}`,
    },
  });
}

export async function getGroupUserActivityStats(input: { groupId: number; telegramUserId: number; now?: Date }) {
  const db = await getDb();
  const empty = { today: { messages: 0, addedMembers: 0 }, week: { messages: 0, addedMembers: 0 }, month: { messages: 0, addedMembers: 0 }, all: { messages: 0, addedMembers: 0 }, messageRank: null, addedMemberRank: null };
  if (!db) return empty;
  const now = input.now ?? new Date();
  const todayKey = activityDayKey(now);
  const rows = await db.select({ telegramUserId: groupUserDailyStats.telegramUserId, dayKey: groupUserDailyStats.dayKey, messageCount: groupUserDailyStats.messageCount, addedMemberCount: groupUserDailyStats.addedMemberCount }).from(groupUserDailyStats).where(and(eq(groupUserDailyStats.groupId, input.groupId), eq(groupUserDailyStats.telegramUserId, input.telegramUserId)));
  const rankingRows = await db.select({ telegramUserId: groupUserDailyStats.telegramUserId, messageCount: groupUserDailyStats.messageCount, addedMemberCount: groupUserDailyStats.addedMemberCount }).from(groupUserDailyStats).where(eq(groupUserDailyStats.groupId, input.groupId));
  const dayNumber = (key: string) => Date.parse(`${key}T00:00:00Z`);
  const todayNumber = dayNumber(todayKey);
  const totals = rows.reduce((acc, row) => {
    const age = Math.floor((dayNumber(row.dayKey) - todayNumber) / 86400000);
    acc.all.messages += row.messageCount;
    acc.all.addedMembers += row.addedMemberCount;
    if (age === 0) {
      acc.today.messages += row.messageCount;
      acc.today.addedMembers += row.addedMemberCount;
    }
    if (age >= -6 && age <= 0) {
      acc.week.messages += row.messageCount;
      acc.week.addedMembers += row.addedMemberCount;
    }
    if (age >= -29 && age <= 0) {
      acc.month.messages += row.messageCount;
      acc.month.addedMembers += row.addedMemberCount;
    }
    return acc;
  }, { today: { messages: 0, addedMembers: 0 }, week: { messages: 0, addedMembers: 0 }, month: { messages: 0, addedMembers: 0 }, all: { messages: 0, addedMembers: 0 } });
  const byUser = new Map<number, { messages: number; addedMembers: number }>();
  for (const row of rankingRows) {
    const current = byUser.get(row.telegramUserId) ?? { messages: 0, addedMembers: 0 };
    current.messages += row.messageCount;
    current.addedMembers += row.addedMemberCount;
    byUser.set(row.telegramUserId, current);
  }
  const rankFor = (field: "messages" | "addedMembers") => {
    const ordered = Array.from(byUser.entries()).sort(([, a], [, b]) => b[field] - a[field]);
    const index = ordered.findIndex(([telegramUserId]) => telegramUserId === input.telegramUserId);
    return index < 0 ? null : index + 1;
  };
  return { ...totals, messageRank: rankFor("messages"), addedMemberRank: rankFor("addedMembers") };
}

export async function findTelegramUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const normalized = username.trim().replace(/^@/, "").toLocaleLowerCase("en-US");
  if (!normalized) return undefined;
  return (await db.select({ telegramUserId: telegramUsers.telegramUserId, firstName: telegramUsers.firstName, lastName: telegramUsers.lastName, username: telegramUsers.username, isBot: telegramUsers.isBot }).from(telegramUsers).where(sql`LOWER(${telegramUsers.username}) = ${normalized}`).limit(1))[0];
}

export async function getPreferredLocale(telegramUserId: number) {
  const db = await getDb();
  if (!db) return "fa";
  const user = (await db.select({ preferredLocale: telegramUsers.preferredLocale, languageCode: telegramUsers.languageCode }).from(telegramUsers).where(eq(telegramUsers.telegramUserId, telegramUserId)).limit(1))[0];
  return user?.preferredLocale ?? user?.languageCode ?? "fa";
}

export async function setPreferredLocale(telegramUserId: number, preferredLocale: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(telegramUsers).set({ preferredLocale }).where(eq(telegramUsers.telegramUserId, telegramUserId));
}

export async function registerTelegramGroup(chat: Chat, installingTelegramUserId?: number) {
  if (chat.type !== "group" && chat.type !== "supergroup") return undefined;
  const db = await getDb();
  if (!db) return undefined;
  const groupTitle = chat.title || "Untitled group";
  const groupUsername = "username" in chat ? chat.username ?? null : null;
  const existing = (await db.select({ ownerTelegramId: telegramGroups.ownerTelegramId }).from(telegramGroups).where(eq(telegramGroups.chatId, chat.id)).limit(1))[0];
  await db
    .insert(telegramGroups)
    .values({ chatId: chat.id, title: groupTitle, username: groupUsername, ownerTelegramId: existing?.ownerTelegramId ?? installingTelegramUserId ?? null, lastActivityAt: new Date() })
    .onDuplicateKeyUpdate({
      set: {
        title: groupTitle,
        username: groupUsername,
        lastActivityAt: new Date(),
        ...(installingTelegramUserId !== undefined
          ? { ownerTelegramId: sql`COALESCE(${telegramGroups.ownerTelegramId}, ${installingTelegramUserId})` }
          : {}),
      },
    });

  const group = (await db.select().from(telegramGroups).where(eq(telegramGroups.chatId, chat.id)).limit(1))[0];
  if (group) {
    await db.insert(groupSettings).values({ groupId: group.id }).onDuplicateKeyUpdate({ set: { groupId: sql`${groupSettings.groupId}` } });
  }
  return group;
}

export async function findGroupByChatId(chatId: number) {
  const db = await getDb();
  if (!db) return undefined;
  return (await db.select().from(telegramGroups).where(eq(telegramGroups.chatId, chatId)).limit(1))[0];
}

/** Persist bot membership changes so revoked groups cannot appear in any dashboard panel. */
export async function setTelegramGroupStatus(chatId: number, status: "active" | "permission_lost" | "removed") {
  const db = await getDb();
  if (!db) return;
  await db.update(telegramGroups).set({ status }).where(eq(telegramGroups.chatId, chatId));
}

/** Returns false for a webhook event already fully handled, ensuring idempotent delivery. */
export async function startWebhookEvent(updateId: number, eventType: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return true;
  const existing = (await db.select().from(webhookEvents).where(eq(webhookEvents.updateId, updateId)).limit(1))[0];
  if (existing?.status === "processed" || existing?.status === "ignored") return false;
  if (existing) {
    await db.update(webhookEvents).set({ status: "received", errorMessage: null, receivedAt: new Date(), processedAt: null }).where(eq(webhookEvents.id, existing.id));
  } else {
    await db.insert(webhookEvents).values({ updateId, eventType, status: "received" });
  }
  return true;
}

export async function finishWebhookEvent(updateId: number, status: "processed" | "ignored" | "failed", errorMessage?: string) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(webhookEvents)
    .set({ status, errorMessage: errorMessage?.slice(0, 1_500) ?? null, processedAt: new Date() })
    .where(eq(webhookEvents.updateId, updateId));
}

export async function isGlobalAdmin(telegramUserId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const row = (await db.select({ id: globalAdmins.id }).from(globalAdmins).where(eq(globalAdmins.telegramUserId, telegramUserId)).limit(1))[0];
  return Boolean(row);
}

export async function hasModeratorRole(groupId: number, telegramUserId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select({ role: groupRoles.role })
    .from(groupRoles)
    .where(and(eq(groupRoles.groupId, groupId), eq(groupRoles.telegramUserId, telegramUserId), inArray(groupRoles.role, ["group_owner", "group_admin", ...MODERATION_INTERNAL_ROLES])));
  return rows.length > 0;
}

/** Returns the strongest persisted group authority when a live Telegram lookup is unavailable or stale. */
export async function getStoredGroupAccessLevel(groupId: number, telegramUserId: number): Promise<"group_owner" | "group_admin" | "moderator" | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ role: groupRoles.role })
    .from(groupRoles)
    .where(and(eq(groupRoles.groupId, groupId), eq(groupRoles.telegramUserId, telegramUserId)));
  if (rows.some(({ role }) => role === "group_owner")) return "group_owner";
  if (rows.some(({ role }) => role === "group_admin")) return "group_admin";
  if (rows.some(({ role }) => MODERATION_INTERNAL_ROLES.includes(role as (typeof MODERATION_INTERNAL_ROLES)[number]))) return "moderator";
  return null;
}

export async function writeAuditLog(input: {
  severity?: "info" | "warning" | "critical";
  category: string;
  event: string;
  groupId?: number;
  actorTelegramId?: number;
  subjectTelegramId?: number;
  details?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditLogs).values({
    severity: input.severity ?? "info",
    category: input.category,
    event: input.event,
    groupId: input.groupId ?? null,
    actorTelegramId: input.actorTelegramId ?? null,
    subjectTelegramId: input.subjectTelegramId ?? null,
    details: input.details ?? null,
  });
}

export async function createOwnerAlertRecord(input: {
  alertType: "raid" | "spam_wave" | "forced_join_expired" | "bot_permission_lost" | "webhook_problem" | "database_problem" | "scheduler_failure" | "payment_approval";
  severity: "warning" | "critical";
  title: string;
  body: string;
  dedupeKey: string;
  relatedEntityType?: string;
  relatedEntityId?: number;
}) {
  const db = await getDb();
  if (!db) return undefined;
  await db
    .insert(ownerAlerts)
    .values({
      ...input,
      relatedEntityType: input.relatedEntityType ?? null,
      relatedEntityId: input.relatedEntityId ?? null,
    })
    .onDuplicateKeyUpdate({ set: { dedupeKey: sql`${ownerAlerts.dedupeKey}` } });
  return (await db.select().from(ownerAlerts).where(eq(ownerAlerts.dedupeKey, input.dedupeKey)).limit(1))[0];
}

export async function markOwnerAlertDelivery(id: number, status: "sent" | "failed") {
  const db = await getDb();
  if (!db) return;
  await db
    .update(ownerAlerts)
    .set({ status, attempts: status === "sent" ? 1 : 1, lastAttemptAt: new Date(), sentAt: status === "sent" ? new Date() : null })
    .where(eq(ownerAlerts.id, id));
}


export async function findTelegramUserByReference(reference: { telegramUserId?: number; username?: string }) {
  const db = await getDb();
  if (!db) return undefined;
  const condition = reference.telegramUserId !== undefined
    ? eq(telegramUsers.telegramUserId, reference.telegramUserId)
    : reference.username
      ? sql`LOWER(${telegramUsers.username}) = ${reference.username.replace(/^@/, "").toLocaleLowerCase("en-US")}`
      : undefined;
  if (!condition) return undefined;
  return (await db.select().from(telegramUsers).where(condition).limit(1))[0];
}

export async function listKnownGroupsForUser(telegramUserId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ group: telegramGroups })
    .from(groupMembers)
    .innerJoin(telegramGroups, eq(groupMembers.groupId, telegramGroups.id))
    .where(and(eq(groupMembers.telegramUserId, telegramUserId), eq(groupMembers.membershipStatus, "active"), eq(telegramGroups.status, "active")));
}


/** Returns only Telegram entities previously observed by Kronos Guard for this user. */
export async function listKnownNumericTargetsForUser(telegramUserId: number) {
  const db = await getDb();
  if (!db) return { groups: [], users: [] };

  const groups = await db
    .select({ group: telegramGroups })
    .from(groupMembers)
    .innerJoin(telegramGroups, eq(groupMembers.groupId, telegramGroups.id))
    .where(and(eq(groupMembers.telegramUserId, telegramUserId), eq(groupMembers.membershipStatus, "active"), eq(telegramGroups.status, "active")));

    const groupIds = groups.map(({ group }) => group.id);
  const users = groupIds.length === 0
    ? []
    : await db
        .select({ user: telegramUsers })
        .from(groupMembers)
        .innerJoin(telegramUsers, eq(groupMembers.telegramUserId, telegramUsers.telegramUserId))
        .where(and(inArray(groupMembers.groupId, groupIds), eq(groupMembers.membershipStatus, "active")));
  return {
    groups: groups.map(({ group }) => group),
    users: users.map(({ user }) => user).filter(user => user.telegramUserId !== telegramUserId),
  };
}
