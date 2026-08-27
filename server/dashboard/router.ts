import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  auditLogs,
  channelListings,
  contentLocks,
  customCommands,
  forcedJoinAcquisitions,
  forcedJoinDailyStats,
  filterRules,
  forcedJoinSessions,
  forcedJoinChannels,
  globalAdmins,
  groupMembers,
  groupRoles,
  groupSettings,
  lockPolicySnapshots,
  marketplacePaymentSettings,
  moderationActions,
  moderationNotes,
  ownerAlerts,
  paymentOrders,
  paymentReceipts,
  scheduledJobs,
  telegramGroups,
  telegramUsers,
  userWarnings,
  webhookEvents,
  vipProtections,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { storageGetSignedUrl } from "../storage";
import { issueOwnerReceiptLink } from "./receiptAccess";
import { OWNER_TELEGRAM_ID } from "../telegram/constants";
import { recordKnownGroupMember, recordTelegramUser, setKronosMemberTitle, setTelegramGroupStatus, writeAuditLog } from "../telegram/repository";
import { publicProcedure, router } from "../_core/trpc";
import { issueDashboardSession, verifyDashboardSession, verifyTelegramMiniAppInitData } from "./telegramMiniAppAuth";
import { approveManualOrderByOwner, createStarsInvoiceLinkForDashboard, getMarketplaceCapacity, sendCustomStarsInvoice, STARS_PER_DAY } from "../payments/marketplace";
import { accessRank, type AccessLevel } from "../telegram/constants";
import { getTelegramBot } from "../telegram/bot";
import { withTelegramRetry } from "../telegram/retry";
import { normalizeTelegramMemberStatus } from "./liveTelegramRoles";
import { mayDelegateKronosRole } from "../telegram/rolePolicy";
import { forcedJoinDestinationErrorMessage, resolveForcedJoinDestinationReference, verifyForcedJoinDestination } from "../telegram/forcedJoinDestination";
import { checkMiniAppForcedJoin, checkedMiniAppForcedJoinStatus, getRequiredForcedJoinChannels, noMiniAppForcedJoinStatus, unavailableMiniAppForcedJoinStatus } from "../telegram/forcedJoin";
import { getGroupChatMetadataCacheMetrics } from "../telegram/groupChatMetadataCache";
import { GROUP_POLICY_KEYS, listGroupAuditEvents, listGroupPolicyVersions, previewGroupPolicyOverride, rollbackGroupPolicyOverride, setGroupPolicyOverride, type GroupPolicyKey } from "../telegram/policyAudit";
import { DEFAULT_VIP_PROTECTION, getVipProtectionPolicy, saveVipProtectionPolicy } from "../telegram/vipProtection";
import { getGroupEventNotificationPreferences, GROUP_EVENT_DELIVERY_MODES, updateGroupEventNotificationPreferences } from "../telegram/groupEventPreferences";
import { getStarsReferenceMarketData } from "../marketplace/starsReferenceRate";
import { getCryptoMarketAsset, getCryptoMarketChart, getCryptoMarketTopAssets, searchCryptoMarketAssets } from "../market/cryptoMarket";
import { getNobitexAssetMarket, getNobitexAssetMarkets, getNobitexPrimaryMarkets, getNobitexTopMarkets, getNobitexUsdtMarket, searchNobitexMarkets } from "../market/nobitexMarket";
import { listCryptoMarketFavoriteIds, setCryptoMarketFavorite } from "../market/cryptoMarketFavorites";
import { getIranMacroMarkets } from "../market/iranMacroMarket";

const DASHBOARD_LOCK_TYPES = ["link", "photo", "video", "voice", "audio", "sticker", "gif", "document", "forward", "mention", "hashtag", "emoji", "phone", "location", "poll", "game", "bot", "command", "english", "persian", "edited_message", "long_message", "text", "reply", "inline_button", "profanity", "all"] as const;
type DashboardLockType = (typeof DASHBOARD_LOCK_TYPES)[number];
type LockPolicyKey = "open" | "media_shield" | "strict_guard";
type LockPolicyState = { lockType: DashboardLockType; enabled: boolean; action: "delete" | "warn" | "mute"; exemptionRole: "none" | "vip" | "moderator" | "admin" };

const DASHBOARD_LOCK_POLICIES: Record<LockPolicyKey, readonly DashboardLockType[]> = {
  open: [],
  media_shield: ["photo", "video", "voice", "audio", "sticker", "gif", "document"],
  strict_guard: ["link", "forward", "mention", "hashtag", "phone", "bot", "command", "inline_button", "profanity"],
};

function completeLockPolicySnapshot(existingLocks: Array<Pick<LockPolicyState, "lockType" | "enabled" | "action" | "exemptionRole">>): LockPolicyState[] {
  const lockByType = new Map(existingLocks.map(lock => [lock.lockType, lock]));
  return DASHBOARD_LOCK_TYPES.map(lockType => {
    const existing = lockByType.get(lockType);
    return { lockType, enabled: existing?.enabled ?? false, action: existing?.action ?? "delete", exemptionRole: existing?.exemptionRole ?? "vip" };
  });
}
import { formatDashboardSettingAnnouncement } from "./settingAnnouncements";
import { createSupportRouter } from "./supportRouter";
import { countUnreadUserNotifications, createUserNotification, getUserNotificationMutes, getUserPrivateDelivery, listUserNotifications, markAllUserNotificationsRead, markUserNotificationRead, setUserNotificationMutes, setUserPrivateDelivery, USER_NOTIFICATION_CATEGORIES } from "../notifications";

const dashboardProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const token = ctx.req.header("x-kronos-owner-session");
  if (!token) throw new TRPCError({ code: "UNAUTHORIZED", message: "Telegram Mini App session is required" });
  try {
    const actor = await verifyDashboardSession(token);
    return next({ ctx: { ...ctx, actor } });
  } catch {
    throw new TRPCError({ code: "FORBIDDEN", message: "Telegram Mini App session is invalid or expired" });
  }
});

const ownerProcedure = dashboardProcedure.use(async ({ ctx, next }) => {
  if (ctx.actor.telegramUserId !== OWNER_TELEGRAM_ID) throw new TRPCError({ code: "FORBIDDEN", message: "This control is restricted to the Kronos Guard owner" });
  return next({ ctx });
});

async function resolveDashboardGroupAccess(actorTelegramId: number, groupId: number): Promise<AccessLevel | null> {
  const db = await getDb();
  if (!db) return null;
  const group = (await db.select({ chatId: telegramGroups.chatId, status: telegramGroups.status }).from(telegramGroups).where(eq(telegramGroups.id, groupId)).limit(1))[0];
  if (!group || group.status === "removed" || group.status === "permission_lost") return null;
  // The signed Telegram identity itself must hold a live owner/admin role. Installer metadata is
  // only provenance; it can never grant access or prevent a current administrator from seeing
  // their own group panel.
  const bot = getTelegramBot();
  if (!bot) return null;
  try {
    const liveMember = await bot.telegram.getChatMember(group.chatId, actorTelegramId);
    if (liveMember.user.id !== actorTelegramId) return null;
    const normalized = normalizeTelegramMemberStatus(liveMember.status);
    if (!normalized.access) return null;
    await Promise.all([
      recordTelegramUser(liveMember.user),
      recordKnownGroupMember({ groupId, telegramUserId: actorTelegramId, status: normalized.membershipStatus, telegramRole: normalized.telegramRole }),
    ]);
    return normalized.access;
  } catch (error) {
    console.warn("[Kronos Guard] live dashboard role lookup failed", { groupId, actorTelegramId, error: error instanceof Error ? error.message : "unknown" });
    return null;
  }
}

async function resolveDashboardGroupDiscoveryAccess(actorTelegramId: number, group: { id: number; chatId: number; ownerTelegramId?: number | null }): Promise<AccessLevel | null> {
  return resolveDashboardGroupAccess(actorTelegramId, group.id);
}

async function requireDashboardGroupAccess(actorTelegramId: number, groupId: number, minimum: AccessLevel) {
  const access = await resolveDashboardGroupAccess(actorTelegramId, groupId);
  if (!access || accessRank[access] < accessRank[minimum]) throw new TRPCError({ code: "FORBIDDEN", message: "Your Telegram role does not permit this group action" });
  return access;
}

const groupSettingInput = z.object({
  groupId: z.number().int().positive(),
  welcomeEnabled: z.boolean(),
  welcomeMessage: z.string().max(3500).nullable(),
  goodbyeEnabled: z.boolean(),
  goodbyeMessage: z.string().max(3500).nullable(),
	antiSpamEnabled: z.boolean(),
	antiRaidEnabled: z.boolean(),
	marketCommandsEnabled: z.boolean().optional(),
	floodMessageLimit: z.number().int().min(2).max(50),
  floodWindowSeconds: z.number().int().min(3).max(300),
  duplicateMessageLimit: z.number().int().min(2).max(20),
  warnLimit: z.number().int().min(1).max(20),
  warnAction: z.enum(["mute", "ban"]),
  // Telegram treats very long restrictions as indefinite; one operational year remains explicit and reversible.
  warnMuteMinutes: z.number().int().min(0).max(525_600),
  rulesText: z.string().max(3500).nullable(),
});

const telegramAdministratorPermissions = {
  can_manage_chat: true,
  can_delete_messages: true,
  can_manage_video_chats: true,
  can_restrict_members: true,
  can_promote_members: false,
  can_change_info: true,
  can_invite_users: true,
  can_post_stories: false,
  can_edit_stories: false,
  can_delete_stories: false,
  can_post_messages: false,
  can_edit_messages: false,
  can_pin_messages: true,
  can_manage_topics: true,
};

const noTelegramAdministratorPermissions = Object.fromEntries(Object.keys(telegramAdministratorPermissions).map(key => [key, false]));
export const DATABASE_RESET_CONFIRMATION = "RESET KRONOS DATABASE";

function escapeTelegramHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const KRONOS_ROLE_RANK: Record<"kronos_owner" | "moderator" | "vip" | "user", number> = { kronos_owner: 4, moderator: 3, vip: 2, user: 1 };

function hasSameOrHigherKronosRole(currentRoles: Array<{ role: string }>, requestedRole: "kronos_owner" | "moderator" | "vip" | "user") {
  if (requestedRole === "user") return false;
  return currentRoles.some(({ role }) => (role in KRONOS_ROLE_RANK) && KRONOS_ROLE_RANK[role as keyof typeof KRONOS_ROLE_RANK] >= KRONOS_ROLE_RANK[requestedRole]);
}

function dashboardRoleChangeMessage(input: { telegramUserId: number; displayName: string; actorTelegramId: number; actorDisplayName: string; role: "kronos_owner" | "moderator" | "vip" | "user" | "telegram_admin" | "telegram_member" }) {
  const mention = `<a href="tg://user?id=${input.telegramUserId}">${escapeTelegramHtml(input.displayName)}</a>`;
  const actorMention = `<a href="tg://user?id=${input.actorTelegramId}">${escapeTelegramHtml(input.actorDisplayName)}</a>`;
  const body = {
    kronos_owner: `کاربر ${mention} به مالک Kronos تغییر مقام پیدا کرد.`,
    moderator: `کاربر ${mention} به مدیر Kronos تغییر مقام پیدا کرد.`,
    vip: `کاربر ${mention} به کاربر ویژه تغییر مقام پیدا کرد.`,
    user: `نقش داخلی Kronos کاربر ${mention} به کاربر عادی تغییر کرد.`,
    telegram_admin: `کاربر ${mention} به مدیر تلگرام تغییر مقام پیدا کرد.`,
    telegram_member: `نقش مدیر تلگرام کاربر ${mention} به کاربر عادی تغییر کرد.`,
  }[input.role];
  const now = new Date();
  const layer = input.role === "telegram_admin" || input.role === "telegram_member" ? "لایه: نقش واقعی تلگرام" : "لایه: نقش داخلی Kronos";
  return `${body}\n${layer}\nانجام‌دهنده: ${actorMention}\n\nساعت: ${new Intl.DateTimeFormat("fa-IR", { timeStyle: "short" }).format(now)}\nتاریخ: ${new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "long" }).format(now)}`;
}

