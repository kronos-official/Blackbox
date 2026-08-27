import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { Markup } from "telegraf";
import { createHeartbeatJob, updateHeartbeatJob } from "../_core/heartbeat";
import { groupMemberDailyStats, groupMembers, groupRoles, groupStatisticsReportDeliveries, groupStatisticsSchedules, groupUserDailyStats, telegramGroups, telegramUsers } from "../../drizzle/schema";
import { getDb } from "../db";
import { hasKronosModerationAccess, resolveAccessLevel } from "./authorization";
import type { AccessLevel } from "./constants";
import { findGroupByChatId } from "./repository";
import { withTelegramButtonStyle } from "./buttonStyle";
import { recordGroupAuditEvent } from "./policyAudit";

type StatsContext = {
  chat?: { id: number; type: string };
  from?: { id: number };
  message?: unknown;
  telegram: { getChatMember: (chatId: number, userId: number) => Promise<{ status: string }> };
  reply: (...args: any[]) => Promise<unknown>;
};

type StatsCallbackContext = StatsContext & {
  callbackQuery?: { data?: string };
  answerCbQuery: (text?: string, options?: { show_alert?: boolean }) => Promise<unknown>;
  editMessageText: (text: string, options?: unknown) => Promise<unknown>;
};

type ScheduleFrequency = "daily" | "weekly" | "monthly";
type StatisticsSchedule = { frequency: ScheduleFrequency; dayOfWeek: number; dayOfMonth: number; hour: number; minute: number; timezone: string; enabled: boolean };
type ActivityRow = { telegramUserId: number; messageCount: number; addedMemberCount: number; forwardedMessageCount: number; photoCount: number; videoCount: number; videoNoteCount: number; animationCount: number; documentCount: number; audioCount: number; stickerCount: number; animatedStickerCount: number; voiceCount: number; dayKey: string };
type Participant = { firstName: string | null; lastName: string | null; username: string | null };

const EN = new Intl.NumberFormat("en-US");
const number = (value: number) => EN.format(Math.max(0, Math.round(Number(value) || 0)));
const isGroup = (ctx: StatsContext) => ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const englishDigits = (value: string) => value.replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
const TELEGRAM_SYSTEM_USER_IDS = new Set([777000]);

export function isValidStatisticsParticipant(
  telegramUserId: number,
  member?: { membershipStatus: string; telegramRole: string }
) {
  return !TELEGRAM_SYSTEM_USER_IDS.has(telegramUserId) && member?.membershipStatus === "active" && member.telegramRole !== "unknown";
}

export function formatStatisticsDateTime(date = new Date()) {
  const dateLabel = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return `${englishDigits(dateLabel)} · ${time}`;
}

export function formatStatisticsDay(dayKey: string) {
  const parts = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", weekday: "long", year: "numeric", month: "long", day: "numeric" })
    .formatToParts(new Date(`${dayKey}T12:00:00.000+03:30`));
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return englishDigits(`${values.weekday} ${values.day} ${values.month} ${values.year}`);
}

function roleLabel(role: string) {
  return ({ group_owner: "مالک", kronos_owner: "مالک Kronos", group_admin: "مدیر", moderator: "ناظر", vip: "ویژه" } as Record<string, string>)[role] ?? role;
}

export const statisticsMenuText = "<b>📊 انتخاب نوع آمار</b>\n\nگزارش موردنظر را انتخاب کنید. فقط داده‌هایی نمایش داده می‌شوند که Kronos Guard واقعاً ثبت کرده است.";

export function isStatisticsAccessLevelAllowed(access: AccessLevel) {
  return hasKronosModerationAccess(access);
}

export function statisticsMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("👥 30 نفر برتر فعالیت روزانه", "stats:top-daily")],
    [Markup.button.callback("👑 فعالیت کاربران مقام‌دار", "stats:role-activity")],
    [Markup.button.callback("➕ 30 نفر برتر افزودن عضو", "stats:top-invites")],
    [Markup.button.callback("📈 آمار فعالیت هفتگی", "stats:weekly")],
    [Markup.button.callback("📊 آمار فعالیت ماهانه", "stats:monthly")],
    [Markup.button.callback("🗓 برترین‌های هر روز هفته", "stats:weekly-days")],
    [Markup.button.callback("🏆 30 نفر برتر فعالیت کل", "stats:lifetime")],
    [Markup.button.callback("⏱ تنظیم زمان‌بندی سفارشی", "stats:custom")],
    [withTelegramButtonStyle(Markup.button.callback("◀ بازگشت به آمار روزانه", "stats:daily"), "danger")],
    [withTelegramButtonStyle(Markup.button.callback("✖ بستن", "stats:close"), "danger")],
  ]);
}

export async function sendInlineStatisticsMenu(ctx: StatsContext): Promise<boolean> {
  if (!ctx.chat || !ctx.from) return false;
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) throw new Error("Group unavailable while preparing inline statistics");
  const access = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  if (!isStatisticsAccessLevelAllowed(access)) {
    await ctx.reply("این بخش فقط برای مدیران مجاز است.");
    return true;
  }
  await ctx.reply(statisticsMenuText, { parse_mode: "HTML", ...statisticsMenuKeyboard() });
  return true;
}

