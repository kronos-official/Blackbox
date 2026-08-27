import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { groupRecentMessages, groupSettings, moderationActions, scheduledJobs, telegramGroups, webhookEvents } from "../../drizzle/schema";
import { getDb } from "../db";
import { getTelegramBot } from "./bot";
import { alertOwner } from "./alerts";
import { classifyCleanupDeleteFailure } from "./cleanup";
import { removeRecentGroupMessageIds, writeAuditLog } from "./repository";

const AUTO_DELETE_BATCH_LIMIT = 100;

function hourKey(now: Date) {
  return now.toISOString().slice(0, 13);
}

function fifteenMinuteKey(now: Date) {
  const minute = Math.floor(now.getUTCMinutes() / 15) * 15;
  return `${now.toISOString().slice(0, 13)}:${String(minute).padStart(2, "0")}`;
}

async function claimScheduledWork(jobType: "temporary_punishment_expiry" | "raid_mode_expiry" | "cleanup", idempotencyKey: string, now: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable for scheduled maintenance");
  await db.insert(scheduledJobs).values({ jobType, idempotencyKey, payload: { source: "heartbeat" }, status: "pending", runAfter: now }).onDuplicateKeyUpdate({ set: { idempotencyKey: sql`${scheduledJobs.idempotencyKey}` } });
  const job = (await db.select().from(scheduledJobs).where(eq(scheduledJobs.idempotencyKey, idempotencyKey)).limit(1))[0];
  if (!job || job.status === "completed") return { db, job: undefined };
  await db.update(scheduledJobs).set({ status: "running", lockedAt: now, attempts: sql`${scheduledJobs.attempts} + 1`, lastError: null }).where(eq(scheduledJobs.id, job.id));
  return { db, job };
}

async function finishScheduledWork(jobId: number, error?: unknown) {
  const db = await getDb();
  if (!db) return;
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(scheduledJobs).set({ status: "failed", lastError: message.slice(0, 1500) }).where(eq(scheduledJobs.id, jobId));
  } else {
    await db.update(scheduledJobs).set({ status: "completed", completedAt: new Date() }).where(eq(scheduledJobs.id, jobId));
  }
}

const unmutePermissions = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
};

/** Reverses expired timed mutes and bans that have never been completed; safe to retry after any scheduler failure. */
export async function reconcileTemporaryPunishments(now = new Date()) {
  const { db, job } = await claimScheduledWork("temporary_punishment_expiry", `temporary_punishment_expiry:${fifteenMinuteKey(now)}`, now);
  if (!job) return { skipped: true, unmuted: 0, unbanned: 0 };
  try {
    const expiredActions = await db.select().from(moderationActions).where(and(inArray(moderationActions.action, ["mute", "ban"]), isNull(moderationActions.completedAt), lte(moderationActions.expiresAt, now)));
    const telegram = getTelegramBot()?.telegram;
    if (expiredActions.length && !telegram) throw new Error("Telegram bot unavailable while expiring temporary punishments");
    let unmuted = 0;
    let unbanned = 0;
    for (const action of expiredActions) {
      const group = (await db.select().from(telegramGroups).where(eq(telegramGroups.id, action.groupId)).limit(1))[0];
      if (!group || !action.targetTelegramId) {
        await db.update(moderationActions).set({ completedAt: now }).where(and(eq(moderationActions.id, action.id), isNull(moderationActions.completedAt)));
        continue;
      }
      if (action.action === "mute") {
        await telegram!.restrictChatMember(group.chatId, action.targetTelegramId, { permissions: unmutePermissions });
        await db.insert(moderationActions).values({ groupId: action.groupId, actorTelegramId: null, targetTelegramId: action.targetTelegramId, action: "unmute", source: "scheduler", reason: "Temporary mute expired" });
        await writeAuditLog({ category: "scheduler", event: "temporary_mute_expired", groupId: action.groupId, subjectTelegramId: action.targetTelegramId, details: { muteActionId: action.id } });
        unmuted += 1;
      } else {
        await telegram!.unbanChatMember(group.chatId, action.targetTelegramId, { only_if_banned: true });
        await db.insert(moderationActions).values({ groupId: action.groupId, actorTelegramId: null, targetTelegramId: action.targetTelegramId, action: "unban", source: "scheduler", reason: "Temporary ban expired" });
        await writeAuditLog({ category: "scheduler", event: "temporary_ban_expired", groupId: action.groupId, subjectTelegramId: action.targetTelegramId, details: { banActionId: action.id } });
        unbanned += 1;
      }
      await db.update(moderationActions).set({ completedAt: now }).where(and(eq(moderationActions.id, action.id), isNull(moderationActions.completedAt)));
    }
    await finishScheduledWork(job.id);
    return { skipped: false, unmuted, unbanned };
  } catch (error) {
    await finishScheduledWork(job.id, error);
    throw error;
  }
}

/** Clears only expired raid-mode windows. Permanent content-lock settings are never read or changed here. */
export async function reconcileExpiredRaidMode(now = new Date()) {
  const { db, job } = await claimScheduledWork("raid_mode_expiry", `raid_mode_expiry:${fifteenMinuteKey(now)}`, now);
  if (!job) return { skipped: true, reset: 0 };
  try {
    const expired = await db
      .select({ groupId: groupSettings.groupId })
      .from(groupSettings)
      .where(lte(groupSettings.raidModeUntil, now));
    let reset = 0;
    for (const setting of expired) {
      const result = await db
        .update(groupSettings)
        .set({ raidModeUntil: null })
        .where(and(eq(groupSettings.groupId, setting.groupId), lte(groupSettings.raidModeUntil, now)));
      if ((result[0]?.affectedRows ?? 0) === 0) continue;
      await writeAuditLog({
        severity: "info",
        category: "scheduler",
        event: "raid_mode_expired",
        groupId: setting.groupId,
        details: { expiredAt: now.toISOString() },
      });
      reset += 1;
    }
    await finishScheduledWork(job.id);
    return { skipped: false, reset };
  } catch (error) {
    await finishScheduledWork(job.id, error);
    throw error;
  }
}