const dashboardSettingLabels = {
  welcomeEnabled: "پیام خوش‌آمد",
  goodbyeEnabled: "پیام خداحافظی",
	antiSpamEnabled: "ضد اسپم",
	antiRaidEnabled: "ضد رید",
	marketCommandsEnabled: "صرافی گروه",
} as const;

const dashboardLockLabels: Record<string, string> = {
  link: "لینک", photo: "عکس", video: "ویدیو", voice: "پیام صوتی", audio: "فایل صوتی", sticker: "استیکر", gif: "گیف", document: "سند", forward: "فوروارد", mention: "منشن", hashtag: "هشتگ", emoji: "ایموجی", phone: "شماره تلفن", location: "موقعیت مکانی", poll: "نظرسنجی", game: "بازی", bot: "ربات", command: "دستور", english: "متن انگلیسی", persian: "متن فارسی", edited_message: "پیام ویرایش‌شده", long_message: "پیام بلند", text: "متن", reply: "پاسخ", inline_button: "دکمهٔ درون‌خطی", profanity: "الفاظ نامناسب", all: "همهٔ محتوا",
};

function missingForcedJoinChannelCount(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is number => typeof item === "number" && Number.isInteger(item) && item > 0))).length
    : 0;
}

export const dashboardRouter = router({
  auth: router({
    loginTelegram: publicProcedure.input(z.object({ initData: z.string().min(32).max(8192) })).mutation(async ({ input }) => {
      const owner = verifyTelegramMiniAppInitData(input.initData);
      return { token: await issueDashboardSession(owner), user: owner, isOwner: owner.telegramUserId === OWNER_TELEGRAM_ID, expiresInSeconds: 43_200 };
    }),
  }),
  profile: dashboardProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const fallback = {
      firstName: ctx.actor.firstName ?? null,
      username: ctx.actor.username ?? null,
      photoUrl: ctx.actor.photoUrl ?? null,
      preferredLocale: "fa",
      forcedJoinStatus: noMiniAppForcedJoinStatus(),
    };
    if (!db) return fallback;
    const [userRows] = await Promise.all([
      db.select({ firstName: telegramUsers.firstName, username: telegramUsers.username, preferredLocale: telegramUsers.preferredLocale }).from(telegramUsers).where(eq(telegramUsers.telegramUserId, ctx.actor.telegramUserId)).limit(1),
    ]);
    const user = userRows[0];
    const isOwner = ctx.actor.telegramUserId === OWNER_TELEGRAM_ID;
    let forcedJoinStatus = fallback.forcedJoinStatus;
    if (!isOwner) {
      const required = await getRequiredForcedJoinChannels();
      const bot = getTelegramBot();
      if (required.length > 0 && !bot) {
        forcedJoinStatus = unavailableMiniAppForcedJoinStatus(required);
      } else if (required.length > 0 && bot) {
        const checked = await checkMiniAppForcedJoin(ctx.actor.telegramUserId, bot.telegram);
        forcedJoinStatus = checkedMiniAppForcedJoinStatus(checked);
      }
    }
    return {
      firstName: user?.firstName ?? ctx.actor.firstName ?? null,
      username: user?.username ?? ctx.actor.username ?? null,
      photoUrl: ctx.actor.photoUrl ?? null,
      preferredLocale: user?.preferredLocale ?? "fa",
      forcedJoinStatus,
    };
  }),
  support: createSupportRouter({ dashboardProcedure, ownerProcedure }),
  policyAudit: router({
    list: ownerProcedure.input(z.object({
      groupId: z.number().int().positive(),
      actorTelegramId: z.number().int().optional(),
      action: z.string().trim().min(1).max(160).optional(),
      outcome: z.enum(["allowed", "denied", "completed", "failed"]).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    })).query(({ input }) => listGroupAuditEvents(input)),
    previewPolicy: ownerProcedure.input(z.object({
      groupId: z.number().int().positive(),
      policyKey: z.enum(Object.values(GROUP_POLICY_KEYS) as [GroupPolicyKey, ...GroupPolicyKey[]]),
      value: z.boolean(),
    })).query(({ input }) => previewGroupPolicyOverride(input)),
    listPolicyVersions: ownerProcedure.input(z.object({
      groupId: z.number().int().positive(),
      policyKey: z.enum(Object.values(GROUP_POLICY_KEYS) as [GroupPolicyKey, ...GroupPolicyKey[]]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    })).query(({ input }) => listGroupPolicyVersions(input)),
    setPolicy: ownerProcedure.input(z.object({
      groupId: z.number().int().positive(),
      policyKey: z.enum(Object.values(GROUP_POLICY_KEYS) as [GroupPolicyKey, ...GroupPolicyKey[]]),
      value: z.boolean(),
    })).mutation(async ({ ctx, input }) => {
      const result = await setGroupPolicyOverride({ ...input, updatedByTelegramId: ctx.actor.telegramUserId });
      return { success: true, policyKey: input.policyKey, value: input.value, ...result } as const;
    }),
    rollbackPolicy: ownerProcedure.input(z.object({
      groupId: z.number().int().positive(),
      policyKey: z.enum(Object.values(GROUP_POLICY_KEYS) as [GroupPolicyKey, ...GroupPolicyKey[]]),
      versionId: z.number().int().positive(),
    })).mutation(async ({ ctx, input }) => {
      const result = await rollbackGroupPolicyOverride({ ...input, updatedByTelegramId: ctx.actor.telegramUserId });
      return { success: true, policyKey: input.policyKey, ...result } as const;
    }),
  }),
  setLocale: dashboardProcedure.input(z.object({ locale: z.enum(["fa", "en", "ar", "tr", "ru", "es", "fr", "pt", "it", "de", "pl", "vi"]) })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    if (db) {
      await db.update(telegramUsers).set({ preferredLocale: input.locale }).where(eq(telegramUsers.telegramUserId, ctx.actor.telegramUserId));
    }
    return { locale: input.locale };
  }),
  broadcast: ownerProcedure.input(z.object({ text: z.string().trim().min(1).max(4096) })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    const bot = getTelegramBot();
    if (!db || !bot) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Telegram bot is not ready" });
    const [recipients, knownUsers] = await Promise.all([
      db.select({ telegramUserId: telegramUsers.telegramUserId }).from(telegramUsers).where(and(eq(telegramUsers.isBot, false), isNotNull(telegramUsers.startedBotAt))),
      db.select({ telegramUserId: telegramUsers.telegramUserId }).from(telegramUsers).where(eq(telegramUsers.isBot, false)),
    ]);
    // Telegram forbids a bot from initiating a private conversation. A known group
    // member becomes eligible only after they start or otherwise contact the bot.
    const needsPrivateStart = Math.max(0, knownUsers.length - recipients.length);
    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
      try {
        await bot.telegram.sendMessage(recipient.telegramUserId, input.text);
        sent += 1;
      } catch (error) {
        failed += 1;
        console.warn("[Kronos Guard] broadcast delivery failed", { telegramUserId: recipient.telegramUserId, error: error instanceof Error ? error.message : "unknown" });
      }
    }
    await writeAuditLog({ category: "owner_broadcast", event: "broadcast_sent", actorTelegramId: ctx.actor.telegramUserId, details: { total: recipients.length, sent, failed, needsPrivateStart } });
    return { total: recipients.length, sent, failed, needsPrivateStart };
  }),
  cache: router({
    metrics: ownerProcedure.query(() => getGroupChatMetadataCacheMetrics()),
  }),
  health: ownerProcedure.query(async () => {
    const collectedAt = Date.now();
    const now = new Date(collectedAt);
    const recentSince = new Date(collectedAt - 24 * 60 * 60 * 1000);
    const db = await getDb();
    const cache = getGroupChatMetadataCacheMetrics(collectedAt);

    if (!db) {
      return {
        collectedAt,
        overall: "unavailable" as const,
        database: { status: "unavailable" as const, latencyMs: null },
        webhook: { status: "unavailable" as const, pendingUpdates: null, received24h: 0, failed24h: 0, lastEventAt: null, lastErrorAt: null, telegramLatencyMs: null },
        scheduler: { status: "unavailable" as const, dueJobs: 0, failedJobs: 0 },
        cache: { status: cache.loaderErrors > 0 ? "degraded" as const : "healthy" as const, ...cache },
      };
    }

    const databaseStartedAt = Date.now();
    let recentWebhookEvents: Array<{ status: "received" | "processed" | "ignored" | "failed"; receivedAt: Date }> = [];
    let dueJobs: Array<{ id: number }> = [];
    let failedJobs: Array<{ id: number }> = [];
    try {
      [recentWebhookEvents, dueJobs, failedJobs] = await Promise.all([
        db.select({ status: webhookEvents.status, receivedAt: webhookEvents.receivedAt })
          .from(webhookEvents)
          .where(gte(webhookEvents.receivedAt, recentSince))
          .orderBy(desc(webhookEvents.receivedAt))
          .limit(100),
        db.select({ id: scheduledJobs.id })
          .from(scheduledJobs)
          .where(and(eq(scheduledJobs.status, "pending"), lt(scheduledJobs.runAfter, now)))
          .limit(100),
        db.select({ id: scheduledJobs.id })
          .from(scheduledJobs)
          .where(eq(scheduledJobs.status, "failed"))
          .limit(100),
      ]);
    } catch {
      return {
        collectedAt,
        overall: "unavailable" as const,
        database: { status: "unavailable" as const, latencyMs: null },
        webhook: { status: "unavailable" as const, pendingUpdates: null, received24h: 0, failed24h: 0, lastEventAt: null, lastErrorAt: null, telegramLatencyMs: null },
        scheduler: { status: "unavailable" as const, dueJobs: 0, failedJobs: 0 },
        cache: { status: cache.loaderErrors > 0 ? "degraded" as const : "healthy" as const, ...cache },
      };
    }

    const failedWebhookEvents = recentWebhookEvents.filter(event => event.status === "failed");
    const lastEventAt = recentWebhookEvents[0]?.receivedAt?.getTime() ?? null;
    const bot = getTelegramBot();
    let pendingUpdates: number | null = null;
    let lastErrorAt: number | null = null;
    let telegramLatencyMs: number | null = null;
    let telegramReachable = false;
    if (bot) {
      try {
        const telegramStartedAt = Date.now();
        const webhookInfo = await bot.telegram.getWebhookInfo();
        telegramLatencyMs = Math.max(0, Date.now() - telegramStartedAt);
        pendingUpdates = webhookInfo.pending_update_count;
        lastErrorAt = webhookInfo.last_error_date ? webhookInfo.last_error_date * 1000 : null;
        telegramReachable = true;
      } catch {
        telegramReachable = false;
      }
    }

    const database = { status: "healthy" as const, latencyMs: Math.max(0, Date.now() - databaseStartedAt) };
    // Telegram retains the last webhook error indefinitely. Treat it as actionable
    // only while it is recent; otherwise a recovered webhook would stay degraded forever.
    const recentTelegramError = Boolean(lastErrorAt && lastErrorAt >= Date.now() - 24 * 60 * 60 * 1_000);
    const webhookDegraded = !telegramReachable || failedWebhookEvents.length > 0 || recentTelegramError || (pendingUpdates ?? 0) > 0;
    const webhook = {
      status: (webhookDegraded ? "degraded" : "healthy") as "healthy" | "degraded",
      pendingUpdates,
      received24h: recentWebhookEvents.length,
      failed24h: failedWebhookEvents.length,
      lastEventAt,
      lastErrorAt,
      telegramLatencyMs,
    };
    const scheduler = {
      status: (dueJobs.length > 0 || failedJobs.length > 0 ? "degraded" : "healthy") as "healthy" | "degraded",
      dueJobs: dueJobs.length,
      failedJobs: failedJobs.length,
    };
    const cacheHealth = { status: (cache.loaderErrors > 0 ? "degraded" : "healthy") as "healthy" | "degraded", ...cache };
    const overall = webhook.status === "healthy" && scheduler.status === "healthy" && cacheHealth.status === "healthy" ? "healthy" as const : "degraded" as const;
    return { collectedAt, overall, database, webhook, scheduler, cache: cacheHealth };
  }),
  overview: ownerProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { groups: 0, activeForcedJoin: 0, pendingPayments: 0, criticalAlerts: 0, recentAlerts: [] };
    const [groups, forced, orders, alerts] = await Promise.all([
      db.select().from(telegramGroups),
      db.select().from(forcedJoinChannels).where(eq(forcedJoinChannels.status, "active")),
      db.select().from(paymentOrders).where(inArray(paymentOrders.status, ["pending_approval", "receipt_submitted"])),
      db.select().from(ownerAlerts).where(inArray(ownerAlerts.status, ["pending", "failed"])).orderBy(desc(ownerAlerts.createdAt)).limit(8),
    ]);
    return { groups: groups.length, activeForcedJoin: forced.length, pendingPayments: orders.length, criticalAlerts: alerts.filter(alert => alert.severity === "critical").length, recentAlerts: alerts };
  }),
  groups: router({
    connected: ownerProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select({
        id: telegramGroups.id,
        chatId: telegramGroups.chatId,
        title: telegramGroups.title,
        username: telegramGroups.username,
        status: telegramGroups.status,
        installedAt: telegramGroups.installedAt,
        lastActivityAt: telegramGroups.lastActivityAt,
      }).from(telegramGroups).orderBy(desc(telegramGroups.installedAt));
    }),
    list: dashboardProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const [groups, settings] = await Promise.all([
        db.select().from(telegramGroups)
          .where(eq(telegramGroups.status, "active"))
          .orderBy(desc(telegramGroups.lastActivityAt)),
        db.select().from(groupSettings),
      ]);
      const bot = getTelegramBot();
      const botUser = bot ? await bot.telegram.getMe().catch(() => null) : null;
      const visible = await Promise.all(groups.map(async group => {
        // Re-check the bot's live admin status for every signed user. A group appears only when
        // both the bot and the signed Telegram identity currently retain permitted authority.
        try {
          if (!botUser || !bot) return { group, access: null };
          const liveBotMember = await bot.telegram.getChatMember(group.chatId, botUser.id);
          const liveStatus = liveBotMember.status;
          const isAdministrator = liveStatus === "administrator" || liveStatus === "creator";
          await setTelegramGroupStatus(group.chatId, isAdministrator ? "active" : "permission_lost");
          if (!isAdministrator) return { group, access: null };
          const access = await resolveDashboardGroupDiscoveryAccess(ctx.actor.telegramUserId, group);
          return { group: { ...group, status: "active" as const }, access };
        } catch (error) {
          // Do not probe known inaccessible groups on every panel refresh. A new incoming
          // group update can reactivate it if the bot is added back in the future.
          if (group.status !== "permission_lost") {
            console.warn("[Kronos Guard] group discovery access lost", { groupId: group.id, chatId: group.chatId, actorTelegramId: ctx.actor.telegramUserId, error: error instanceof Error ? error.message : "unknown" });
            await setTelegramGroupStatus(group.chatId, "permission_lost");
          }
          return { group, access: null };
        }
      }));
      return visible.filter(item => item.access).map(({ group, access }) => ({ ...group, access: access!, settings: settings.find(item => item.groupId === group.id) ?? null }));
    }),
    detail: dashboardProcedure.input(z.object({ groupId: z.number().int().positive() })).query(async ({ input, ctx }) => {
      await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "user");
      const db = await getDb();
      if (!db) return null;
      const group = (await db.select().from(telegramGroups).where(eq(telegramGroups.id, input.groupId)).limit(1))[0];
      if (!group) return null;
      const [settings, locks, filters, commands, notes, warnings, actions] = await Promise.all([
        db.select().from(groupSettings).where(eq(groupSettings.groupId, input.groupId)).limit(1),
        db.select().from(contentLocks).where(eq(contentLocks.groupId, input.groupId)),
        db.select().from(filterRules).where(eq(filterRules.groupId, input.groupId)),
        db.select().from(customCommands).where(eq(customCommands.groupId, input.groupId)),
        db.select().from(moderationNotes).where(eq(moderationNotes.groupId, input.groupId)).orderBy(desc(moderationNotes.createdAt)).limit(30),
        db.select().from(userWarnings).where(eq(userWarnings.groupId, input.groupId)),
        db.select().from(moderationActions).where(eq(moderationActions.groupId, input.groupId)).orderBy(desc(moderationActions.createdAt)).limit(50),
      ]);
      return { group, settings: settings[0] ?? null, locks, filters, commands, notes, warnings, actions };
    }),
    updateSettings: dashboardProcedure.input(groupSettingInput).mutation(async ({ input, ctx }) => {
      await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "group_admin");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { groupId, ...settings } = input;
      const [previousSettings, group] = await Promise.all([
		db.select({ welcomeEnabled: groupSettings.welcomeEnabled, goodbyeEnabled: groupSettings.goodbyeEnabled, antiSpamEnabled: groupSettings.antiSpamEnabled, antiRaidEnabled: groupSettings.antiRaidEnabled, marketCommandsEnabled: groupSettings.marketCommandsEnabled }).from(groupSettings).where(eq(groupSettings.groupId, groupId)).limit(1),
        db.select({ chatId: telegramGroups.chatId, language: telegramGroups.language }).from(telegramGroups).where(eq(telegramGroups.id, groupId)).limit(1),
      ]);
      await db.insert(groupSettings).values({ groupId, ...settings }).onDuplicateKeyUpdate({ set: settings });
      const changes = (Object.keys(dashboardSettingLabels) as Array<keyof typeof dashboardSettingLabels>)
        .filter(key => typeof settings[key] === "boolean" && previousSettings[0]?.[key] !== settings[key])
        .map(key => ({ label: dashboardSettingLabels[key], enabled: Boolean(settings[key]) }));
      if (group[0] && changes.length) {
        const bot = getTelegramBot();
        if (bot) try {
          await bot.telegram.sendMessage(group[0].chatId, formatDashboardSettingAnnouncement({ locale: group[0].language, actorTelegramId: ctx.actor.telegramUserId, actorDisplayName: ctx.actor.firstName || ctx.actor.username || String(ctx.actor.telegramUserId), changes }), { parse_mode: "HTML" });
        } catch (error) {
          console.error("[Kronos Guard] settings announcement failed", { groupId, error: error instanceof Error ? error.message : "unknown" });
        }
      }
      await writeAuditLog({ category: "dashboard", event: "group_settings_updated", groupId, actorTelegramId: ctx.actor.telegramUserId });
      return { success: true };
    }),
  }),
  forcedJoin: router({
    list: dashboardProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(forcedJoinChannels).orderBy(desc(forcedJoinChannels.createdAt));
      if (ctx.actor.telegramUserId === OWNER_TELEGRAM_ID) return rows;
      const visible = await Promise.all(rows.filter(row => row.scope === "group" && row.groupId).map(async row => {
        try {
          await requireDashboardGroupAccess(ctx.actor.telegramUserId, row.groupId!, "group_admin");
          return row;
        } catch {
          return null;
        }
      }));
      return visible.filter((row): row is typeof rows[number] => Boolean(row));
    }),
    analytics: dashboardProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const [channels, acquisitionRows, dailyRows] = await Promise.all([
        db.select().from(forcedJoinChannels).orderBy(desc(forcedJoinChannels.createdAt)),
        db.select().from(forcedJoinAcquisitions),
        db.select().from(forcedJoinDailyStats).orderBy(desc(forcedJoinDailyStats.dayKey)),
      ]);
      const visible = ctx.actor.telegramUserId === OWNER_TELEGRAM_ID
        ? channels
        : (await Promise.all(channels.filter(channel => channel.scope === "group" && channel.groupId).map(async channel => {
          try {
            await requireDashboardGroupAccess(ctx.actor.telegramUserId, channel.groupId!, "group_admin");
            return channel;
          } catch {
            return null;
          }
        }))).filter((channel): channel is typeof channels[number] => Boolean(channel));
      const acquisitionByChannelId = new Map(acquisitionRows.map(row => [row.forcedJoinChannelId, row]));
      return visible.map(channel => {
        const acquisition = acquisitionByChannelId.get(channel.id);
        const daily = dailyRows.filter(row => row.forcedJoinChannelId === channel.id).slice(0, 31).map(row => ({ day: row.dayKey, count: row.verifiedCount }));
        return {
          channelId: channel.id,
          title: channel.title,
          buttonLabel: channel.buttonLabel,
          scope: channel.scope,
          groupId: channel.groupId,
          status: channel.status,
          expiresAt: channel.expiresAt,
          verifiedAcquisitions: acquisition?.verifiedCount ?? 0,
          lastVerifiedAt: acquisition?.lastVerifiedAt ?? null,
          daily,
        };
      });
    }),
    upsert: dashboardProcedure.input(z.object({ id: z.number().int().positive().optional(), destinationReference: z.string().trim().min(3).max(1024), title: z.string().trim().max(512).nullable(), username: z.string().trim().max(128).nullable(), inviteUrl: z.string().url().max(1024).nullable(), scope: z.enum(["global", "group", "marketplace"]), groupId: z.number().int().positive().nullable(), status: z.enum(["active", "paused"]), expiresAt: z.date().nullable() })).mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      if (input.scope === "group" && !input.groupId) throw new TRPCError({ code: "BAD_REQUEST", message: "A group-scoped join requirement requires a group" });
      if (ctx.actor.telegramUserId !== OWNER_TELEGRAM_ID) {
        if (input.scope !== "group" || !input.groupId) throw new TRPCError({ code: "FORBIDDEN", message: "Only the bot owner can manage global forced membership" });
        await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "group_admin");
      }
      const bot = getTelegramBot();
      if (!bot) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Telegram bot connection is not ready" });
      let destinationReference: Awaited<ReturnType<typeof resolveForcedJoinDestinationReference>>;
      try {
        destinationReference = await resolveForcedJoinDestinationReference(bot.telegram, input.destinationReference);
        await verifyForcedJoinDestination(bot.telegram, destinationReference.channelChatId);
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        console.warn("[Kronos Guard] forced-join destination resolution failed", { destinationReference: input.destinationReference, error: raw });
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: forcedJoinDestinationErrorMessage(error) });
      }
      const channelChatId = destinationReference.channelChatId;
      const destinationUsername = destinationReference.username ?? input.username?.replace(/^@/, "") ?? null;
      const inviteUrl = input.inviteUrl ?? (destinationUsername ? `https://t.me/${destinationUsername}` : null);
      if (!inviteUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "برای مقصد خصوصیِ بدون یوزرنیم، لینک دعوت معتبر را نیز وارد کنید." });
      const title = destinationReference.title ?? input.title?.trim() ?? "";
      if (!title) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "نام مقصد از Telegram خوانده نشد؛ یک نام کوتاه برای کانال وارد کنید." });
      const values = { channelChatId, title, username: destinationUsername, inviteUrl, scope: input.scope, groupId: input.scope === "group" ? input.groupId : null, status: input.status, expiresAt: input.expiresAt, ownerTelegramId: ctx.actor.telegramUserId } as const;
      try {
        if (input.id) await db.update(forcedJoinChannels).set(values).where(eq(forcedJoinChannels.id, input.id));
        else await db.insert(forcedJoinChannels).values(values);
      } catch (error) {
        const raw = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        if (raw.includes("duplicate") || raw.includes("unique")) throw new TRPCError({ code: "CONFLICT", message: "این مقصد پیش‌تر برای همین محدوده ثبت شده است." });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "ثبت مقصد انجام نشد؛ لطفاً اطلاعات واردشده و اتصال پایگاه‌داده را بررسی کنید." });
      }
      await writeAuditLog({ category: "dashboard", event: input.id ? "forced_join_updated" : "forced_join_created", groupId: input.scope === "group" ? input.groupId ?? undefined : undefined, actorTelegramId: ctx.actor.telegramUserId, details: { channelChatId, scope: input.scope } });
      return { success: true };
    }),
    remove: dashboardProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const channel = (await db.select().from(forcedJoinChannels).where(eq(forcedJoinChannels.id, input.id)).limit(1))[0];
      if (!channel) throw new TRPCError({ code: "NOT_FOUND", message: "کانال عضویت اجباری پیدا نشد." });
      if (ctx.actor.telegramUserId !== OWNER_TELEGRAM_ID) {
        if (channel.scope !== "group" || !channel.groupId) throw new TRPCError({ code: "FORBIDDEN", message: "Only the bot owner can remove global forced membership" });
        await requireDashboardGroupAccess(ctx.actor.telegramUserId, channel.groupId, "group_admin");
      }
      await db.delete(forcedJoinAcquisitions).where(eq(forcedJoinAcquisitions.forcedJoinChannelId, channel.id));
      await db.delete(forcedJoinChannels).where(eq(forcedJoinChannels.id, channel.id));
      await writeAuditLog({ category: "dashboard", event: "forced_join_removed", groupId: channel.groupId ?? undefined, actorTelegramId: ctx.actor.telegramUserId, details: { channelId: channel.id, channelChatId: channel.channelChatId, scope: channel.scope } });
      return { success: true };
    }),
  }),
  members: router({
    list: dashboardProcedure.input(z.object({ groupId: z.number().int().positive(), includeDeparted: z.boolean().default(false) })).query(async ({ input, ctx }) => {
      await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "moderator");
      const db = await getDb();
      if (!db) return { members: [], totalKnown: 0 };
      const memberRows = await db.select().from(groupMembers).where(input.includeDeparted ? eq(groupMembers.groupId, input.groupId) : and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.membershipStatus, "active"))).orderBy(desc(groupMembers.lastSeenAt));
      const ids = memberRows.map(member => member.telegramUserId);
      if (!ids.length) return { members: [], totalKnown: 0 };
      const [users, roles, warnings, group] = await Promise.all([
        db.select().from(telegramUsers).where(inArray(telegramUsers.telegramUserId, ids)),
        db.select().from(groupRoles).where(eq(groupRoles.groupId, input.groupId)),
        db.select().from(userWarnings).where(eq(userWarnings.groupId, input.groupId)),
        db.select().from(telegramGroups).where(eq(telegramGroups.id, input.groupId)).limit(1),
      ]);
      return {
        totalKnown: memberRows.length,
        members: memberRows.map(member => {
          const user = users.find(item => item.telegramUserId === member.telegramUserId);
          const managedRoles = roles.filter(role => role.telegramUserId === member.telegramUserId).map(role => role.role);
          const warning = warnings.find(item => item.telegramUserId === member.telegramUserId);
          return {
            ...member,
            username: user?.username ?? null,
            firstName: user?.firstName ?? null,
            lastName: user?.lastName ?? null,
            isBot: user?.isBot ?? false,
            managedRoles,
            telegramRole: member.telegramRole,
            isGroupOwner: group[0]?.ownerTelegramId === member.telegramUserId,
            warningCount: warning?.count ?? 0,
          };
        }),
      };
    }),
    setKronosTitle: dashboardProcedure.input(z.object({ groupId: z.number().int().positive(), targetTelegramId: z.number().int().positive(), title: z.string().trim().max(64).nullable() })).mutation(async ({ input, ctx }) => {
      await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "group_admin");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const member = (await db.select({ id: groupMembers.id }).from(groupMembers).where(and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.telegramUserId, input.targetTelegramId))).limit(1))[0];
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Known group member not found" });
      const saved = await setKronosMemberTitle({ groupId: input.groupId, telegramUserId: input.targetTelegramId, title: input.title });
      if (!saved) throw new TRPCError({ code: "NOT_FOUND", message: "Known group member not found" });
      await writeAuditLog({ category: "dashboard_members", event: input.title ? "internal_title_set" : "internal_title_removed", groupId: input.groupId, actorTelegramId: ctx.actor.telegramUserId, subjectTelegramId: input.targetTelegramId, details: { title: input.title } });
      return { success: true, title: input.title };
    }),
    getVipProtection: dashboardProcedure.input(z.object({ groupId: z.number().int().positive(), targetTelegramId: z.number().int().positive() })).query(async ({ input, ctx }) => {
      await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "moderator");
      const policy = await getVipProtectionPolicy(input.groupId, input.targetTelegramId);
      return policy ?? null;
    }),
    setVipProtection: dashboardProcedure.input(z.object({
      groupId: z.number().int().positive(),
      targetTelegramId: z.number().int().positive(),
      protectMute: z.boolean().optional(),
      protectBan: z.boolean().optional(),
      protectKick: z.boolean().optional(),
      protectDelete: z.boolean().optional(),
      ignoreAntiSpam: z.boolean().optional(),
      ignoreAntiRaid: z.boolean().optional(),
      ignoreFilters: z.boolean().optional(),
      ignoreContentLocks: z.boolean().optional(),
      ignoreForcedJoin: z.boolean().optional(),
      notifyBlockedActions: z.boolean().optional(),
      expiresAt: z.number().int().positive().nullable().optional(),
    })).mutation(async ({ input, ctx }) => {
      await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "group_admin");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const vipRole = (await db.select({ id: groupRoles.id }).from(groupRoles).where(and(eq(groupRoles.groupId, input.groupId), eq(groupRoles.telegramUserId, input.targetTelegramId), eq(groupRoles.role, "vip"))).limit(1))[0];
      if (!vipRole) throw new TRPCError({ code: "BAD_REQUEST", message: "این کاربر در حال حاضر مقام ویژه ندارد" });
      const { groupId, targetTelegramId, expiresAt, ...partial } = input;
      const policy = await saveVipProtectionPolicy({ groupId, telegramUserId: targetTelegramId, updatedByTelegramId: ctx.actor.telegramUserId, policy: { ...partial, ...(expiresAt === undefined ? {} : { expiresAt: expiresAt === null ? null : new Date(expiresAt) }) } });
      await writeAuditLog({ category: "dashboard_vip", event: "protection_policy_updated", groupId, actorTelegramId: ctx.actor.telegramUserId, subjectTelegramId: targetTelegramId, details: { policy } });
      return policy ?? DEFAULT_VIP_PROTECTION;
    }),
    refreshAdmins: dashboardProcedure.input(z.object({ groupId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
      await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "group_admin");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const group = (await db.select({ chatId: telegramGroups.chatId }).from(telegramGroups).where(eq(telegramGroups.id, input.groupId)).limit(1))[0];
      if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      const bot = getTelegramBot();
      if (!bot) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Telegram bot connection is not ready" });
      try {
        const [administrators, totalTelegramMembers] = await Promise.all([
          bot.telegram.getChatAdministrators(group.chatId),
          bot.telegram.getChatMembersCount(group.chatId),
        ]);
        await Promise.all(administrators.map(async administrator => {
          const normalized = normalizeTelegramMemberStatus(administrator.status);
          await Promise.all([
            recordTelegramUser(administrator.user),
            recordKnownGroupMember({ groupId: input.groupId, telegramUserId: administrator.user.id, status: normalized.membershipStatus, telegramRole: normalized.telegramRole }),
          ]);
        }));
        await writeAuditLog({
          category: "dashboard_members",
          event: "telegram_administrators_refreshed",
          groupId: input.groupId,
          actorTelegramId: ctx.actor.telegramUserId,
          details: { administrators: administrators.length, totalTelegramMembers },
        });
        return { refreshedAdministrators: administrators.length, totalTelegramMembers };
      } catch (error) {
        console.error("[Kronos Guard] Telegram administrator refresh failed", { groupId: input.groupId, error: error instanceof Error ? error.message : "unknown" });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Telegram could not refresh this group’s administrator list" });
      }
    }),
    setKronosRole: dashboardProcedure.input(z.object({ groupId: z.number().int().positive(), targetTelegramId: z.number().int().positive(), role: z.enum(["kronos_owner", "moderator", "vip", "user"]) })).mutation(async ({ input, ctx }) => {
      const actorAccess = await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "group_admin");
      if (!mayDelegateKronosRole({ actorAccess, actorIsSoleBotOwner: ctx.actor.telegramUserId === OWNER_TELEGRAM_ID, role: input.role })) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Your Kronos role policy does not permit this delegation" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [memberRows, groupRows, targetUserRows, targetRoles] = await Promise.all([
        db.select({ id: groupMembers.id, telegramRole: groupMembers.telegramRole }).from(groupMembers).where(and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.telegramUserId, input.targetTelegramId))).limit(1),
        db.select({ chatId: telegramGroups.chatId }).from(telegramGroups).where(eq(telegramGroups.id, input.groupId)).limit(1),
        db.select({ firstName: telegramUsers.firstName, lastName: telegramUsers.lastName, username: telegramUsers.username }).from(telegramUsers).where(eq(telegramUsers.telegramUserId, input.targetTelegramId)).limit(1),
        db.select({ role: groupRoles.role }).from(groupRoles).where(and(eq(groupRoles.groupId, input.groupId), eq(groupRoles.telegramUserId, input.targetTelegramId))),
      ]);
      const member = memberRows[0];
      const group = groupRows[0];
      const targetUser = targetUserRows[0];
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Known group member not found" });
      if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      if (hasSameOrHigherKronosRole(targetRoles, input.role)) {
        await writeAuditLog({ category: "dashboard_member_roles", event: "role_unchanged", groupId: input.groupId, actorTelegramId: ctx.actor.telegramUserId, subjectTelegramId: input.targetTelegramId, details: { requestedRole: input.role, currentRoles: targetRoles.map(role => role.role) } });
        return { success: false, unchanged: true, announced: false };
      }
      const bot = getTelegramBot();
      if (input.role === "kronos_owner") {
        await db.insert(groupRoles).values({ groupId: input.groupId, telegramUserId: input.targetTelegramId, role: input.role, grantedByTelegramId: ctx.actor.telegramUserId }).onDuplicateKeyUpdate({ set: { grantedByTelegramId: ctx.actor.telegramUserId } });
      } else if (input.role === "user") {
        if (targetRoles.some(role => role.role === "kronos_owner") && ctx.actor.telegramUserId !== OWNER_TELEGRAM_ID) throw new TRPCError({ code: "FORBIDDEN", message: "A protected Kronos owner role may only be changed by the sole bot owner" });
        await db.delete(groupRoles).where(and(eq(groupRoles.groupId, input.groupId), eq(groupRoles.telegramUserId, input.targetTelegramId), inArray(groupRoles.role, ["kronos_owner", "moderator", "vip"])));
      } else {
        if (targetRoles.some(role => role.role === "kronos_owner") && ctx.actor.telegramUserId !== OWNER_TELEGRAM_ID) throw new TRPCError({ code: "FORBIDDEN", message: "A protected Kronos owner role may only be changed by the sole bot owner" });
        await db.insert(groupRoles).values({ groupId: input.groupId, telegramUserId: input.targetTelegramId, role: input.role, grantedByTelegramId: ctx.actor.telegramUserId }).onDuplicateKeyUpdate({ set: { grantedByTelegramId: ctx.actor.telegramUserId } });
      }
      const displayName = [targetUser?.firstName, targetUser?.lastName].filter(Boolean).join(" ") || targetUser?.username || String(input.targetTelegramId);
      const actorDisplayName = ctx.actor.firstName || ctx.actor.username || String(ctx.actor.telegramUserId);
      let announced = false;
      if (bot) try {
        await bot.telegram.sendMessage(group.chatId, dashboardRoleChangeMessage({ telegramUserId: input.targetTelegramId, displayName, actorTelegramId: ctx.actor.telegramUserId, actorDisplayName, role: input.role }), { parse_mode: "HTML" });
        announced = true;
      } catch (error) { console.error("[Kronos Guard] Kronos-role announcement failed", { groupId: input.groupId, targetTelegramId: input.targetTelegramId, error: error instanceof Error ? error.message : "unknown" }); }
      await writeAuditLog({ category: "dashboard_member_roles", event: `set_${input.role}`, groupId: input.groupId, actorTelegramId: ctx.actor.telegramUserId, subjectTelegramId: input.targetTelegramId, details: { announced } });
      await createUserNotification({ telegramUserId: input.targetTelegramId, eventType: "role_changed", title: "تغییر مقام کاربر", body: dashboardRoleChangeMessage({ telegramUserId: input.targetTelegramId, displayName, actorTelegramId: ctx.actor.telegramUserId, actorDisplayName, role: input.role }), relatedGroupId: input.groupId, relatedRole: input.role }).catch(error => console.warn("[Kronos Guard] user role notification failed", error));
      return { success: true, unchanged: false, announced };
    }),
    setTelegramRole: dashboardProcedure.input(z.object({ groupId: z.number().int().positive(), targetTelegramId: z.number().int().positive(), role: z.enum(["telegram_admin", "telegram_member"]) })).mutation(async ({ input, ctx }) => {
      const access = await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "group_admin");
      if (ctx.actor.telegramUserId !== OWNER_TELEGRAM_ID && access !== "group_owner") throw new TRPCError({ code: "FORBIDDEN", message: "Only the Telegram group owner or the Kronos Guard owner may change Telegram-native administrator roles" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [memberRows, groupRows, targetUserRows] = await Promise.all([
        db.select({ telegramRole: groupMembers.telegramRole }).from(groupMembers).where(and(eq(groupMembers.groupId, input.groupId), eq(groupMembers.telegramUserId, input.targetTelegramId))).limit(1),
        db.select({ chatId: telegramGroups.chatId }).from(telegramGroups).where(eq(telegramGroups.id, input.groupId)).limit(1),
        db.select({ firstName: telegramUsers.firstName, lastName: telegramUsers.lastName, username: telegramUsers.username }).from(telegramUsers).where(eq(telegramUsers.telegramUserId, input.targetTelegramId)).limit(1),
      ]);
      const member = memberRows[0]; const group = groupRows[0]; const targetUser = targetUserRows[0];
      if (!member) throw new TRPCError({ code: "NOT_FOUND", message: "Known group member not found" });
      if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      if (member.telegramRole === "owner") throw new TRPCError({ code: "FORBIDDEN", message: "The Telegram group owner role cannot be changed" });
      const bot = getTelegramBot();
      if (!bot) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Telegram bot connection is not ready" });
      try {
        await bot.telegram.promoteChatMember(group.chatId, input.targetTelegramId, input.role === "telegram_admin" ? telegramAdministratorPermissions : noTelegramAdministratorPermissions);
        await recordKnownGroupMember({ groupId: input.groupId, telegramUserId: input.targetTelegramId, status: "active", telegramRole: input.role === "telegram_admin" ? "administrator" : "member" });
      } catch (error) {
        console.error("[Kronos Guard] Telegram role update failed", { groupId: input.groupId, targetTelegramId: input.targetTelegramId, error: error instanceof Error ? error.message : "unknown" });
        throw new TRPCError({ code: "BAD_REQUEST", message: "Telegram could not change this role. The bot must be a group administrator with permission to promote administrators." });
      }
      const displayName = [targetUser?.firstName, targetUser?.lastName].filter(Boolean).join(" ") || targetUser?.username || String(input.targetTelegramId);
      const actorDisplayName = ctx.actor.firstName || ctx.actor.username || String(ctx.actor.telegramUserId);
      await bot.telegram.sendMessage(group.chatId, dashboardRoleChangeMessage({ telegramUserId: input.targetTelegramId, displayName, actorTelegramId: ctx.actor.telegramUserId, actorDisplayName, role: input.role }), { parse_mode: "HTML" });
      await writeAuditLog({ category: "dashboard_member_roles", event: `set_${input.role}`, groupId: input.groupId, actorTelegramId: ctx.actor.telegramUserId, subjectTelegramId: input.targetTelegramId, details: { announced: true, telegramNative: true } });
      await createUserNotification({ telegramUserId: input.targetTelegramId, eventType: "telegram_role_changed", title: "تغییر مقام تلگرام", body: dashboardRoleChangeMessage({ telegramUserId: input.targetTelegramId, displayName, actorTelegramId: ctx.actor.telegramUserId, actorDisplayName, role: input.role }), relatedGroupId: input.groupId, relatedRole: input.role }).catch(error => console.warn("[Kronos Guard] user Telegram-role notification failed", error));
      return { success: true, unchanged: false, announced: true };
    }),
  }),
  moderation: router({
    addNote: dashboardProcedure.input(z.object({ groupId: z.number().int().positive(), targetTelegramId: z.number().int().positive(), body: z.string().trim().min(1).max(3500) })).mutation(async ({ input, ctx }) => {
      await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "moderator");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.insert(moderationNotes).values({ ...input, authorTelegramId: ctx.actor.telegramUserId });
      await writeAuditLog({ category: "dashboard_moderation", event: "note_added", groupId: input.groupId, actorTelegramId: ctx.actor.telegramUserId, subjectTelegramId: input.targetTelegramId });
      return { success: true };
    }),
    clearWarnings: dashboardProcedure.input(z.object({ groupId: z.number().int().positive(), targetTelegramId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
      await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "moderator");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.update(userWarnings).set({ count: 0, lastReason: null }).where(and(eq(userWarnings.groupId, input.groupId), eq(userWarnings.telegramUserId, input.targetTelegramId)));
      await db.insert(moderationActions).values({ groupId: input.groupId, actorTelegramId: ctx.actor.telegramUserId, targetTelegramId: input.targetTelegramId, action: "unwarn", source: "manual", reason: "Dashboard warning reset" });
      await writeAuditLog({ category: "dashboard_moderation", event: "warnings_cleared", groupId: input.groupId, actorTelegramId: ctx.actor.telegramUserId, subjectTelegramId: input.targetTelegramId });
      return { success: true };
    }),
    removeWarnings: dashboardProcedure.input(z.object({ groupId: z.number().int().positive(), targetTelegramId: z.number().int().positive(), count: z.number().int().min(1).max(100) })).mutation(async ({ input, ctx }) => {
      await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "moderator");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const existing = (await db.select({ count: userWarnings.count }).from(userWarnings).where(and(eq(userWarnings.groupId, input.groupId), eq(userWarnings.telegramUserId, input.targetTelegramId))).limit(1))[0];
      const before = existing?.count ?? 0;
      const removed = Math.min(before, input.count);
      const remaining = Math.max(0, before - input.count);
      if (existing) await db.update(userWarnings).set({ count: remaining, lastReason: remaining === 0 ? null : undefined }).where(and(eq(userWarnings.groupId, input.groupId), eq(userWarnings.telegramUserId, input.targetTelegramId)));
      await db.insert(moderationActions).values({ groupId: input.groupId, actorTelegramId: ctx.actor.telegramUserId, targetTelegramId: input.targetTelegramId, action: "unwarn", source: "manual", reason: `Dashboard removed ${removed} warning(s)` });
      await writeAuditLog({ category: "dashboard_moderation", event: "warnings_removed", groupId: input.groupId, actorTelegramId: ctx.actor.telegramUserId, subjectTelegramId: input.targetTelegramId, details: { requested: input.count, removed, remaining } });
      return { success: true, removed, remaining };
    }),
    setLock: dashboardProcedure.input(z.object({ groupId: z.number().int().positive(), lockType: z.enum(DASHBOARD_LOCK_TYPES), enabled: z.boolean(), action: z.enum(["delete", "warn", "mute"]), exemptionRole: z.enum(["none", "vip", "moderator", "admin"]) })).mutation(async ({ input, ctx }) => {
      await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "moderator");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { groupId, lockType, ...values } = input;
      await db.insert(contentLocks).values({ groupId, lockType, ...values, updatedByTelegramId: ctx.actor.telegramUserId }).onDuplicateKeyUpdate({ set: { ...values, updatedByTelegramId: ctx.actor.telegramUserId } });
      const group = (await db.select({ chatId: telegramGroups.chatId, language: telegramGroups.language }).from(telegramGroups).where(eq(telegramGroups.id, groupId)).limit(1))[0];
      let announced = false;
      const bot = getTelegramBot();
      if (group && bot) try {
        await bot.telegram.sendMessage(group.chatId, formatDashboardSettingAnnouncement({ locale: group.language, actorTelegramId: ctx.actor.telegramUserId, actorDisplayName: ctx.actor.firstName || ctx.actor.username || String(ctx.actor.telegramUserId), changes: [{ label: `قفل ${dashboardLockLabels[lockType] ?? lockType}`, enabled: input.enabled }] }), { parse_mode: "HTML" });
        announced = true;
      } catch (error) {
        console.error("[Kronos Guard] content-lock announcement failed", { groupId, lockType, error: error instanceof Error ? error.message : "unknown" });
      }
      await writeAuditLog({ category: "dashboard_moderation", event: "lock_updated", groupId, actorTelegramId: ctx.actor.telegramUserId, details: { lockType, enabled: input.enabled, announced } });
      return { success: true, announced };
    }),
    lockPolicyStatus: dashboardProcedure.input(z.object({ groupId: z.number().int().positive() })).query(async ({ input, ctx }) => {
      await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "moderator");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const snapshot = (await db.select({ profileKey: lockPolicySnapshots.profileKey, createdAt: lockPolicySnapshots.createdAt }).from(lockPolicySnapshots).where(eq(lockPolicySnapshots.groupId, input.groupId)).limit(1))[0];
      return { canRestore: Boolean(snapshot), profileKey: snapshot?.profileKey ?? null, snapshotCreatedAt: snapshot?.createdAt ?? null };
    }),
    applyLockPolicy: dashboardProcedure.input(z.object({ groupId: z.number().int().positive(), profileKey: z.enum(["open", "media_shield", "strict_guard"]) })).mutation(async ({ input, ctx }) => {
      await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "moderator");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const existingLocks = await db.select({ lockType: contentLocks.lockType, enabled: contentLocks.enabled, action: contentLocks.action, exemptionRole: contentLocks.exemptionRole }).from(contentLocks).where(eq(contentLocks.groupId, input.groupId));
      const snapshot = completeLockPolicySnapshot(existingLocks);
      const selectedLocks = new Set(DASHBOARD_LOCK_POLICIES[input.profileKey]);
      const targetLocks: LockPolicyState[] = snapshot.map(lock => ({ ...lock, enabled: selectedLocks.has(lock.lockType), action: "delete", exemptionRole: "vip" }));
      await db.transaction(async tx => {
        await tx.insert(lockPolicySnapshots).values({ groupId: input.groupId, profileKey: input.profileKey, snapshot, createdByTelegramId: ctx.actor.telegramUserId }).onDuplicateKeyUpdate({ set: { profileKey: input.profileKey, snapshot, createdByTelegramId: ctx.actor.telegramUserId } });
        for (const lock of targetLocks) {
          await tx.insert(contentLocks).values({ groupId: input.groupId, ...lock, updatedByTelegramId: ctx.actor.telegramUserId }).onDuplicateKeyUpdate({ set: { enabled: lock.enabled, action: lock.action, exemptionRole: lock.exemptionRole, updatedByTelegramId: ctx.actor.telegramUserId } });
        }
      });
      await db.insert(moderationActions).values({ groupId: input.groupId, actorTelegramId: ctx.actor.telegramUserId, action: "lock", source: "manual", reason: `Dashboard lock policy applied: ${input.profileKey}`, metadata: { profileKey: input.profileKey, affectedLocks: targetLocks.filter(lock => lock.enabled).map(lock => lock.lockType) } });
      await writeAuditLog({ category: "dashboard_moderation", event: "lock_policy_applied", groupId: input.groupId, actorTelegramId: ctx.actor.telegramUserId, details: { profileKey: input.profileKey, affectedLocks: targetLocks.filter(lock => lock.enabled).map(lock => lock.lockType) } });
      return { success: true, profileKey: input.profileKey, activeLockCount: targetLocks.filter(lock => lock.enabled).length };
    }),
    restoreLockPolicy: dashboardProcedure.input(z.object({ groupId: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
      await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "moderator");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const savedSnapshot = (await db.select({ snapshot: lockPolicySnapshots.snapshot, profileKey: lockPolicySnapshots.profileKey }).from(lockPolicySnapshots).where(eq(lockPolicySnapshots.groupId, input.groupId)).limit(1))[0];
      const snapshot = Array.isArray(savedSnapshot?.snapshot) ? savedSnapshot.snapshot as LockPolicyState[] : [];
      const isValidSnapshot = snapshot.length === DASHBOARD_LOCK_TYPES.length && snapshot.every(lock => DASHBOARD_LOCK_TYPES.includes(lock.lockType) && typeof lock.enabled === "boolean" && ["delete", "warn", "mute"].includes(lock.action) && ["none", "vip", "moderator", "admin"].includes(lock.exemptionRole));
      if (!savedSnapshot || !isValidSnapshot) throw new TRPCError({ code: "BAD_REQUEST", message: "No safe lock-policy rollback point is available." });
      await db.transaction(async tx => {
        for (const lock of snapshot) {
          await tx.insert(contentLocks).values({ groupId: input.groupId, ...lock, updatedByTelegramId: ctx.actor.telegramUserId }).onDuplicateKeyUpdate({ set: { enabled: lock.enabled, action: lock.action, exemptionRole: lock.exemptionRole, updatedByTelegramId: ctx.actor.telegramUserId } });
        }
        await tx.delete(lockPolicySnapshots).where(eq(lockPolicySnapshots.groupId, input.groupId));
      });
      await db.insert(moderationActions).values({ groupId: input.groupId, actorTelegramId: ctx.actor.telegramUserId, action: "unlock", source: "manual", reason: `Dashboard lock policy restored: ${savedSnapshot.profileKey}`, metadata: { profileKey: savedSnapshot.profileKey } });
      await writeAuditLog({ category: "dashboard_moderation", event: "lock_policy_restored", groupId: input.groupId, actorTelegramId: ctx.actor.telegramUserId, details: { profileKey: savedSnapshot.profileKey } });
      return { success: true, profileKey: savedSnapshot.profileKey };
    }),
  }),
  marketplace: router({
    pricing: dashboardProcedure.query(async () => {
      const db = await getDb();
      if (!db) return { starsPerDay: STARS_PER_DAY, maxActiveChannels: 3, activeChannels: 0, availableSlots: 3, isFull: false };
      const settings = (await db.select({ starsPerDay: marketplacePaymentSettings.starsPerDay }).from(marketplacePaymentSettings).limit(1))[0];
      const capacity = await getMarketplaceCapacity();
      return { starsPerDay: settings?.starsPerDay || STARS_PER_DAY, maxActiveChannels: capacity.maxActiveChannels, activeChannels: capacity.activeChannels, availableSlots: capacity.availableSlots, isFull: capacity.isFull };
    }),
    resolveChannel: dashboardProcedure.input(z.object({ reference: z.string().trim().min(3).max(256) })).query(async ({ input, ctx }) => {
      const bot = getTelegramBot();
      if (!bot) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Telegram bot is unavailable" });
      const normalized = input.reference
        .replace(/^https?:\/\/t\.me\//i, "")
        .replace(/^@/, "")
        .replace(/^joinchat\//i, "")
        .split(/[/?#]/)[0]
        .trim();
      const chatReference = /^-?\d+$/.test(normalized) ? Number(normalized) : `@${normalized}`;
      if (typeof chatReference === "number" && !Number.isSafeInteger(chatReference)) throw new TRPCError({ code: "BAD_REQUEST", message: "Channel ID is invalid" });
      try {
        const [channel, payerMembership, botIdentity] = await Promise.all([
          bot.telegram.getChat(chatReference),
          bot.telegram.getChatMember(chatReference, ctx.actor.telegramUserId),
          bot.telegram.getMe(),
        ]);
        const resolvedChannel = channel as { id: number; type: string; title?: string; username?: string };
        if (resolvedChannel.type !== "channel") throw new Error("The requested target is not a channel");
        if (!["creator", "owner", "administrator"].includes(payerMembership.status)) throw new Error("You must administer this channel");
        const botMembership = await bot.telegram.getChatMember(resolvedChannel.id, botIdentity.id);
        if (!["creator", "owner", "administrator"].includes(botMembership.status)) throw new Error("Add Kronos Guard as a channel administrator first");
        return { channelChatId: resolvedChannel.id, title: resolvedChannel.title ?? String(resolvedChannel.id), username: resolvedChannel.username ?? null, readyForPayment: true };
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Channel could not be verified" });
      }
    }),
    createStarsInvoice: dashboardProcedure.input(z.object({ channelChatId: z.number().int().safe(), days: z.number().int().min(1).max(365) })).mutation(async ({ input, ctx }) => {
      try {
        return await createStarsInvoiceLinkForDashboard({ payerTelegramId: ctx.actor.telegramUserId, channelChatId: input.channelChatId, days: input.days });
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Could not prepare the Stars invoice" });
      }
    }),
    resolveCustomInvoiceTarget: ownerProcedure.input(z.object({ reference: z.string().trim().min(2).max(256) })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const normalized = input.reference.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "").split(/[/?#]/)[0].trim();
      const numeric = /^-?\d+$/.test(normalized) ? Number(normalized) : null;
      const target = numeric !== null && Number.isSafeInteger(numeric)
        ? (await db.select({ telegramUserId: telegramUsers.telegramUserId, username: telegramUsers.username, firstName: telegramUsers.firstName, startedBotAt: telegramUsers.startedBotAt }).from(telegramUsers).where(eq(telegramUsers.telegramUserId, numeric)).limit(1))[0]
        : (await db.select({ telegramUserId: telegramUsers.telegramUserId, username: telegramUsers.username, firstName: telegramUsers.firstName, startedBotAt: telegramUsers.startedBotAt }).from(telegramUsers).where(sql`lower(${telegramUsers.username}) = ${normalized.toLowerCase()}`).limit(1))[0];
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "این کاربر در پایگاه دادهٔ Kronos Guard پیدا نشد؛ ابتدا ربات را در گفت‌وگوی خصوصی Start کند." });
      if (!target.startedBotAt) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "کاربر باید ابتدا ربات Kronos Guard را در گفت‌وگوی خصوصی Start کند." });
      return { telegramUserId: target.telegramUserId, username: target.username ?? null, firstName: target.firstName ?? null, readyForInvoice: true };
    }),
    resolveCustomInvoiceChannel: ownerProcedure.input(z.object({ reference: z.string().trim().min(3).max(256), destinationMode: z.enum(["public", "private"]).default("public") })).query(async ({ input }) => {
      const bot = getTelegramBot();
      if (!bot) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Telegram bot is unavailable" });
      const rawReference = input.reference.trim();
      if (input.destinationMode === "private" && !/^-100\d+$/.test(rawReference)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "در حالت خصوصی فقط شناسهٔ عددی کانال یا گروه با قالب ‎-100...‎ مجاز است." });
      }
      const inviteMatch = rawReference.match(/^https?:\/\/t\.me\/(?:\+|joinchat\/)/i);
      if (inviteMatch) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "لینک دعوت خصوصی کانال قابل تبدیل خودکار نیست؛ لینک عمومی t.me/نام‌کاربری، شناسهٔ عددی -100... یا username عمومی کانال را وارد کنید." });
      }
      const normalized = rawReference.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "").split(/[/?#]/)[0].trim();
      const chatReference = /^-?\d+$/.test(normalized) ? Number(normalized) : `@${normalized}`;
      try {
        const [channel, botIdentity] = await Promise.all([bot.telegram.getChat(chatReference), bot.telegram.getMe()]);
        if (!(["channel", "supergroup", "group"] as const).includes(channel.type as "channel" | "supergroup" | "group")) throw new Error("مقصد واردشده کانال یا گروه تلگرام نیست");
        const botMembership = await bot.telegram.getChatMember(channel.id, botIdentity.id);
        if (!["creator", "owner", "administrator"].includes(botMembership.status)) throw new Error("ابتدا Kronos Guard را در کانال ادمین کنید");
        const resolved = channel as { id: number; title?: string; username?: string };
        return { channelChatId: resolved.id, title: resolved.title ?? String(resolved.id), username: resolved.username ?? null, readyForInvoice: true };
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "کانال یا گروه قابل تأیید نیست" });
      }
    }),
    sendCustomInvoice: ownerProcedure.input(z.object({ targetReference: z.string().trim().min(2).max(128), targetTelegramId: z.number().int().safe().positive().optional(), channelChatId: z.number().int().safe(), destinationMode: z.enum(["public", "private"]).default("public"), days: z.number().int().min(1).max(365), amountStars: z.number().int().min(1).max(1_000_000), expiresInHours: z.number().int().min(1).max(168) })).mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      if (input.destinationMode === "private" && !/^-100\d+$/.test(input.targetReference.trim()) && !String(input.channelChatId).startsWith("-100")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "در حالت خصوصی مقصد باید فقط با شناسهٔ عددی -100... ثبت شود." });
      }
      const normalizedReference = input.targetReference.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "").split(/[/?#]/)[0].trim();
      const numericTarget = input.targetTelegramId ?? (/^\d+$/.test(normalizedReference) ? Number(normalizedReference) : null);
      const target = numericTarget && Number.isSafeInteger(numericTarget)
        ? (await db.select({ telegramUserId: telegramUsers.telegramUserId, startedBotAt: telegramUsers.startedBotAt }).from(telegramUsers).where(eq(telegramUsers.telegramUserId, numericTarget)).limit(1))[0]
        : (await db.select({ telegramUserId: telegramUsers.telegramUserId, startedBotAt: telegramUsers.startedBotAt }).from(telegramUsers).where(sql`lower(${telegramUsers.username}) = ${normalizedReference.toLowerCase()}`).limit(1))[0];
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Target user is not known to Kronos Guard" });
      if (!target.startedBotAt) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The target user must start Kronos Guard before receiving an invoice" });
      try {
        return await sendCustomStarsInvoice({ ownerTelegramId: ctx.actor.telegramUserId, targetTelegramId: target.telegramUserId, channelChatId: input.channelChatId, amountStars: input.amountStars, days: input.days, expiresInHours: input.expiresInHours });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Custom Stars invoice could not be sent";
        const normalizedMessage = message.toLowerCase();
        if (normalizedMessage.includes("chat not found") || normalizedMessage.includes("user is deactivated") || normalizedMessage.includes("bot can't initiate") || normalizedMessage.includes("bot cannot initiate")) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "کاربر باید ابتدا ربات Kronos Guard را در گفت‌وگوی خصوصی Start کند و ربات را مسدود نکرده باشد." });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
    }),
    myOrders: dashboardProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const [orders, listings] = await Promise.all([
        db.select().from(paymentOrders).where(eq(paymentOrders.payerTelegramId, ctx.actor.telegramUserId)).orderBy(desc(paymentOrders.createdAt)).limit(50),
        db.select().from(channelListings).where(eq(channelListings.ownerTelegramId, ctx.actor.telegramUserId)).orderBy(desc(channelListings.createdAt)).limit(50),
      ]);
      return orders.map(order => ({ ...order, listing: listings.find(listing => listing.id === order.listingId) ?? null }));
    }),
    settings: ownerProcedure.query(async () => {
      const db = await getDb();
      return db ? (await db.select().from(marketplacePaymentSettings).limit(1))[0] ?? null : null;
    }),
    saveSettings: ownerProcedure.input(z.object({ starsPerDay: z.number().int().min(1).max(100000) })).mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const values = { ...input, updatedByTelegramId: OWNER_TELEGRAM_ID };
      const current = (await db.select({ id: marketplacePaymentSettings.id }).from(marketplacePaymentSettings).limit(1))[0];
      if (current) await db.update(marketplacePaymentSettings).set(values).where(eq(marketplacePaymentSettings.id, current.id));
      else await db.insert(marketplacePaymentSettings).values(values);
      return { success: true };
    }),
    starsMarketRate: ownerProcedure.query(async () => {
      try {
        return await getStarsReferenceMarketData();
      } catch (error) {
        console.warn("[Kronos Guard] Stars market rate fetch failed", error instanceof Error ? error.message : "unknown");
        return null;
      }
    }),
    payments: ownerProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const [orders, receipts, listings] = await Promise.all([db.select().from(paymentOrders).orderBy(desc(paymentOrders.createdAt)).limit(100), db.select().from(paymentReceipts).where(isNull(paymentReceipts.deletedAt)), db.select().from(channelListings)]);
      return orders.map(order => ({ ...order, receipt: receipts.find(receipt => receipt.paymentOrderId === order.id) ?? null, listing: listings.find(listing => listing.id === order.listingId) ?? null }));
    }),
    paymentSummary: ownerProcedure.query(async () => {
      const db = await getDb();
      if (!db) return { maxActiveChannels: 3, activeChannels: 0, availableSlots: 3, isFull: false, awaitingReview: 0, expiringSoon: 0 };
      const [capacity, reviewOrders, listings] = await Promise.all([
        getMarketplaceCapacity(),
        db.select({ id: paymentOrders.id }).from(paymentOrders).where(inArray(paymentOrders.status, ["pending_approval", "receipt_submitted"])),
        db.select({ expiresAt: channelListings.expiresAt }).from(channelListings).where(eq(channelListings.status, "active")),
      ]);
      const soon = new Date(Date.now() + 72 * 60 * 60 * 1000);
      return { ...capacity, awaitingReview: reviewOrders.length, expiringSoon: listings.filter(listing => listing.expiresAt && listing.expiresAt <= soon).length };
    }),
    review: ownerProcedure.input(z.object({ publicId: z.string().min(4).max(48), decision: z.enum(["approve", "reject"]) })).mutation(async ({ input }) => approveManualOrderByOwner(input.publicId, OWNER_TELEGRAM_ID, input.decision)),
    receiptUrl: ownerProcedure.input(z.object({ receiptId: z.number().int().positive() })).query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const receipt = (await db.select().from(paymentReceipts).where(and(eq(paymentReceipts.id, input.receiptId), isNull(paymentReceipts.deletedAt))).limit(1))[0];
      if (!receipt) throw new TRPCError({ code: "NOT_FOUND" });
      return issueOwnerReceiptLink(receipt.storageKey, storageGetSignedUrl);
    }),
  }),
  cryptoMarket: router({
    starsReference: dashboardProcedure.query(async () => {
      try {
        return await getStarsReferenceMarketData();
      } catch (error) {
        console.warn("[Kronos Guard] Stars reference fetch failed", error instanceof Error ? error.message : "unknown");
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "نرخ مرجع Stars موقتاً در دسترس نیست؛ دوباره تلاش کنید." });
      }
    }),
    favorites: dashboardProcedure.query(async ({ ctx }) => ({ assetIds: await listCryptoMarketFavoriteIds(ctx.actor.telegramUserId) })),
    setFavorite: dashboardProcedure.input(z.object({ assetId: z.string().trim().regex(/^[a-z0-9]{1,32}$/i), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
      return setCryptoMarketFavorite(ctx.actor.telegramUserId, input.assetId, input.enabled);
    }),
    nobitexPrimaryMarkets: dashboardProcedure.input(z.object({ range: z.enum(["1d", "7d", "30d"]).default("1d") }).optional()).query(async ({ input }) => {
      try {
        return await getNobitexPrimaryMarkets(input?.range ?? "1d");
      } catch (error) {
        console.warn("[Kronos Guard] Nobitex primary markets fetch failed", error instanceof Error ? error.message : "unknown");
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "دارایی‌های اصلی با نمودار معتبر موقتاً در دسترس نیستند؛ دوباره تلاش کنید." });
      }
    }),
    nobitexFavoriteMarkets: dashboardProcedure.input(z.object({ assetIds: z.array(z.string().trim().regex(/^[a-z0-9]{1,32}$/i)).min(1).max(30), range: z.enum(["1d", "7d", "30d"]).default("1d") })).query(async ({ input }) => {
      return getNobitexAssetMarkets(input.assetIds, input.range);
    }),
    nobitexAsset: dashboardProcedure.input(z.object({ assetId: z.string().trim().regex(/^[a-z0-9]{1,32}$/i), range: z.enum(["1d", "7d", "30d"]).default("1d") })).query(async ({ input }) => {
      try {
        return await getNobitexAssetMarket(input.assetId, input.range);
      } catch (error) {
        console.warn("[Kronos Guard] Nobitex primary asset fetch failed", error instanceof Error ? error.message : "unknown");
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "دادهٔ زندهٔ بازار موقتاً در دسترس نیست؛ دوباره تلاش کنید." });
      }
    }),
    nobitexMarkets: dashboardProcedure.input(z.object({ limit: z.number().int().min(1).max(1_000).default(30) }).optional()).query(async ({ input }) => {
      try {
        return await getNobitexTopMarkets(input?.limit ?? 30);
      } catch (error) {
        console.warn("[Kronos Guard] Nobitex market list fetch failed", error instanceof Error ? error.message : "unknown");
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "فهرست بازارهای زندهٔ نوبیتکس موقتاً در دسترس نیست؛ یک دقیقهٔ دیگر دوباره تلاش کنید." });
      }
    }),
    nobitexSearch: dashboardProcedure.input(z.object({ query: z.string().trim().min(1).max(32), range: z.enum(["1d", "7d", "30d"]).default("1d") })).query(async ({ input }) => {
      try {
        return await searchNobitexMarkets(input.query, input.range);
      } catch (error) {
        console.warn("[Kronos Guard] Nobitex market search failed", error instanceof Error ? error.message : "unknown");
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "جست‌وجوی بازار موقتاً در دسترس نیست؛ دوباره تلاش کنید." });
      }
    }),
    iranMacroMarkets: dashboardProcedure.query(async () => {
      try {
        return await getIranMacroMarkets();
      } catch (error) {
        console.warn("[Kronos Guard] Iranian macro market fetch failed", error instanceof Error ? error.message : "unknown");
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "نرخ ارز و فلزات موقتاً در دسترس نیست؛ دوباره تلاش کنید." });
      }
    }),
    nobitexUsdt: dashboardProcedure.input(z.object({ range: z.enum(["1d", "7d", "30d"]).default("1d") }).optional()).query(async ({ input }) => {
      try {
        return await getNobitexUsdtMarket(input?.range ?? "1d");
      } catch (error) {
        console.warn("[Kronos Guard] Nobitex USDT market fetch failed", error instanceof Error ? error.message : "unknown");
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "دادهٔ زندهٔ نوبیتکس موقتاً در دسترس نیست؛ یک دقیقهٔ دیگر دوباره تلاش کنید." });
      }
    }),
    topAssets: dashboardProcedure.input(z.object({ limit: z.number().int().min(1).max(250).default(250) }).optional()).query(async ({ input }) => {
      try {
        return await getCryptoMarketTopAssets(input?.limit ?? 250);
      } catch (error) {
        console.warn("[Kronos Guard] crypto market list fetch failed", error instanceof Error ? error.message : "unknown");
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "دادهٔ بازار رمزارز موقتاً در دسترس نیست؛ یک دقیقهٔ دیگر دوباره تلاش کنید." });
      }
    }),
    search: dashboardProcedure.input(z.object({ query: z.string().trim().min(1).max(80) })).query(async ({ input }) => {
      try {
        return await searchCryptoMarketAssets(input.query);
      } catch (error) {
        console.warn("[Kronos Guard] crypto market search failed", error instanceof Error ? error.message : "unknown");
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "جست‌وجوی بازار رمزارز موقتاً در دسترس نیست؛ یک دقیقهٔ دیگر دوباره تلاش کنید." });
      }
    }),
    asset: dashboardProcedure.input(z.object({ assetId: z.string().trim().regex(/^[a-z0-9-]{1,128}$/i) })).query(async ({ input }) => {
      try {
        return await getCryptoMarketAsset(input.assetId);
      } catch (error) {
        console.warn("[Kronos Guard] crypto market asset fetch failed", error instanceof Error ? error.message : "unknown");
        throw new TRPCError({ code: "NOT_FOUND", message: "این رمزارز یا قیمت آن در حال حاضر در دسترس نیست." });
      }
    }),
    chart: dashboardProcedure.input(z.object({ assetId: z.string().trim().regex(/^[a-z0-9-]{1,128}$/i), range: z.enum(["1d", "7d", "30d"]).default("1d"), includeCandles: z.boolean().default(false) })).query(async ({ input }) => {
      try {
        return await getCryptoMarketChart(input.assetId, input.range, Date.now(), input.includeCandles);
      } catch (error) {
        console.warn("[Kronos Guard] crypto market chart fetch failed", error instanceof Error ? error.message : "unknown");
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "نمودار این رمزارز موقتاً در دسترس نیست؛ یک دقیقهٔ دیگر دوباره تلاش کنید." });
      }
    }),
  }),
  notifications: router({
    list: dashboardProcedure.input(z.object({ limit: z.number().int().min(1).max(100).optional(), relatedGroupId: z.number().int().positive().nullable().optional(), eventType: z.string().trim().min(1).max(120).nullable().optional() }).optional()).query(async ({ ctx, input }) => {
      const mutedCategories = await getUserNotificationMutes(ctx.actor.telegramUserId);
      const filters = { relatedGroupId: input?.relatedGroupId ?? undefined, eventType: input?.eventType ?? undefined, mutedCategories };
      const [items, unreadCount] = await Promise.all([
        listUserNotifications(ctx.actor.telegramUserId, input?.limit ?? 50, filters),
        countUnreadUserNotifications(ctx.actor.telegramUserId, filters),
      ]);
      const db = await getDb();
      const groupIds = Array.from(new Set(items.map(item => item.relatedGroupId).filter((id): id is number => typeof id === "number")));
      const groups = db && groupIds.length ? await db.select({ id: telegramGroups.id, title: telegramGroups.title, username: telegramGroups.username }).from(telegramGroups).where(inArray(telegramGroups.id, groupIds)) : [];
      const groupById = new Map(groups.map(group => [group.id, group]));
      return { items: items.map(item => ({ ...item, relatedGroup: item.relatedGroupId ? groupById.get(item.relatedGroupId) ?? null : null })), unreadCount };
    }),
    unreadCount: dashboardProcedure.query(async ({ ctx }) => ({ count: await countUnreadUserNotifications(ctx.actor.telegramUserId, { mutedCategories: await getUserNotificationMutes(ctx.actor.telegramUserId) }) })),
    markRead: dashboardProcedure.input(z.object({ notificationId: z.number().int().positive() })).mutation(async ({ ctx, input }) => ({ success: await markUserNotificationRead(ctx.actor.telegramUserId, input.notificationId) })),
    markAllRead: dashboardProcedure.mutation(async ({ ctx }) => ({ count: await markAllUserNotificationsRead(ctx.actor.telegramUserId, { mutedCategories: await getUserNotificationMutes(ctx.actor.telegramUserId) }) })),
    getMutes: dashboardProcedure.query(async ({ ctx }) => ({ mutedCategories: await getUserNotificationMutes(ctx.actor.telegramUserId) })),
    updateMutes: dashboardProcedure.input(z.object({ mutedCategories: z.array(z.enum(USER_NOTIFICATION_CATEGORIES)).max(USER_NOTIFICATION_CATEGORIES.length) })).mutation(async ({ ctx, input }) => {
      const mutedCategories = await setUserNotificationMutes(ctx.actor.telegramUserId, input.mutedCategories);
      await writeAuditLog({ category: "dashboard", event: "notification_category_mutes_updated", actorTelegramId: ctx.actor.telegramUserId, details: { mutedCategories } });
      return { mutedCategories };
    }),
    getPrivateDelivery: dashboardProcedure.query(async ({ ctx }) => ({ enabled: await getUserPrivateDelivery(ctx.actor.telegramUserId) })),
    setPrivateDelivery: dashboardProcedure.input(z.object({ enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
      const enabled = await setUserPrivateDelivery(ctx.actor.telegramUserId, input.enabled);
      await writeAuditLog({ category: "dashboard", event: "notification_private_delivery_updated", actorTelegramId: ctx.actor.telegramUserId, details: { enabled } });
      return { enabled };
    }),
    groupPreferences: dashboardProcedure.input(z.object({ groupId: z.number().int().positive() })).query(async ({ ctx, input }) => {
      await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "group_admin");
      return getGroupEventNotificationPreferences(input.groupId);
    }),
    updateGroupPreferences: dashboardProcedure.input(z.object({
      groupId: z.number().int().positive(),
      privateDeliveryEnabled: z.boolean(),
      protectionRecipientMode: z.enum(GROUP_EVENT_DELIVERY_MODES),
      protectionCooldownSeconds: z.number().int().min(15).max(3600),
      botMessageAutoDeleteDelaySeconds: z.number().int().min(60).max(86_400),
      temporarySuccessDeleteDelaySeconds: z.number().int().min(5).max(86_400),
    })).mutation(async ({ ctx, input }) => {
      await requireDashboardGroupAccess(ctx.actor.telegramUserId, input.groupId, "group_admin");
      const { groupId, ...preferences } = input;
      const saved = await updateGroupEventNotificationPreferences(groupId, preferences);
      await writeAuditLog({ category: "dashboard", event: "group_event_notification_preferences_updated", groupId, actorTelegramId: ctx.actor.telegramUserId, details: saved });
      return { success: true, preferences: saved };
    }),
  }),
  alerts: router({
    list: ownerProcedure.query(async () => {
      const db = await getDb();
      return db ? db.select().from(ownerAlerts).orderBy(desc(ownerAlerts.createdAt)).limit(100) : [];
    }),
    acknowledge: ownerProcedure.input(z.object({ alertId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const alert = (await db.select({ id: ownerAlerts.id, status: ownerAlerts.status, title: ownerAlerts.title }).from(ownerAlerts).where(eq(ownerAlerts.id, input.alertId)).limit(1))[0];
      if (!alert) throw new TRPCError({ code: "NOT_FOUND", message: "Alert was not found" });
      if (alert.status !== "acknowledged") {
        await db.update(ownerAlerts).set({ status: "acknowledged" }).where(eq(ownerAlerts.id, input.alertId));
        await writeAuditLog({ category: "owner_alert", event: "acknowledged", actorTelegramId: ctx.actor.telegramUserId, details: { alertId: alert.id, title: alert.title, previousStatus: alert.status } });
      }
      return { success: true };
    }),
    retryDelivery: ownerProcedure.input(z.object({ alertId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const bot = getTelegramBot();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      if (!bot) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Telegram bot is not ready for alert delivery" });
      const alert = (await db.select({ id: ownerAlerts.id, title: ownerAlerts.title, body: ownerAlerts.body, status: ownerAlerts.status, severity: ownerAlerts.severity }).from(ownerAlerts).where(eq(ownerAlerts.id, input.alertId)).limit(1))[0];
      if (!alert) throw new TRPCError({ code: "NOT_FOUND", message: "Alert was not found" });
      if (alert.status === "acknowledged") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Acknowledged alerts are closed and cannot be resent" });

      const attemptedAt = new Date();
      await db.update(ownerAlerts).set({ status: "pending", attempts: sql`${ownerAlerts.attempts} + 1`, lastAttemptAt: attemptedAt }).where(eq(ownerAlerts.id, alert.id));
      try {
        await withTelegramRetry(() => bot.telegram.sendMessage(OWNER_TELEGRAM_ID, `⚠️ ${alert.title}\n\n${alert.body}\n\nشناسه رخداد: ${alert.id}`));
        await db.update(ownerAlerts).set({ status: "sent", sentAt: new Date(), lastAttemptAt: new Date() }).where(eq(ownerAlerts.id, alert.id));
        await writeAuditLog({ category: "owner_alert", event: "manual_redelivery_succeeded", actorTelegramId: ctx.actor.telegramUserId, details: { alertId: alert.id, severity: alert.severity } });
        return { success: true, status: "sent" as const };
      } catch (error) {
        await db.update(ownerAlerts).set({ status: "failed", lastAttemptAt: new Date() }).where(eq(ownerAlerts.id, alert.id));
        await writeAuditLog({ severity: "warning", category: "owner_alert", event: "manual_redelivery_failed", actorTelegramId: ctx.actor.telegramUserId, details: { alertId: alert.id, error: error instanceof Error ? error.message : "unknown" } });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Alert delivery failed" });
      }
    }),
  }),
  audit: ownerProcedure.query(async () => {
    const db = await getDb();
    return db ? db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(150) : [];
  }),
  runtimeLogs: ownerProcedure.input(z.object({ limit: z.number().int().min(20).max(300).default(180) }).optional()).query(async ({ input }) => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select({ id: auditLogs.id, severity: auditLogs.severity, event: auditLogs.event, details: auditLogs.details, createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .where(eq(auditLogs.category, "runtime_console"))
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(input?.limit ?? 180);
    return rows.reverse();
  }),
  maintenance: router({
    reconcileStaleGroups: ownerProcedure.mutation(async ({ ctx }) => {
      const db = await getDb();
      const bot = getTelegramBot();
      if (!db || !bot) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Telegram bot is not ready for group reconciliation" });

      const botIdentity = await bot.telegram.getMe();
      const activeGroups = await db.select({ id: telegramGroups.id, chatId: telegramGroups.chatId, title: telegramGroups.title }).from(telegramGroups).where(eq(telegramGroups.status, "active"));
      const result = { checked: activeGroups.length, removed: 0, permissionLost: 0, unchanged: 0, errors: 0 };

      for (const group of activeGroups) {
        try {
          const membership = await bot.telegram.getChatMember(group.chatId, botIdentity.id);
          if (membership.status === "left" || membership.status === "kicked") {
            await db.update(telegramGroups).set({ status: "removed" }).where(eq(telegramGroups.id, group.id));
            result.removed += 1;
          } else if (membership.status !== "administrator" && membership.status !== "creator") {
            await db.update(telegramGroups).set({ status: "permission_lost" }).where(eq(telegramGroups.id, group.id));
            result.permissionLost += 1;
          } else {
            result.unchanged += 1;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown Telegram error";
          if (/chat not found|bot was kicked|participant_id_invalid|user not found|forbidden/i.test(message)) {
            await db.update(telegramGroups).set({ status: "removed" }).where(eq(telegramGroups.id, group.id));
            result.removed += 1;
          } else {
            console.warn("[Kronos Guard] stale group reconciliation skipped after Telegram error", { groupId: group.id, error: message });
            result.errors += 1;
          }
        }
      }

      await writeAuditLog({ category: "owner_maintenance", event: "stale_groups_reconciled", actorTelegramId: ctx.actor.telegramUserId, details: result });
      return result;
    }),
    resetDatabase: ownerProcedure.input(z.object({ confirmation: z.literal(DATABASE_RESET_CONFIRMATION) })).mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      await db.transaction(async tx => {
        // Delete application data from dependents to parents. Deployment identities and the Heartbeat
        // schedule are deliberately retained so the project remains operable after a bot-data reset.
        await tx.delete(paymentReceipts);
        await tx.delete(paymentOrders);
        await tx.delete(channelListings);
        await tx.delete(forcedJoinSessions);
        await tx.delete(forcedJoinAcquisitions);
        await tx.delete(forcedJoinChannels);
        await tx.delete(scheduledJobs);
        await tx.delete(moderationActions);
        await tx.delete(moderationNotes);
        await tx.delete(userWarnings);
        await tx.delete(contentLocks);
        await tx.delete(filterRules);
        await tx.delete(customCommands);
        await tx.delete(groupRoles);
        await tx.delete(groupMembers);
        await tx.delete(groupSettings);
        await tx.delete(globalAdmins);
        await tx.delete(marketplacePaymentSettings);
        await tx.delete(ownerAlerts);
        await tx.delete(webhookEvents);
        await tx.delete(auditLogs);
        await tx.delete(telegramGroups);
        await tx.delete(telegramUsers);
        await tx.insert(auditLogs).values({
          severity: "critical",
          category: "owner_maintenance",
          event: "database_reset_completed",
          actorTelegramId: ctx.actor.telegramUserId,
          details: {
            confirmation: DATABASE_RESET_CONFIRMATION,
            resetScope: "all_bot_managed_database_records",
            retained: ["deployment_identity", "heartbeat_schedule", "external_receipt_blobs"],
          },
        });
      });

      return { success: true, retained: ["deployment identity", "Heartbeat schedule", "external receipt blobs"] };
    }),
  }),
});