function dailyKeyboard() {
  return Markup.inlineKeyboard([
    [withTelegramButtonStyle(Markup.button.callback("📊 انواع دیگر آمار", "stats:menu"), "primary")],
    [withTelegramButtonStyle(Markup.button.callback("✖ بستن", "stats:close"), "danger")],
  ]);
}

function reportKeyboard() {
  return Markup.inlineKeyboard([
    [withTelegramButtonStyle(Markup.button.callback("◀ بازگشت به انتخاب آمار", "stats:menu"), "danger")],
    [withTelegramButtonStyle(Markup.button.callback("✖ بستن", "stats:close"), "danger")],
  ]);
}

export function validateStatisticsSchedule(input: Partial<StatisticsSchedule>) {
  const hour = Number(input.hour);
  const minute = Number(input.minute);
  const dayOfWeek = Number(input.dayOfWeek ?? 1);
  const dayOfMonth = Number(input.dayOfMonth ?? 1);
  const frequency = input.frequency ?? "daily";
  if (!["daily", "weekly", "monthly"].includes(frequency)) return "تناوب انتخاب‌شده معتبر نیست.";
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "ساعت باید بین 00 تا 23 باشد.";
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return "دقیقه باید بین 00 تا 59 باشد.";
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) return "روز هفته معتبر نیست.";
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return "روز ماه باید بین 1 تا 31 باشد.";
  if (!input.timezone || input.timezone.length > 64) return "منطقهٔ زمانی معتبر نیست.";
  return null;
}

function scheduleLabel(schedule: StatisticsSchedule) {
  const days = ["دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه", "یکشنبه"];
  const time = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
  const cadence = schedule.frequency === "daily" ? "روزانه" : schedule.frequency === "weekly" ? `هفتگی، ${days[schedule.dayOfWeek - 1]}` : `ماهانه، روز ${number(schedule.dayOfMonth)}`;
  return `${cadence} در ساعت ${time} (${schedule.timezone})`;
}

export function nextStatisticsRun(schedule: StatisticsSchedule, now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: schedule.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const base = new Date(now);
  base.setUTCMinutes(0, 0, 0);
  for (let hourOffset = 0; hourOffset <= 24 * 371; hourOffset += 1) {
    const probe = new Date(base.getTime() + hourOffset * 3_600_000 + schedule.minute * 60_000);
    const parts = formatter.formatToParts(probe).reduce<Record<string, string>>((acc, part) => { acc[part.type] = part.value; return acc; }, {});
    const localDate = `${parts.year}-${parts.month}-${parts.day}`;
    if (probe <= now || Number(parts.hour) !== schedule.hour || Number(parts.minute) !== schedule.minute) continue;
    if (schedule.frequency === "weekly" && weekdayNames.indexOf(parts.weekday) !== schedule.dayOfWeek - 1) continue;
    if (schedule.frequency === "monthly" && Number(parts.day) !== schedule.dayOfMonth) continue;
    return { date: localDate, hour: Number(parts.hour), minute: Number(parts.minute), timezone: schedule.timezone };
  }
  return null;
}

function scheduleKeyboard(schedule: StatisticsSchedule) {
  const enabledLabel = schedule.enabled ? "⏸ غیرفعال‌کردن ارسال خودکار" : "▶ فعال‌کردن ارسال خودکار";
  return Markup.inlineKeyboard([
    [Markup.button.callback(`روزانه ${schedule.frequency === "daily" ? "✓" : ""}`, "stats:schedule:frequency:daily"), Markup.button.callback(`هفتگی ${schedule.frequency === "weekly" ? "✓" : ""}`, "stats:schedule:frequency:weekly"), Markup.button.callback(`ماهانه ${schedule.frequency === "monthly" ? "✓" : ""}`, "stats:schedule:frequency:monthly")],
    [Markup.button.callback("ساعت 09:00", "stats:schedule:time:9:0"), Markup.button.callback("ساعت 18:00", "stats:schedule:time:18:0"), Markup.button.callback("ساعت 21:00", "stats:schedule:time:21:0")],
    [Markup.button.callback("دوشنبه", "stats:schedule:weekday:1"), Markup.button.callback("چهارشنبه", "stats:schedule:weekday:3"), Markup.button.callback("جمعه", "stats:schedule:weekday:5")],
    [Markup.button.callback("روز 1 ماه", "stats:schedule:monthday:1"), Markup.button.callback("روز 15 ماه", "stats:schedule:monthday:15"), Markup.button.callback("روز 25 ماه", "stats:schedule:monthday:25")],
    [Markup.button.callback("ایران (تهران)", "stats:schedule:tz:Asia/Tehran"), Markup.button.callback("UTC", "stats:schedule:tz:UTC")],
    [withTelegramButtonStyle(Markup.button.callback(enabledLabel, "stats:schedule:toggle"), schedule.enabled ? "danger" : "success")],
    [withTelegramButtonStyle(Markup.button.callback("🔎 پیش‌نمایش اجرای بعدی", "stats:schedule:preview"), "primary")],
    [withTelegramButtonStyle(Markup.button.callback("◀ بازگشت به انتخاب آمار", "stats:menu"), "danger")],
  ]);
}

