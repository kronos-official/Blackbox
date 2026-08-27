import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { getOwnerSiteSession } from "./auth";
import { publicProcedure, router } from "../_core/trpc";
import { auditLogs, globalBotSettings, globalBotTexts, groupRoles, groupSettings, ownerConfigRevisions, telegramGroups, telegramUsers, webhookEvents } from "../../drizzle/schema";
import { listProjectFiles, readProjectFile } from "./fileManager";
import { getTelegramBot } from "../telegram/bot";
import { writeAuditLog } from "../telegram/repository";
import { diagnosticCommands, runDiagnostic } from "./diagnostics";

const ownerOnly = publicProcedure.use(async ({ ctx, next }) => {
  const session = await getOwnerSiteSession(ctx.req);
  if (!session) throw new TRPCError({ code: "UNAUTHORIZED", message: "برای ورود به پنل، نشست مالک لازم است." });
  return next({ ctx });
});

const pageInput = z.object({
  search: z.string().trim().max(128).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(100).default(25),
});

function normalizeSearch(value?: string) {
  const search = value?.trim();
  return search ? `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%` : undefined;
}

export const ownerSiteRouter = router({
  session: ownerOnly.query(async ({ ctx }) => ({
    username: (await getOwnerSiteSession(ctx.req))?.username ?? null,
    role: "owner" as const,
  })),
  overview: ownerOnly.query(async () => {
    const db = await getDb();
    if (!db) return { users: 0, startedUsers: 0, groups: 0, activeGroups: 0, roles: 0, webhookEvents24h: 0, failedWebhookEvents24h: 0 };
    const [users, startedUsers, groups, activeGroups, roles, webhookEvents24h, failedWebhookEvents24h] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(telegramUsers),
      db.select({ count: sql<number>`count(*)` }).from(telegramUsers).where(sql`${telegramUsers.startedBotAt} is not null`),
      db.select({ count: sql<number>`count(*)` }).from(telegramGroups),
      db.select({ count: sql<number>`count(*)` }).from(telegramGroups).where(eq(telegramGroups.status, "active")),
      db.select({ count: sql<number>`count(*)` }).from(groupRoles),
      db.select({ count: sql<number>`count(*)` }).from(webhookEvents).where(sql`${webhookEvents.receivedAt} >= now() - interval 24 hour`),
      db.select({ count: sql<number>`count(*)` }).from(webhookEvents).where(and(sql`${webhookEvents.receivedAt} >= now() - interval 24 hour`, eq(webhookEvents.status, "failed"))),
    ]);
    return {
      users: Number(users[0]?.count ?? 0),
      startedUsers: Number(startedUsers[0]?.count ?? 0),
      groups: Number(groups[0]?.count ?? 0),
      activeGroups: Number(activeGroups[0]?.count ?? 0),
      roles: Number(roles[0]?.count ?? 0),
      webhookEvents24h: Number(webhookEvents24h[0]?.count ?? 0),
      failedWebhookEvents24h: Number(failedWebhookEvents24h[0]?.count ?? 0),
    };
  }),
  users: ownerOnly.input(pageInput).query(async ({ input }) => {
    const db = await getDb();
    if (!db) return { rows: [], total: 0, page: input.page, pageSize: input.pageSize };
    const pattern = normalizeSearch(input.search);
    const startedOnly = sql`${telegramUsers.startedBotAt} is not null`;
    const where = pattern ? and(startedOnly, sql`(${telegramUsers.username} like ${pattern} or ${telegramUsers.firstName} like ${pattern} or cast(${telegramUsers.telegramUserId} as char) like ${pattern})`) : startedOnly;
    const [rows, countRows] = await Promise.all([
      db.select().from(telegramUsers).where(where).orderBy(desc(telegramUsers.updatedAt)).limit(input.pageSize).offset((input.page - 1) * input.pageSize),
      db.select({ count: sql<number>`count(*)` }).from(telegramUsers).where(where),
    ]);
    return { rows, total: Number(countRows[0]?.count ?? 0), page: input.page, pageSize: input.pageSize };
  }),
  groups: ownerOnly.input(pageInput).query(async ({ input }) => {
    const db = await getDb();
    if (!db) return { rows: [], total: 0, page: input.page, pageSize: input.pageSize };
    const pattern = normalizeSearch(input.search);
    const where = pattern ? sql`(${telegramGroups.title} like ${pattern} or ${telegramGroups.username} like ${pattern} or cast(${telegramGroups.chatId} as char) like ${pattern})` : undefined;
    const [rows, countRows] = await Promise.all([
      db.select().from(telegramGroups).where(where).orderBy(desc(telegramGroups.updatedAt)).limit(input.pageSize).offset((input.page - 1) * input.pageSize),
      db.select({ count: sql<number>`count(*)` }).from(telegramGroups).where(where),
    ]);
    return { rows, total: Number(countRows[0]?.count ?? 0), page: input.page, pageSize: input.pageSize };
  }),
  logs: ownerOnly.input(z.object({ limit: z.number().int().min(20).max(500).default(250), search: z.string().trim().max(128).optional() }).optional()).query(async ({ input }) => {
    const db = await getDb();
    if (!db) return [];
    const pattern = normalizeSearch(input?.search);
    const where = pattern ? and(eq(auditLogs.category, "runtime_console"), sql`cast(${auditLogs.details} as char) like ${pattern}`) : eq(auditLogs.category, "runtime_console");
    const rows = await db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(input?.limit ?? 250);
    return rows.reverse();
  }),
  audit: ownerOnly.input(z.object({ limit: z.number().int().min(20).max(500).default(250) }).optional()).query(async ({ input }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(input?.limit ?? 250);
  }),
  settings: ownerOnly.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select({ group: telegramGroups, settings: groupSettings }).from(telegramGroups).leftJoin(groupSettings, eq(groupSettings.groupId, telegramGroups.id)).orderBy(desc(telegramGroups.updatedAt));
  }),
  updateSettings: ownerOnly.input(z.object({
    groupId: z.number().int().positive(), welcomeEnabled: z.boolean(), welcomeMessage: z.string().max(3500).nullable(), goodbyeEnabled: z.boolean(), goodbyeMessage: z.string().max(3500).nullable(), antiSpamEnabled: z.boolean(), antiRaidEnabled: z.boolean(), marketCommandsEnabled: z.boolean(), floodMessageLimit: z.number().int().min(2).max(50), floodWindowSeconds: z.number().int().min(3).max(300), duplicateMessageLimit: z.number().int().min(2).max(20), warnLimit: z.number().int().min(1).max(20), warnAction: z.enum(["mute", "ban"]), warnMuteMinutes: z.number().int().min(0).max(525600), rulesText: z.string().max(3500).nullable(),
  })).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "پایگاه‌داده در دسترس نیست." });
    const { groupId, ...settings } = input;
    const group = await db.select({ id: telegramGroups.id }).from(telegramGroups).where(eq(telegramGroups.id, groupId)).limit(1);
    if (!group[0]) throw new TRPCError({ code: "NOT_FOUND", message: "گروه پیدا نشد." });
    await db.insert(groupSettings).values({ groupId, ...settings }).onDuplicateKeyUpdate({ set: settings });
    await writeAuditLog({ category: "owner_site", event: "group_settings_updated", groupId, details: { fields: Object.keys(settings) } });
    return { success: true };
  }),
  globalSettings: ownerOnly.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(globalBotSettings).orderBy(globalBotSettings.settingKey);
  }),
  updateGlobalSetting: ownerOnly.input(z.object({
    settingKey: z.string().trim().min(1).max(128),
    settingValue: z.string().max(10000),
    valueType: z.enum(["string", "number", "boolean", "json"]),
  })).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "پایگاه‌داده در دسترس نیست." });
    if (input.valueType === "number" && !Number.isFinite(Number(input.settingValue))) throw new TRPCError({ code: "BAD_REQUEST", message: "مقدار عددی معتبر نیست." });
    if (input.valueType === "boolean" && !["true", "false", "0", "1"].includes(input.settingValue.toLowerCase())) throw new TRPCError({ code: "BAD_REQUEST", message: "مقدار منطقی باید true یا false باشد." });
    if (input.valueType === "json") { try { JSON.parse(input.settingValue); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "JSON معتبر نیست." }); } }
    const ownerId = Number(process.env.OWNER_TELEGRAM_ID ?? 0);
    await db.insert(globalBotSettings).values({ ...input, updatedByTelegramId: ownerId }).onDuplicateKeyUpdate({ set: { settingValue: input.settingValue, valueType: input.valueType, updatedByTelegramId: ownerId } });
    const [versionRow] = await db.select({ version: sql<number>`coalesce(max(${ownerConfigRevisions.version}), 0) + 1` }).from(ownerConfigRevisions);
    await db.insert(ownerConfigRevisions).values({ version: Number(versionRow?.version ?? 1), scope: "global", changeSummary: `تنظیم ${input.settingKey} تغییر کرد`, snapshot: { kind: "setting", ...input }, status: "published", createdByTelegramId: ownerId });
    await writeAuditLog({ category: "owner_site", event: "global_setting_updated", details: { settingKey: input.settingKey, valueType: input.valueType } });
    return { success: true };
  }),
  globalTexts: ownerOnly.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(globalBotTexts).orderBy(globalBotTexts.category, globalBotTexts.textKey);
  }),
  updateGlobalText: ownerOnly.input(z.object({ textKey: z.string().trim().min(1).max(160), category: z.string().trim().min(1).max(64), textValue: z.string().max(10000), enabled: z.boolean() })).mutation(async ({ input }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "پایگاه‌داده در دسترس نیست." });
    const ownerId = Number(process.env.OWNER_TELEGRAM_ID ?? 0);
    await db.insert(globalBotTexts).values({ ...input, enabled: input.enabled ? 1 : 0, updatedByTelegramId: ownerId }).onDuplicateKeyUpdate({ set: { category: input.category, textValue: input.textValue, enabled: input.enabled ? 1 : 0, updatedByTelegramId: ownerId } });
    const [versionRow] = await db.select({ version: sql<number>`coalesce(max(${ownerConfigRevisions.version}), 0) + 1` }).from(ownerConfigRevisions);
    await db.insert(ownerConfigRevisions).values({ version: Number(versionRow?.version ?? 1), scope: "global", changeSummary: `متن ${input.textKey} تغییر کرد`, snapshot: { kind: "text", ...input }, status: "published", createdByTelegramId: ownerId });
    await writeAuditLog({ category: "owner_site", event: "global_text_updated", details: { textKey: input.textKey, category: input.category } });
    return { success: true };
  }),
  configRevisions: ownerOnly.input(z.object({ limit: z.number().int().min(1).max(100).default(25) }).optional()).query(async ({ input }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(ownerConfigRevisions).orderBy(desc(ownerConfigRevisions.createdAt), desc(ownerConfigRevisions.id)).limit(input?.limit ?? 25);
  }),
  diagnostics: ownerOnly.query(() => diagnosticCommands),
  runDiagnostic: ownerOnly.input(z.object({ command: z.enum(["ping", "uptime", "node-version", "memory", "server-time", "disk", "process-info"]), host: z.string().trim().max(253).optional() })).mutation(async ({ input }) => {
    const result = await runDiagnostic(input.command, input.host);
    await writeAuditLog({ category: "owner_site", event: "diagnostic_command", details: { command: input.command, host: input.host ?? null, exitCode: result.exitCode } });
    return result;
  }),
  files: ownerOnly.query(async () => listProjectFiles()),
  file: ownerOnly.input(z.object({ path: z.string().min(1).max(240) })).query(async ({ input }) => readProjectFile(input.path)),
  telegramWebhook: ownerOnly.query(async () => {
    const bot = getTelegramBot();
    if (!bot) return { available: false, error: "ربات هنوز راه‌اندازی نشده است." };
    try {
      const [info, me] = await Promise.all([bot.telegram.getWebhookInfo(), bot.telegram.getMe()]);
      return { available: true, bot: { id: me.id, username: me.username ?? null }, info };
    } catch (error) {
      return { available: false, error: error instanceof Error ? error.message : "دریافت وضعیت Webhook ناموفق بود." };
    }
  }),
  webhook: ownerOnly.query(async () => {
    const db = await getDb();
    if (!db) return { received24h: 0, failed24h: 0, latest: [] };
    const latest = await db.select().from(webhookEvents).orderBy(desc(webhookEvents.receivedAt), desc(webhookEvents.id)).limit(30);
    const [received, failed] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(webhookEvents).where(sql`${webhookEvents.receivedAt} >= now() - interval 24 hour`),
      db.select({ count: sql<number>`count(*)` }).from(webhookEvents).where(and(sql`${webhookEvents.receivedAt} >= now() - interval 24 hour`, eq(webhookEvents.status, "failed"))),
    ]);
    return { received24h: Number(received[0]?.count ?? 0), failed24h: Number(failed[0]?.count ?? 0), latest };
  }),
});