/** Prunes old processed webhook records and completed scheduler ledger rows through an hourly idempotent maintenance job. */
export async function reconcileBotMaintenance(now = new Date()) {
  const { db, job } = await claimScheduledWork("cleanup", `bot_maintenance:${hourKey(now)}`, now);
  if (!job) return { skipped: true, deletedWebhookEvents: 0, deletedCompletedJobs: 0 };
  try {
    const webhookCutoff = new Date(now.getTime() - 90 * 86_400_000);
    const jobCutoff = new Date(now.getTime() - 30 * 86_400_000);
    const webhookResult = await db.delete(webhookEvents).where(and(inArray(webhookEvents.status, ["processed", "ignored"]), lt(webhookEvents.receivedAt, webhookCutoff)));
    const jobResult = await db.delete(scheduledJobs).where(and(eq(scheduledJobs.status, "completed"), lt(scheduledJobs.completedAt, jobCutoff)));
    await finishScheduledWork(job.id);
    return { skipped: false, deletedWebhookEvents: webhookResult[0].affectedRows ?? 0, deletedCompletedJobs: jobResult[0].affectedRows ?? 0 };
  } catch (error) {
    await finishScheduledWork(job.id, error);
    throw error;
  }
}

/** Deletes due bot-authored group messages. Permanent Telegram deletion failures retire the row; transient failures remain due for a later retry. */
export async function reconcileOutboundMessageAutoDeletion(now = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable for outbound message auto-deletion");
  const dueMessages = await db
    .select({ groupId: groupRecentMessages.groupId, messageId: groupRecentMessages.messageId, chatId: telegramGroups.chatId, groupTitle: telegramGroups.title, groupStatus: telegramGroups.status })
    .from(groupRecentMessages)
    .innerJoin(telegramGroups, eq(telegramGroups.id, groupRecentMessages.groupId))
    .where(and(isNotNull(groupRecentMessages.autoDeleteAt), lte(groupRecentMessages.autoDeleteAt, now)))
    .orderBy(asc(groupRecentMessages.autoDeleteAt), asc(groupRecentMessages.id))
    .limit(AUTO_DELETE_BATCH_LIMIT);
  if (!dueMessages.length) return { due: 0, deleted: 0, retired: 0, retiredUnavailable: 0, retiredPermission: 0, retrying: 0 };

  const telegram = getTelegramBot()?.telegram;
  if (!telegram) throw new Error("Telegram bot runtime is unavailable for outbound message auto-deletion");

  const retiredByGroup = new Map<number, number[]>();
  let deleted = 0;
  let retired = 0;
  let retiredUnavailable = 0;
  let retiredPermission = 0;
  let retrying = 0;
  const permissionFailures = new Map<number, { title: string; count: number }>();
  for (const message of dueMessages) {
    if (message.groupStatus === "permission_lost" || message.groupStatus === "removed") {
      const messageIds = retiredByGroup.get(message.groupId) ?? [];
      messageIds.push(message.messageId);
      retiredByGroup.set(message.groupId, messageIds);
      retired += 1;
      retiredUnavailable += 1;
      continue;
    }
    try {
      await telegram.deleteMessage(message.chatId, message.messageId);
      const messageIds = retiredByGroup.get(message.groupId) ?? [];
      messageIds.push(message.messageId);
      retiredByGroup.set(message.groupId, messageIds);
      deleted += 1;
    } catch (error) {
      const failure = classifyCleanupDeleteFailure(error);
      if (failure === "not_found" || failure === "too_old_or_unsupported" || failure === "permission") {
        const messageIds = retiredByGroup.get(message.groupId) ?? [];
        messageIds.push(message.messageId);
        retiredByGroup.set(message.groupId, messageIds);
        retired += 1;
        if (failure === "permission") {
          retiredPermission += 1;
          const current = permissionFailures.get(message.groupId) ?? { title: message.groupTitle, count: 0 };
          current.count += 1;
          permissionFailures.set(message.groupId, current);
        }
        continue;
      }
      retrying += 1;
      console.warn("[Kronos Guard] outbound message auto-deletion will retry", { groupId: message.groupId, messageId: message.messageId, failure });
    }
  }
  await Promise.all(Array.from(retiredByGroup.entries()).map(([groupId, messageIds]) => removeRecentGroupMessageIds(groupId, messageIds)));
  await Promise.all(Array.from(permissionFailures.entries()).map(async ([groupId, failure]) => {
    await writeAuditLog({
      severity: "warning",
      category: "scheduler",
      event: "outbound_message_auto_delete_permission_lost",
      groupId,
      details: { retiredMessages: failure.count },
    });
    await alertOwner(telegram, {
      alertType: "bot_permission_lost",
      severity: "warning",
      title: "حذف خودکار پیام‌های ربات متوقف شد",
      body: `Kronos Guard نتوانست ${failure.count.toLocaleString("en-US")} پیام زمان‌دار را در گروه «${failure.title}» حذف کند. مجوز «حذف پیام‌ها»ی ربات را بررسی کنید.`,
      dedupeKey: `outbound-auto-delete-permission:${groupId}:${now.toISOString().slice(0, 10)}`,
      relatedEntityType: "telegram_group",
      relatedEntityId: groupId,
    });
  }));
  return { due: dueMessages.length, deleted, retired, retiredUnavailable, retiredPermission, retrying };
}