async function readSchedule(groupId: number): Promise<StatisticsSchedule> {
  const db = await getDb();
  const row = db ? (await db.select().from(groupStatisticsSchedules).where(eq(groupStatisticsSchedules.groupId, groupId)).limit(1))[0] : undefined;
  return { frequency: (row?.frequency ?? "daily") as ScheduleFrequency, dayOfWeek: row?.dayOfWeek ?? 1, dayOfMonth: row?.dayOfMonth ?? 1, hour: row?.hour ?? 9, minute: row?.minute ?? 0, timezone: row?.timezone ?? "Asia/Tehran", enabled: row?.enabled ?? false };
}

function statisticsCron(schedule: StatisticsSchedule, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: schedule.timezone, timeZoneName: "longOffset", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).reduce<Record<string, string>>((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  const offsetMatch = (parts.timeZoneName ?? "GMT").match(/GMT([+-])(\d{2}):?(\d{2})?/);
  const offset = offsetMatch ? (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3] ?? 0)) * (offsetMatch[1] === "+" ? 1 : -1) : 0;
  const utcMinutes = schedule.hour * 60 + schedule.minute - offset;
  const utcHour = ((Math.floor(utcMinutes / 60) % 24) + 24) % 24;
  const utcMinute = ((utcMinutes % 60) + 60) % 60;
  const weekday = schedule.frequency === "weekly" ? String(schedule.dayOfWeek % 7) : "*";
  const monthDay = schedule.frequency === "monthly" ? String(schedule.dayOfMonth) : "*";
  return `0 ${utcMinute} ${utcHour} ${monthDay} * ${weekday}`;
}

async function syncStatisticsHeartbeat(groupId: number, schedule: StatisticsSchedule, currentTaskUid?: string | null) {
  const patch = { cron: statisticsCron(schedule), path: "/api/scheduled/statistics-report", method: "POST" as const, payload: { groupId }, description: `Kronos Guard statistics report for group ${groupId}`, enable: schedule.enabled };
  if (currentTaskUid) { await updateHeartbeatJob(currentTaskUid, patch, ""); return currentTaskUid; }
  const created = await createHeartbeatJob({ name: `kronos:statistics:${groupId}`, ...patch }, "");
  return created.taskUid;
}

async function saveSchedule(groupId: number, actorTelegramId: number, schedule: StatisticsSchedule) {
  const error = validateStatisticsSchedule(schedule);
  if (error) throw new Error(error);
  const db = await getDb();
  if (!db) throw new Error("اتصال پایگاه‌داده در دسترس نیست.");
  const existing = (await db.select({ taskUid: groupStatisticsSchedules.scheduleCronTaskUid }).from(groupStatisticsSchedules).where(eq(groupStatisticsSchedules.groupId, groupId)).limit(1))[0];
  const taskUid = schedule.enabled ? await syncStatisticsHeartbeat(groupId, schedule, existing?.taskUid) : existing?.taskUid;
  if (!schedule.enabled && taskUid) await updateHeartbeatJob(taskUid, { enable: false }, "");
  await db.insert(groupStatisticsSchedules).values({ groupId, createdByTelegramId: actorTelegramId, scheduleCronTaskUid: taskUid ?? null, ...schedule }).onDuplicateKeyUpdate({ set: { createdByTelegramId: actorTelegramId, scheduleCronTaskUid: taskUid ?? null, ...schedule } });
}

async function scheduleScreen(groupId: number) {
  const schedule = await readSchedule(groupId);
  return `<b>⏱ تنظیم زمان‌بندی سفارشی آمار</b>\n\nگزارش آماری گروه در زمان انتخاب‌شده آماده می‌شود.\n\nوضعیت: <b>${schedule.enabled ? "فعال" : "غیرفعال"}</b>\nبرنامهٔ فعلی: <b>${scheduleLabel(schedule)}</b>\n\nابتدا تناوب، ساعت، روز و منطقهٔ زمانی را انتخاب کنید. تغییرات بلافاصله ذخیره می‌شوند.`;
}

function tehranDayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function rangeStart(kind: string, now = new Date()) {
  const start = new Date(now);
  if (kind.startsWith("monthly")) start.setUTCDate(start.getUTCDate() - 29);
  else if (kind.startsWith("weekly")) start.setUTCDate(start.getUTCDate() - 6);
  else start.setUTCDate(start.getUTCDate() - 1);
  return start.toISOString().slice(0, 10);
}

function dayKeys(start: string, count: number) {
  const base = new Date(`${start}T12:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => { const next = new Date(base); next.setUTCDate(base.getUTCDate() + index); return next.toISOString().slice(0, 10); });
}

export function formatStatisticsRankLine(rankLabel: string, mention: string, metricLabel: string, value: string | number): string {
  return `${rankLabel} : <b>${mention}</b>\n📌 ${metricLabel}: <b>${value}</b>`;
}

export function formatStatisticsMetricLine(icon: string, label: string, value: string | number): string {
  return `${icon} ${label}: <b>${value}</b>`;
}

export function participantMention(id: number, users: Map<number, Participant>) {
  const user = users.get(id);
  const display = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || (user?.username ? `@${user.username}` : `عضو ${id}`);
  return `<a href="tg://user?id=${id}">${esc(display)}</a>`;
}

async function loadParticipants(groupId: number, ids: number[]) {
  const db = await getDb();
  if (!db || !ids.length) return new Map<number, Participant>();
  const [users, members] = await Promise.all([
    db.select({ telegramUserId: telegramUsers.telegramUserId, firstName: telegramUsers.firstName, lastName: telegramUsers.lastName, username: telegramUsers.username }).from(telegramUsers).where(inArray(telegramUsers.telegramUserId, ids)),
    db.select({ telegramUserId: groupMembers.telegramUserId, membershipStatus: groupMembers.membershipStatus, telegramRole: groupMembers.telegramRole }).from(groupMembers).where(and(eq(groupMembers.groupId, groupId), inArray(groupMembers.telegramUserId, ids))),
  ]);
  const membersById = new Map(members.map(member => [member.telegramUserId, member]));
  return new Map(users
    .filter(user => isValidStatisticsParticipant(user.telegramUserId, membersById.get(user.telegramUserId)))
    .map(user => [user.telegramUserId, { firstName: user.firstName, lastName: user.lastName, username: user.username }]));
}

function emptyReport(title: string, rangeLabel: string) {
  return `<b>📊 ${title}</b>\n\nدر ${rangeLabel} هیچ فعالیت ثبت‌شده‌ای برای نمایش وجود ندارد.\n\n<i>داده‌ها از زمان فعال‌بودن Kronos Guard ثبت می‌شوند.</i>`;
}

async function activityRows(groupId: number, start?: string): Promise<ActivityRow[]> {
  const db = await getDb();
  if (!db) return [];
  const where = start ? and(eq(groupUserDailyStats.groupId, groupId), gte(groupUserDailyStats.dayKey, start)) : eq(groupUserDailyStats.groupId, groupId);
  return db.select({ telegramUserId: groupUserDailyStats.telegramUserId, messageCount: groupUserDailyStats.messageCount, addedMemberCount: groupUserDailyStats.addedMemberCount, forwardedMessageCount: groupUserDailyStats.forwardedMessageCount, photoCount: groupUserDailyStats.photoCount, videoCount: groupUserDailyStats.videoCount, videoNoteCount: groupUserDailyStats.videoNoteCount, animationCount: groupUserDailyStats.animationCount, documentCount: groupUserDailyStats.documentCount, audioCount: groupUserDailyStats.audioCount, stickerCount: groupUserDailyStats.stickerCount, animatedStickerCount: groupUserDailyStats.animatedStickerCount, voiceCount: groupUserDailyStats.voiceCount, dayKey: groupUserDailyStats.dayKey }).from(groupUserDailyStats).where(where);
}

function mergeActivity(rows: ActivityRow[]) {
  const result = new Map<number, ActivityRow>();
  for (const row of rows) {
    const prior = result.get(row.telegramUserId) ?? { ...row, messageCount: 0, addedMemberCount: 0, forwardedMessageCount: 0, photoCount: 0, videoCount: 0, videoNoteCount: 0, animationCount: 0, documentCount: 0, audioCount: 0, stickerCount: 0, animatedStickerCount: 0, voiceCount: 0 };
    prior.messageCount += Number(row.messageCount); prior.addedMemberCount += Number(row.addedMemberCount); prior.forwardedMessageCount += Number(row.forwardedMessageCount); prior.photoCount += Number(row.photoCount); prior.videoCount += Number(row.videoCount); prior.videoNoteCount += Number(row.videoNoteCount); prior.animationCount += Number(row.animationCount); prior.documentCount += Number(row.documentCount); prior.audioCount += Number(row.audioCount); prior.stickerCount += Number(row.stickerCount); prior.animatedStickerCount += Number(row.animatedStickerCount); prior.voiceCount += Number(row.voiceCount);
    result.set(row.telegramUserId, prior);
  }
  return Array.from(result.values());
}

async function rankingReport(input: { groupId: number; title: string; start?: string; metric: "messages" | "additions"; roleHoldersOnly?: boolean }) {
  const db = await getDb();
  if (!db) return "⚠️ اتصال پایگاه‌داده در دسترس نیست.";
  let rows = mergeActivity(await activityRows(input.groupId, input.start));
  let roleMap = new Map<number, string>();
  if (input.roleHoldersOnly) {
    const roles = await db.select({ telegramUserId: groupRoles.telegramUserId, role: groupRoles.role }).from(groupRoles).where(eq(groupRoles.groupId, input.groupId));
    roleMap = new Map(roles.map(role => [role.telegramUserId, role.role]));
    rows = rows.filter(row => roleMap.has(row.telegramUserId));
  }
  const getMetric = (row: ActivityRow) => input.metric === "messages" ? row.messageCount : row.addedMemberCount;
  rows = rows.filter(row => getMetric(row) > 0).sort((a, b) => getMetric(b) - getMetric(a)).slice(0, 30);
  if (!rows.length) return emptyReport(input.title, input.start ? `بازه از ${input.start} تا امروز` : "کل داده‌های ثبت‌شده");
  const users = await loadParticipants(input.groupId, rows.map(row => row.telegramUserId));
  rows = rows.filter(row => users.has(row.telegramUserId));
  if (!rows.length) return emptyReport(input.title, input.start ? `بازه از ${input.start} تا امروز` : "کل داده‌های ثبت‌شده");
  const label = input.metric === "messages" ? "پیام" : "افزودن عضو";
  const lines = rows.map((row, index) => `${number(index + 1)}. ${participantMention(row.telegramUserId, users)}${input.roleHoldersOnly ? ` <i>(${esc(roleMap.get(row.telegramUserId) ?? "")})</i>` : ""} — <b>${number(getMetric(row))}</b> ${label}`);
  return `<b>📊 ${input.title}</b>\n\n${lines.join("\n")}\n\n<i>رتبه‌بندی فقط از فعالیت‌های ثبت‌شده ساخته شده است.</i>`;
}

async function dailyReport(groupId: number) {
  const db = await getDb();
  if (!db) return "⚠️ اتصال پایگاه‌داده در دسترس نیست.";
  const day = tehranDayKey();
  const rows = await activityRows(groupId, day);
  const todayRows = rows.filter(row => row.dayKey === day);
  const totals = todayRows.reduce((sum, row) => ({ messages: sum.messages + Number(row.messageCount), additions: sum.additions + Number(row.addedMemberCount), forwards: sum.forwards + Number(row.forwardedMessageCount), photos: sum.photos + Number(row.photoCount), videos: sum.videos + Number(row.videoCount), videoNotes: sum.videoNotes + Number(row.videoNoteCount), animations: sum.animations + Number(row.animationCount), documents: sum.documents + Number(row.documentCount), audios: sum.audios + Number(row.audioCount), stickers: sum.stickers + Number(row.stickerCount), animatedStickers: sum.animatedStickers + Number(row.animatedStickerCount), voices: sum.voices + Number(row.voiceCount) }), { messages: 0, additions: 0, forwards: 0, photos: 0, videos: 0, videoNotes: 0, animations: 0, documents: 0, audios: 0, stickers: 0, animatedStickers: 0, voices: 0 });
  const [flow] = await db.select({ joined: groupMemberDailyStats.joinedCount, left: groupMemberDailyStats.leftCount, joinedViaInviteLink: groupMemberDailyStats.joinedViaInviteLinkCount, manuallyAdded: groupMemberDailyStats.manuallyAddedCount, expelled: groupMemberDailyStats.expelledCount, muted: groupMemberDailyStats.mutedCount }).from(groupMemberDailyStats).where(and(eq(groupMemberDailyStats.groupId, groupId), eq(groupMemberDailyStats.dayKey, day))).limit(1);
  const activityByUser = mergeActivity(todayRows);
  const leaders = activityByUser.filter(row => row.messageCount > 0).sort((a, b) => b.messageCount - a.messageCount).slice(0, 4);
  const inviters = activityByUser.filter(row => row.addedMemberCount > 0).sort((a, b) => b.addedMemberCount - a.addedMemberCount).slice(0, 4);
  const users = await loadParticipants(groupId, [...leaders, ...inviters].map(row => row.telegramUserId));
  const verifiedLeaders = leaders.filter(row => users.has(row.telegramUserId));
  const verifiedInviters = inviters.filter(row => users.has(row.telegramUserId));
  const rankLabels = ["🥇 نفر اول", "🥈 نفر دوم", "🥉 نفر سوم", "🥉 نفر چهارم"];
  const rankText = (rows: ActivityRow[], metric: "messageCount" | "addedMemberCount", label: string, empty: string) => rows.length
    ? rows.map((row, index) => formatStatisticsRankLine(rankLabels[index], participantMention(row.telegramUserId, users), label, number(row[metric]))).join("\n\n")
    : empty;
  const activityText = rankText(verifiedLeaders, "messageCount", "پیام", "هیچ فعالیتی ثبت نشده است!");
  const inviterText = rankText(verifiedInviters, "addedMemberCount", "عضو", "هیچ فعالیتی ثبت نشده است!");
  const now = new Date();
  const date = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: "Asia/Tehran", weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(`${day}T12:00:00.000+03:30`));
  const time = new Intl.DateTimeFormat("fa-IR", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now);
  return `<b>✅ فعالیت های امروز :</b>\n\n▪️ ${date}\n▪️ ساعت : ${time}\n\n▪️ کل پیام ها : <b>${number(totals.messages)}</b>\n▪️ پیام فورواردی : <b>${number(totals.forwards)}</b>\n▪️ فیلم : <b>${number(totals.videos)}</b>\n▪️ فیلم سلفی : <b>${number(totals.videoNotes)}</b>\n▪️ آهنگ : <b>${number(totals.audios)}</b>\n▪️ ویس : <b>${number(totals.voices)}</b>\n▪️ عکس : <b>${number(totals.photos)}</b>\n▪️ گیف : <b>${number(totals.animations)}</b>\n▪️ استیکر : <b>${number(totals.stickers)}</b>\n▪️ استیکر متحرک : <b>${number(totals.animatedStickers)}</b>\n\n<b>✅ فعال ترین اعضای گروه:</b>\n\n${activityText}\n\n<b>✅ کاربران برتر در افزودن عضو :</b>\n${inviterText}\n\n▪️ اعضای وارد شده با لینک : <b>${number(flow?.joinedViaInviteLink ?? 0)}</b>\n▪️ اعضای اد شده : <b>${number(flow?.manuallyAdded ?? 0)}</b>\n▪️ کل اعضای وارد شده : <b>${number(flow?.joined ?? 0)}</b>\n▪️ اعضای اخراج شده : <b>${number(flow?.expelled ?? 0)}</b>\n▪️ اعضای سکوت شده : <b>${number(flow?.muted ?? 0)}</b>\n▪️ اعضای لفت داده : <b>${number(flow?.left ?? 0)}</b>`;
}

type ScheduledReportTelegram = {
  sendMessage: (chatId: number, text: string, options: { parse_mode: "HTML"; disable_web_page_preview: true }) => Promise<{ message_id: number }>;
};

export type ScheduledStatisticsDeliveryResult = {
  ok: true;
  status: "sent" | "skipped";
  groupId?: number;
  reportDate?: string;
  skipped?: "orphan_or_unrecognized_task" | "schedule_disabled" | "group_unavailable" | "already_processed";
  messageId?: number;
};

function isDuplicateDeliveryError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ER_DUP_ENTRY";
}

/** Sends one daily report for the trusted task UID, never using an HTTP payload as identity. */
export async function deliverScheduledStatisticsReport(taskUid: string, telegram: ScheduledReportTelegram): Promise<ScheduledStatisticsDeliveryResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable for scheduled statistics delivery");
  const schedule = (await db.select().from(groupStatisticsSchedules).where(eq(groupStatisticsSchedules.scheduleCronTaskUid, taskUid)).limit(1))[0];
  if (!schedule) return { ok: true, status: "skipped", skipped: "orphan_or_unrecognized_task" };
  if (!schedule.enabled) return { ok: true, status: "skipped", groupId: schedule.groupId, skipped: "schedule_disabled" };
  const group = (await db.select({ chatId: telegramGroups.chatId, status: telegramGroups.status }).from(telegramGroups).where(eq(telegramGroups.id, schedule.groupId)).limit(1))[0];
  if (!group || group.status !== "active") return { ok: true, status: "skipped", groupId: schedule.groupId, skipped: "group_unavailable" };

  const reportDate = tehranDayKey();
  const deliveryKey = `statistics-report:${schedule.groupId}:${schedule.frequency}:${reportDate}`;
  try {
    await db.insert(groupStatisticsReportDeliveries).values({ groupId: schedule.groupId, scheduleCronTaskUid: taskUid, reportDate, frequency: schedule.frequency, deliveryKey, status: "pending" });
  } catch (error) {
    if (isDuplicateDeliveryError(error)) return { ok: true, status: "skipped", groupId: schedule.groupId, reportDate, skipped: "already_processed" };
    throw error;
  }

  try {
    const report = schedule.frequency === "monthly" ? await monthlyReport(schedule.groupId) : schedule.frequency === "weekly" ? await weeklyReport(schedule.groupId) : await dailyReport(schedule.groupId);
    const message = await telegram.sendMessage(group.chatId, report, { parse_mode: "HTML", disable_web_page_preview: true });
    await db.update(groupStatisticsReportDeliveries).set({ status: "delivered", telegramMessageId: message.message_id, deliveredAt: new Date(), errorMessage: null }).where(eq(groupStatisticsReportDeliveries.deliveryKey, deliveryKey));
    return { ok: true, status: "sent", groupId: schedule.groupId, reportDate, messageId: message.message_id };
  } catch (error) {
    await db.update(groupStatisticsReportDeliveries).set({ status: "failed", errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 512) }).where(eq(groupStatisticsReportDeliveries.deliveryKey, deliveryKey));
    throw error;
  }
}

async function periodReport(groupId: number, kind: "weekly" | "monthly", title: string, periodLabel: string, leaderLabel: string) {
  const db = await getDb();
  if (!db) return "⚠️ اتصال پایگاه‌داده در دسترس نیست.";
  const start = rangeStart(kind);
  const rows = await activityRows(groupId, start);
  if (!rows.length) return emptyReport(title, periodLabel);
  const totals = rows.reduce((sum, row) => ({ messages: sum.messages + Number(row.messageCount), additions: sum.additions + Number(row.addedMemberCount), media: sum.media + Number(row.photoCount) + Number(row.videoCount) + Number(row.videoNoteCount) + Number(row.animationCount) + Number(row.documentCount) + Number(row.audioCount) + Number(row.stickerCount) + Number(row.animatedStickerCount) + Number(row.voiceCount) }), { messages: 0, additions: 0, media: 0 });
  const flows = await db.select({ joined: groupMemberDailyStats.joinedCount, left: groupMemberDailyStats.leftCount }).from(groupMemberDailyStats).where(and(eq(groupMemberDailyStats.groupId, groupId), gte(groupMemberDailyStats.dayKey, start)));
  const joined = flows.reduce((sum, row) => sum + Number(row.joined), 0); const left = flows.reduce((sum, row) => sum + Number(row.left), 0);
  const leaders = mergeActivity(rows).filter(row => row.messageCount > 0).sort((a, b) => b.messageCount - a.messageCount).slice(0, 5);
  const users = await loadParticipants(groupId, leaders.map(row => row.telegramUserId));
  const verifiedLeaders = leaders.filter(row => users.has(row.telegramUserId));
  const leaderText = verifiedLeaders.length ? verifiedLeaders.map((row, index) => `${["🥇", "🥈", "🥉", "🏅", "🏅"][index]} ${number(index + 1)}. ${participantMention(row.telegramUserId, users)}\n📌 پیام: <b>${number(row.messageCount)}</b>`).join("\n\n") : "فعالیتی ثبت نشده است.";
  const activeMembers = new Set(rows.filter(row => row.messageCount > 0).map(row => row.telegramUserId)).size;
  return `<b>📈 ${title}</b>\n<blockquote>بازه: ${formatStatisticsDay(start)} تا ${formatStatisticsDay(tehranDayKey())}</blockquote>\n\n${formatStatisticsMetricLine("💬", "پیام‌ها", number(totals.messages))}\n${formatStatisticsMetricLine("👥", "اعضای فعال", number(activeMembers))}\n${formatStatisticsMetricLine("🗂", "رسانه‌های ثبت‌شده", number(totals.media))}\n${formatStatisticsMetricLine("➕", "افزودن عضو توسط کاربران", number(totals.additions))}\n${formatStatisticsMetricLine("🔄", "ورود/خروج ثبت‌شده", `+${number(joined)} / -${number(left)}`)}\n\n<b>🏅 برترین‌های ${leaderLabel}</b>\n${leaderText}`;
}

async function weeklyReport(groupId: number) {
  return periodReport(groupId, "weekly", "آمار فعالیت هفتگی", "7 روز منتهی به امروز", "هفته");
}

async function monthlyReport(groupId: number) {
  return periodReport(groupId, "monthly", "آمار فعالیت ماهانه", "30 روز منتهی به امروز", "ماه");
}

async function weeklyDailyLeadersReport(groupId: number) {
  const start = rangeStart("weekly");
  const rows = await activityRows(groupId, start);
  const keys = dayKeys(start, 7);
  const users = await loadParticipants(groupId, Array.from(new Set(rows.map(row => row.telegramUserId))));
  const lines = keys.flatMap(key => {
    const leaders = mergeActivity(rows.filter(row => row.dayKey === key)).filter(row => row.messageCount > 0).sort((a, b) => b.messageCount - a.messageCount).slice(0, 3);
    const verifiedLeaders = leaders.filter(row => users.has(row.telegramUserId));
    return [`<b>📅 ${esc(formatStatisticsDay(key))}</b>`, verifiedLeaders.length ? verifiedLeaders.map((row, index) => `${["🥇", "🥈", "🥉"][index]} ${number(index + 1)}. ${participantMention(row.telegramUserId, users)}\n📌 پیام: <b>${number(row.messageCount)}</b>`).join("\n\n") : "▫️ بدون فعالیت ثبت‌شده"];
  });
  return `<b>🗓 برترین‌های هر روز هفته</b>\n\n${lines.join("\n")}`;
}

async function groupAccess(ctx: StatsContext, groupId: number) {
  if (!ctx.from || !ctx.chat) return false;
  const access = await resolveAccessLevel({ groupId, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  const allowed = isStatisticsAccessLevelAllowed(access);
  void recordGroupAuditEvent({ groupId, actorTelegramId: ctx.from.id, action: "command.statistics.access", outcome: allowed ? "allowed" : "denied", details: { resolvedAccess: access } });
  return allowed;
}

async function buildReport(_ctx: StatsContext, mode: string, groupId: number) {
  const aliases: Record<string, string> = { "top-activity": "top-daily", roles: "role-activity", "top-additions": "top-invites", "weekly-users": "weekly", "weekly-leaders": "weekly-days", "all-users": "lifetime" };
  const normalized = aliases[mode] ?? mode;
  if (normalized === "daily") return dailyReport(groupId);
  if (normalized === "top-daily") return rankingReport({ groupId, title: "30 نفر برتر فعالیت روزانه", start: tehranDayKey(), metric: "messages" });
  if (normalized === "role-activity") return rankingReport({ groupId, title: "فعالیت کاربران مقام‌دار", start: tehranDayKey(), metric: "messages", roleHoldersOnly: true });
  if (normalized === "top-invites") return rankingReport({ groupId, title: "30 نفر برتر افزودن عضو", start: tehranDayKey(), metric: "additions" });
  if (normalized === "weekly") return weeklyReport(groupId);
  if (normalized === "monthly") return monthlyReport(groupId);
  if (normalized === "weekly-days") return weeklyDailyLeadersReport(groupId);
  if (normalized === "lifetime") return rankingReport({ groupId, title: "30 نفر برتر فعالیت کل", metric: "messages" });
  return emptyReport("آمار", "این بازه");
}

export async function handleStatisticsCommand(ctx: StatsContext) {
  const commandText = typeof ctx.message === "object" && ctx.message !== null && "text" in ctx.message && typeof ctx.message.text === "string" ? ctx.message.text : undefined;
  if (!isGroup(ctx) || !ctx.from || !commandText || !/^آمار(?:\s|$)/.test(commandText.trim())) return false;
  const group = await findGroupByChatId(ctx.chat!.id);
  if (!group || !(await groupAccess(ctx, group.id))) { await ctx.reply("⛔ دستور آمار فقط برای مدیران مجاز گروه و نقش‌های داخلی Kronos در دسترس است."); return true; }
  await ctx.reply(await buildReport(ctx, "daily", group.id), { parse_mode: "HTML", ...dailyKeyboard() });
  return true;
}

export async function handleStatisticsCallback(ctx: StatsCallbackContext) {
  const data = ctx.callbackQuery?.data ?? "";
  if (!data.startsWith("stats:")) return false;
  if (!isGroup(ctx) || !ctx.from || !ctx.chat) return true;
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group || !(await groupAccess(ctx, group.id))) { await ctx.answerCbQuery("دسترسی این منو فقط برای مدیران مجاز گروه یا Kronos است.", { show_alert: true }); return true; }
  const action = data.slice("stats:".length);
  if (action === "close") { await ctx.answerCbQuery(); await ctx.editMessageText("منوی آمار بسته شد."); return true; }
  if (action === "menu") { await ctx.answerCbQuery(); await ctx.editMessageText(statisticsMenuText, { parse_mode: "HTML", ...statisticsMenuKeyboard() }); return true; }
  if (action === "custom") { const schedule = await readSchedule(group.id); await ctx.answerCbQuery(); await ctx.editMessageText(await scheduleScreen(group.id), { parse_mode: "HTML", ...scheduleKeyboard(schedule) }); return true; }
  if (action.startsWith("schedule:")) {
    const schedule = await readSchedule(group.id); const parts = action.split(":"); const kind = parts[1];
    if (kind === "preview") { const next = nextStatisticsRun(schedule); await ctx.answerCbQuery(next ? `اجرای بعدی: ${next.date} ساعت ${String(next.hour).padStart(2, "0")}:${String(next.minute).padStart(2, "0")} (${next.timezone})` : "اجرای بعدی برای این برنامه پیدا نشد.", { show_alert: true }); return true; }
    if (kind === "frequency" && ["daily", "weekly", "monthly"].includes(parts[2])) schedule.frequency = parts[2] as ScheduleFrequency;
    else if (kind === "time") { schedule.hour = Number(parts[2]); schedule.minute = Number(parts[3]); }
    else if (kind === "weekday") schedule.dayOfWeek = Number(parts[2]);
    else if (kind === "monthday") schedule.dayOfMonth = Number(parts[2]);
    else if (kind === "tz") schedule.timezone = parts.slice(2).join(":");
    else if (kind === "toggle") schedule.enabled = !schedule.enabled;
    const validationError = validateStatisticsSchedule(schedule);
    if (validationError) { await ctx.answerCbQuery(validationError, { show_alert: true }); return true; }
    await ctx.editMessageText("<b>⏳ در حال ذخیره‌سازی تنظیمات زمان‌بندی…</b>", { parse_mode: "HTML" });
    try { await saveSchedule(group.id, ctx.from.id, schedule); } catch (error) { await ctx.answerCbQuery(error instanceof Error ? error.message : "ذخیرهٔ زمان‌بندی ناموفق بود.", { show_alert: true }); return true; }
    await ctx.answerCbQuery("✅ تنظیمات زمان‌بندی با موفقیت ذخیره شد.");
    await ctx.editMessageText(await scheduleScreen(group.id), { parse_mode: "HTML", ...scheduleKeyboard(schedule) });
    return true;
  }
  await ctx.editMessageText(await buildReport(ctx, action, group.id), { parse_mode: "HTML", ...(action === "daily" ? dailyKeyboard() : reportKeyboard()) });
  await ctx.answerCbQuery();
  return true;
}

export { buildReport as buildStatisticsReport };
export { statisticsCron };
export const statisticsRangeStart = rangeStart;
