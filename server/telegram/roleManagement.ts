import type { Context } from "telegraf";
import { and, eq, inArray, sql } from "drizzle-orm";
import { groupRoles, telegramUsers } from "../../drizzle/schema";
import { getDb } from "../db";
import { hasAtLeastAccess, mayModerateTarget, resolveAccessLevel } from "./authorization";
import { findGroupByChatId, recordRecentGroupMessage, recordTelegramUser, suspendGroupAuthority, writeAuditLog } from "./repository";
import { OWNER_TELEGRAM_ID, type AccessLevel } from "./constants";
import { mayDelegateKronosRole, type KronosInternalRole } from "./rolePolicy";
import { withTelegramButtonStyle } from "./buttonStyle";
import { normalizeCommandInput } from "./commandInput";
import { ensureVipProtectionPolicy, removeVipProtectionPolicy } from "./vipProtection";
import { notifyGroupEvent } from "./groupEventNotifier";
import { prepareTargetAwareCommandText, resolveTelegramTarget, targetReferenceFromToken, type TargetReference } from "./targetResolver";
import { deleteTemporaryCommandSuccess, telegramMessageId } from "./temporarySuccess";
import { bootstrapTelegramGroupAuthorities } from "./groupRoleBootstrap";

type ManagedRole = Exclude<KronosInternalRole, "user">;
type ManagedRoleScope = ManagedRole | "all";
type RoleAction = "add" | "remove" | "list";
export type ParsedRoleCommand = { role: ManagedRoleScope; action: RoleAction; target?: TargetReference };
type RoleCleanupScope = ManagedRole;

type PendingRolePromotion = {
  actorTelegramUserId: number;
  actorDisplayName: string;
  groupId: number;
  groupChatId: number;
  targetTelegramUserId: number;
  targetDisplayName: string;
  role: ManagedRole;
  expiresAt: number;
};

type PendingRoleCleanup = {
  actorTelegramUserId: number;
  groupId: number;
  groupChatId: number;
  role: RoleCleanupScope;
  memberCount: number;
  expiresAt: number;
  sourcePanelMessageId?: number;
};

const ROLE_PROMOTION_CONFIRMATION_TTL_MS = 60_000;
const ROLE_LIST_PAGE_SIZE = 8;
const pendingRolePromotions = new Map<string, PendingRolePromotion>();
const pendingRoleCleanups = new Map<string, PendingRoleCleanup>();

const rolePatterns: Array<{ pattern: RegExp; action: RoleAction; role: ManagedRoleScope }> = [
  { pattern: /^(?:افزودن\s+مالک\s+کرونوس|تنظیم\s+مالک(?:\s+کرونوس)?|set\s+kronos\s+owner|add\s+kronos\s+owner)\s*(.*)$/i, action: "add", role: "kronos_owner" },
  { pattern: /^(?:عزل\s+مالک(?:\s+کرونوس)?|حذف\s+مالک(?:\s+کرونوس)?|remove\s+kronos\s+owner)\s*(.*)$/i, action: "remove", role: "kronos_owner" },
  { pattern: /^(?:لیست\s+(?:مالک|مالکان|مالکین)(?:\s+کرونوس)?|list\s+kronos\s+owners)$/i, action: "list", role: "kronos_owner" },
  { pattern: /^(?:افزودن\s+مدیر|تنظیم\s+مدیر|set\s+moderator|add\s+moderator)\s*(.*)$/i, action: "add", role: "moderator" },
  { pattern: /^(?:عزل\s+مدیر|حذف\s+مدیر|remove\s+moderator)\s*(.*)$/i, action: "remove", role: "moderator" },
  { pattern: /^(?:لیست\s+(?:کاربران\s+)?(?:مدیر|مدیران)|list\s+moderators)$/i, action: "list", role: "moderator" },
  { pattern: /^(?:افزودن\s+ویژه|تنظیم\s+ویژه|set\s+vip|add\s+vip)\s*(.*)$/i, action: "add", role: "vip" },
  { pattern: /^(?:عزل\s+ویژه|حذف\s+ویژه|remove\s+vip)\s*(.*)$/i, action: "remove", role: "vip" },
  { pattern: /^(?:لیست\s+(?:کاربران\s+)?ویژه|list\s+vip)$/i, action: "list", role: "vip" },
  { pattern: /^(?:عزل|حذف\s+مقام(?:‌|\s)?ها?|remove\s+roles?)\s*(.*)$/i, action: "remove", role: "all" },
];

const roleCleanupPatterns: Array<{ pattern: RegExp; role: RoleCleanupScope }> = [
  { pattern: /^(?:پاکسازی\s+(?:لیست\s+)?(?:کاربران\s+)?مدیران?|پاک\s+کردن\s+(?:لیست\s+)?مدیران?)$/i, role: "moderator" },
  { pattern: /^(?:پاکسازی\s+(?:لیست\s+)?(?:کاربران\s+)?ویژه|پاک\s+کردن\s+(?:لیست\s+)?(?:کاربران\s+)?ویژه)$/i, role: "vip" },
  { pattern: /^(?:پاکسازی\s+(?:لیست\s+)?مالک(?:ان|ین)?(?:\s+ربات)?|پاک\s+کردن\s+(?:لیست\s+)?مالک(?:ان|ین)?(?:\s+ربات)?)$/i, role: "kronos_owner" },
];

export function parseRoleCommand(text: string, isReply = false): ParsedRoleCommand | undefined {
  const normalized = normalizeCommandInput(text);
  for (const item of rolePatterns) {
    const match = normalized.match(item.pattern);
    if (!match) continue;
    const targetText = match[1]?.trim() || undefined;
    if (item.action === "list") return { role: item.role, action: item.action };
    if (isReply) {
      // A reply already supplies the target; extra words make the command
      // ambiguous and must be ignored rather than treated as an action.
      if (targetText) return undefined;
      return { role: item.role, action: item.action, target: { kind: "reply" } };
    }
    const target = targetReferenceFromToken(targetText);
    if (!target) return undefined;
    return { role: item.role, action: item.action, target };
  }
  return undefined;
}

export function parseRoleCleanupCommand(text: string): RoleCleanupScope | undefined {
  const normalized = normalizeCommandInput(text);
  return roleCleanupPatterns.find(item => item.pattern.test(normalized))?.role;
}

function escapeTelegramHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function roleLabel(role: ManagedRole) {
  return role === "kronos_owner" ? "مالک" : role === "moderator" ? "مدیر" : "کاربر ویژه";
}

function roleListLabel(role: ManagedRole) {
  return role === "kronos_owner" ? "مالکان ربات" : role === "moderator" ? "مدیران ربات" : "کاربران ویژه ربات";
}

function roleCleanupLabel(role: RoleCleanupScope) {
  return role === "kronos_owner" ? "مالکان" : role === "moderator" ? "مدیران" : "کاربران ویژه";
}

function roleCleanupKeyboard(token: string) {
  return { inline_keyboard: [[
    withTelegramButtonStyle({ text: "لغو", callback_data: `role-cleanup-confirm:no:${token}` }, "danger"),
    withTelegramButtonStyle({ text: "تأیید پاکسازی", callback_data: `role-cleanup-confirm:yes:${token}` }, "success"),
  ]] };
}

function roleCleanupConfirmationText(input: Pick<PendingRoleCleanup, "role" | "memberCount">) {
  return `<b>پاکسازی ${roleCleanupLabel(input.role)}</b>\n\nدسترسی Kronos Guard برای ${input.memberCount.toLocaleString("fa-IR")} کاربر حذف می‌شود.\n\n<i>مقام واقعی افراد در Telegram تغییر نمی‌کند؛ بازگردانی فقط با راه‌اندازی خودکار مالک ممکن است.</i>`;
}

function clearedRoleListText(role: RoleCleanupScope, cleanedAt: Date) {
  const cleanedAtLabel = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Tehran" }).format(cleanedAt);
  const label = role === "kronos_owner" ? "مالکان" : role === "moderator" ? "مدیران" : "کاربران ویژه";
  return `<b>🛡️ ${label}</b>\n\n<i>لیست خالی است.</i>\n\n✅ <b>پاکسازی انجام شد:</b> ${cleanedAtLabel}`;
}

function cleanupRoleScope(role: RoleCleanupScope) {
  return role === "kronos_owner" ? ["group_owner", "kronos_owner"] as const : role === "moderator" ? ["group_admin", "moderator"] as const : ["vip"] as const;
}

function mayCleanRoleList(input: { actorAccess: AccessLevel; actorTelegramId: number; role: RoleCleanupScope }) {
  if (input.role === "moderator") return input.actorAccess === "owner" || input.actorAccess === "group_owner";
  if (input.role === "kronos_owner") return input.actorTelegramId === OWNER_TELEGRAM_ID;
  return mayDelegateKronosRole({ actorAccess: input.actorAccess, actorIsSoleBotOwner: input.actorTelegramId === OWNER_TELEGRAM_ID, role: input.role });
}

function roleListCleanupKeyboard(role: RoleCleanupScope) {
  return { inline_keyboard: [[
    withTelegramButtonStyle({ text: `پاکسازی ${roleCleanupLabel(role)}`, callback_data: `role-list-cleanup:${role}` }, "danger"),
  ]] };
}

export function roleListPageWindow(memberCount: number, requestedPage: number) {
  const totalPages = Math.max(1, Math.ceil(memberCount / ROLE_LIST_PAGE_SIZE));
  const page = Math.min(Math.max(0, requestedPage), totalPages - 1);
  return { page, totalPages, start: page * ROLE_LIST_PAGE_SIZE, end: Math.min((page + 1) * ROLE_LIST_PAGE_SIZE, memberCount) };
}

function roleListKeyboard(role: ManagedRole, page: number, totalPages: number) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  if (totalPages > 1) {
    const navigation: Array<{ text: string; callback_data: string }> = [];
    if (page > 0) navigation.push(withTelegramButtonStyle({ text: "› صفحهٔ قبل", callback_data: `role-list-page:${role}:${page - 1}` }, "primary"));
    navigation.push({ text: `${(page + 1).toLocaleString("fa-IR")} / ${totalPages.toLocaleString("fa-IR")}`, callback_data: `role-list-page:${role}:${page}` });
    if (page < totalPages - 1) navigation.push(withTelegramButtonStyle({ text: "صفحهٔ بعد ‹", callback_data: `role-list-page:${role}:${page + 1}` }, "primary"));
    rows.push(navigation);
  }
  rows.push(...roleListCleanupKeyboard(role).inline_keyboard);
  return { inline_keyboard: rows };
}

function roleTargetLabel(target: { telegramUserId: number; displayName: string }) {
  return `<a href="tg://user?id=${target.telegramUserId}">${escapeTelegramHtml(target.displayName)}</a>`;
}

function roleNoOpMessage(target: { telegramUserId: number; displayName: string }, role: ManagedRole, action: "add" | "remove") {
  const status = action === "add"
    ? `در فهرست ${roleListLabel(role)} وجود دارد!`
    : `در فهرست ${roleListLabel(role)} وجود ندارد!`;
  return `› کاربر ${roleTargetLabel(target)}\n\n›› ${status}`;
}

function roleRank(role: ManagedRole) {
  return role === "kronos_owner" ? 3 : role === "moderator" ? 2 : 1;
}

function prunePendingRolePromotions(now = Date.now()) {
  pendingRolePromotions.forEach((promotion, token) => {
    if (promotion.expiresAt <= now) {
      pendingRolePromotions.delete(token);
    }
  });
}

function newRolePromotionToken() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function rolePromotionKeyboard(token: string) {
  return {
    inline_keyboard: [[
      withTelegramButtonStyle({ text: "خیر", callback_data: `role-confirm:no:${token}` }, "danger"),
      withTelegramButtonStyle({ text: "بله", callback_data: `role-confirm:yes:${token}` }, "success"),
    ]],
  };
}

function rolePromotionConfirmationText(input: Pick<PendingRolePromotion, "targetTelegramUserId" | "targetDisplayName" | "role" | "expiresAt">) {
  const target = `<a href="tg://user?id=${input.targetTelegramUserId}">${escapeTelegramHtml(input.targetDisplayName)}</a>`;
  const remainingSeconds = Math.max(0, Math.ceil((input.expiresAt - Date.now()) / 1_000)).toLocaleString("fa-IR");
  return `<b>تأیید ارتقای مقام</b>\n\nآیا از ارتقای مقام کاربر ${target} به «${roleLabel(input.role)}» اطمینان دارید؟\n\n⏳ <b>زمان باقی‌مانده:</b> ${remainingSeconds} ثانیه`;
}

async function applyRoleChange(input: {
  ctx: Context;
  groupId: number;
  actorTelegramId: number;
  actorDisplayName: string;
  targetTelegramUserId: number;
  targetDisplayName: string;
  roles: readonly ManagedRole[];
  action: "add" | "remove";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while updating group roles");
  if (input.action === "add") {
    const role = input.roles[0];
    await db.insert(groupRoles).values({ groupId: input.groupId, telegramUserId: input.targetTelegramUserId, role, grantedByTelegramId: input.actorTelegramId }).onDuplicateKeyUpdate({ set: { grantedByTelegramId: input.actorTelegramId } });
    if (role === "vip") await ensureVipProtectionPolicy({ groupId: input.groupId, telegramUserId: input.targetTelegramUserId, updatedByTelegramId: input.actorTelegramId });
  } else {
    for (const role of input.roles) {
      await db.delete(groupRoles).where(and(eq(groupRoles.groupId, input.groupId), eq(groupRoles.telegramUserId, input.targetTelegramUserId), eq(groupRoles.role, role)));
      if (role === "vip") await removeVipProtectionPolicy(input.groupId, input.targetTelegramUserId);
    }
  }
  await writeAuditLog({ category: "role_management", event: input.roles.length === 1 ? `${input.action}_${input.roles[0]}` : "remove_all_roles", groupId: input.groupId, actorTelegramId: input.actorTelegramId, subjectTelegramId: input.targetTelegramUserId, details: { roles: input.roles } });
  await notifyGroupEvent({
    groupId: input.groupId,
    eventType: input.action === "add" ? "role.promoted" : "role.demoted",
    actor: { telegramUserId: input.actorTelegramId, displayName: input.actorDisplayName },
    subject: { telegramUserId: input.targetTelegramUserId, displayName: input.targetDisplayName },
    details: { summary: `${input.action === "add" ? "اعطای" : "حذف"} مقام Kronos: ${input.roles.map(roleLabel).join("، ")}` },
    eventKey: `kronos-role:${input.groupId}:${input.action}:${input.targetTelegramUserId}:${input.roles.slice().sort().join(",")}:${Date.now()}`,
    telegram: input.ctx.telegram,
  });
  const response = await input.ctx.reply(roleChangeAnnouncement({
    targetTelegramUserId: input.targetTelegramUserId,
    targetDisplayName: input.targetDisplayName,
    actorTelegramUserId: input.actorTelegramId,
    actorDisplayName: input.actorDisplayName,
    roles: input.roles,
    action: input.action,
  }), { parse_mode: "HTML" });
  await deleteTemporaryCommandSuccess({ telegram: input.ctx.telegram, chatId: input.ctx.chat?.id, messageId: telegramMessageId(response) });
}

function roleChangeAnnouncement(input: { targetTelegramUserId: number; targetDisplayName: string; actorTelegramUserId: number; actorDisplayName: string; roles: readonly ManagedRole[]; action: "add" | "remove" }) {
  const roleName = input.roles.map(roleLabel).join("، ");
  const target = `<a href="tg://user?id=${input.targetTelegramUserId}">${escapeTelegramHtml(input.targetDisplayName)}</a>`;
  const actor = `<a href="tg://user?id=${input.actorTelegramUserId}">${escapeTelegramHtml(input.actorDisplayName)}</a>`;
  const now = new Date();
  const time = new Intl.DateTimeFormat("fa-IR", { timeStyle: "short" }).format(now);
  const date = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { dateStyle: "long" }).format(now);
  const isElevation = input.action === "add";
  const summary = isElevation ? "به مقام جدید دست یافت" : "از مقام تعیین‌شده عزل شد";
  return `<b>${isElevation ? "⬆️ ارتقای مقام" : "⬇️ عزل مقام"}</b>\n\n👤 <b>کاربر:</b> ${target}\n🛡️ <b>مقام:</b> ${escapeTelegramHtml(roleName)}\n👮 <b>انجام‌دهنده:</b> ${actor}\n\n${isElevation ? "✅" : "☑️"} ${summary}.\n<i>لایهٔ نقش: مقام ربات</i>\n\n🕒 ساعت: ${time}\n📅 تاریخ: ${date}`;
}

async function listManagedRoles(ctx: Context, groupId: number, role: ManagedRole, requestedPage = 0, mode: "reply" | "edit" = "reply") {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while listing group roles");
  const roleScope = role === "kronos_owner" ? ["group_owner", "kronos_owner"] as const : role === "moderator" ? ["group_admin", "moderator"] as const : ["vip"] as const;
  const rows = await db.select({ telegramUserId: groupRoles.telegramUserId, role: groupRoles.role }).from(groupRoles).where(and(eq(groupRoles.groupId, groupId), inArray(groupRoles.role, [...roleScope])));
  const ids = Array.from(new Set(rows.map(row => row.telegramUserId)));
  const knownUsers = ids.length
    ? await db.select({ telegramUserId: telegramUsers.telegramUserId, firstName: telegramUsers.firstName, lastName: telegramUsers.lastName, username: telegramUsers.username }).from(telegramUsers).where(inArray(telegramUsers.telegramUserId, ids))
    : [];
  const knownById = new Map(knownUsers.map(user => [user.telegramUserId, user]));
  const label = role === "kronos_owner" ? "مالکان" : role === "moderator" ? "مدیران" : "کاربران ویژه";
  const members = ids.map(telegramUserId => {
    const user = knownById.get(telegramUserId);
    const displayName = user ? [user.firstName, user.lastName].filter(Boolean).join(" ") || (user.username ? `@${user.username}` : String(telegramUserId)) : String(telegramUserId);
    const labels = rows.filter(row => row.telegramUserId === telegramUserId).map(row => row.role === "group_owner" ? "مالک گروه" : row.role === "group_admin" ? "مدیر گروه" : row.role === "kronos_owner" ? "مالک ربات" : row.role === "moderator" ? "مدیر ربات" : "ویژه");
    return { telegramUserId, displayName, labels };
  }).sort((left, right) => left.displayName.localeCompare(right.displayName, "fa"));
  const shouldPaginate = role === "moderator" || role === "kronos_owner";
  const pagination = roleListPageWindow(members.length, shouldPaginate ? requestedPage : 0);
  const visibleMembers = shouldPaginate ? members.slice(pagination.start, pagination.end) : members;
  const body = visibleMembers.length
    ? visibleMembers.map((member, index) => `${pagination.start + index + 1}. ${roleTargetLabel(member)} <i>(${member.labels.join(" · ")})</i>`).join("\n")
    : "<i>هیچ کاربری با این مقام ثبت نشده است.</i>";
  const pageDetail = shouldPaginate && members.length > ROLE_LIST_PAGE_SIZE ? ` · صفحه ${pagination.page + 1} از ${pagination.totalPages}` : "";
  const text = `<b>🛡️ ${label}</b>\n\n${body}\n\n<i>تعداد: ${members.length.toLocaleString("fa-IR")}${pageDetail}</i>`;
  const options = { parse_mode: "HTML" as const, reply_markup: roleListKeyboard(role, pagination.page, shouldPaginate ? pagination.totalPages : 1) };
  if (mode === "edit") {
    await ctx.editMessageText(text, options);
    return;
  }
  await ctx.reply(text, { ...options, ...(ctx.message && "message_id" in ctx.message ? { reply_parameters: { message_id: ctx.message.message_id } } : {}) });
}

async function requestRoleCleanup(input: { ctx: Context; groupId: number; groupChatId: number; actorTelegramId: number; actorAccess: AccessLevel; role: RoleCleanupScope; replyToMessageId?: number; sourcePanelMessageId?: number }) {
  if (!mayCleanRoleList({ actorAccess: input.actorAccess, actorTelegramId: input.actorTelegramId, role: input.role })) {
    await input.ctx.reply(input.role === "moderator" ? "پاکسازی مدیران فقط توسط مالک اصلی ربات یا مالک واقعی گروه مجاز است." : input.role === "kronos_owner" ? "پاکسازی مالکان فقط توسط مالک اصلی Kronos Guard مجاز است." : "سطح دسترسی شما برای پاکسازی این نقش کافی نیست.");
    return;
  }
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while cleaning group roles");
  const rows = await db.select({ telegramUserId: groupRoles.telegramUserId }).from(groupRoles).where(and(eq(groupRoles.groupId, input.groupId), inArray(groupRoles.role, [...cleanupRoleScope(input.role)])));
  const memberCount = new Set(rows.map(row => row.telegramUserId)).size;
  if (!memberCount) {
    await input.ctx.reply(`هیچ کاربری در فهرست ${roleCleanupLabel(input.role)} ربات ثبت نشده است.`);
    return;
  }
  const token = newRolePromotionToken();
  const pending: PendingRoleCleanup = { actorTelegramUserId: input.actorTelegramId, groupId: input.groupId, groupChatId: input.groupChatId, role: input.role, memberCount, expiresAt: Date.now() + ROLE_PROMOTION_CONFIRMATION_TTL_MS, sourcePanelMessageId: input.sourcePanelMessageId };
  pendingRoleCleanups.set(token, pending);
  await input.ctx.reply(roleCleanupConfirmationText(pending), { parse_mode: "HTML", ...(input.replyToMessageId ? { reply_parameters: { message_id: input.replyToMessageId } } : {}), reply_markup: roleCleanupKeyboard(token) });
}

/** Implements slashless protected Kronos owner, moderator, and VIP controls for group administrators. */
export async function handleRoleManagementCommand(ctx: Context): Promise<boolean> {
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") || !ctx.from || !ctx.message || !("text" in ctx.message)) return false;
  const commandText = prepareTargetAwareCommandText(ctx.message);
  const command = parseRoleCommand(commandText, Boolean(ctx.message.reply_to_message));
  const cleanupRole = parseRoleCleanupCommand(commandText);
  if (!command && !cleanupRole) return false;
  const actorTelegramId = ctx.from.id;
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) return false;
  const actorAccess = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: actorTelegramId }, ctx.telegram);
  if (!hasAtLeastAccess(actorAccess, "group_admin")) {
    await ctx.reply("فقط مدیران گروه می‌توانند کاربران مدیر یا ویژه را مدیریت کنند.");
    return true;
  }
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while updating group roles");

  if (cleanupRole) {
    await requestRoleCleanup({ ctx, groupId: group.id, groupChatId: ctx.chat.id, actorTelegramId, actorAccess, role: cleanupRole, replyToMessageId: ctx.message.message_id });
    return true;
  }

  if (!command) return false;

  if (command.action === "list") {
    if (command.role === "all") return false;
    const getChatAdministrators = ctx.telegram.getChatAdministrators;
    const liveAdministrators = typeof getChatAdministrators === "function"
      ? await getChatAdministrators.call(ctx.telegram, ctx.chat.id).catch(() => undefined)
      : undefined;
    if (liveAdministrators) {
      await bootstrapTelegramGroupAuthorities({ groupId: group.id, administrators: liveAdministrators, grantedByTelegramId: actorTelegramId });
    }
    await listManagedRoles(ctx, group.id, command.role);
    return true;
  }

  const target = await resolveTelegramTarget(ctx, command.target);
  if (!target) {
    await ctx.reply("کاربر هدف مشخص نیست. روی پیام او ریپلای کنید یا @username / شناسه عددی را وارد کنید.");
    return true;
  }
  const targetAccess = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: target.telegramUserId }, ctx.telegram);
  if (!mayModerateTarget(actorAccess, targetAccess)) {
    await ctx.reply("سطح دسترسی شما برای مدیریت این کاربر کافی نیست.");
    return true;
  }
  const targetRoles = await db.select({ role: groupRoles.role }).from(groupRoles).where(and(eq(groupRoles.groupId, group.id), eq(groupRoles.telegramUserId, target.telegramUserId)));
  const rolesToChange = command.role === "all"
    ? targetRoles.map(row => row.role).filter((role): role is ManagedRole => role === "kronos_owner" || role === "moderator" || role === "vip")
    : [command.role];
  if (!rolesToChange.length) {
    await ctx.reply("این کاربر هیچ مقام رباتی برای عزل ندارد.", { reply_parameters: { message_id: ctx.message.message_id } });
    return true;
  }
  if (rolesToChange.some(role => !mayDelegateKronosRole({ actorAccess, actorIsSoleBotOwner: actorTelegramId === OWNER_TELEGRAM_ID, role }))) {
    await ctx.reply(rolesToChange.includes("kronos_owner") ? "فقط مالک اصلی ربات می‌تواند نقش محافظت‌شده «مالک» را اضافه یا حذف کند." : "سیاست مقام ربات اجازهٔ این تغییر را به شما نمی‌دهد.");
    return true;
  }
  if (rolesToChange.includes("kronos_owner") && actorTelegramId !== OWNER_TELEGRAM_ID) {
    await ctx.reply("نقش محافظت‌شده «مالک» فقط توسط مالک اصلی ربات قابل تغییر است.");
    return true;
  }

  if (command.action === "remove" && command.role !== "all" && !targetRoles.some(row => row.role === command.role)) {
    await ctx.reply(roleNoOpMessage(target, command.role, "remove"), { parse_mode: "HTML", reply_parameters: { message_id: ctx.message.message_id } });
    return true;
  }

  if (command.action === "add") {
    const role = rolesToChange[0];
    const highestExistingRole = targetRoles
      .map(row => row.role)
      .filter((existingRole): existingRole is ManagedRole => existingRole === "kronos_owner" || existingRole === "moderator" || existingRole === "vip")
      .sort((left, right) => roleRank(right) - roleRank(left))[0];
    if (highestExistingRole && roleRank(highestExistingRole) >= roleRank(role)) {
      await ctx.reply(roleNoOpMessage(target, highestExistingRole, "add"), { parse_mode: "HTML", reply_parameters: { message_id: ctx.message.message_id } });
      return true;
    }
    prunePendingRolePromotions();
    const token = newRolePromotionToken();
    const actorDisplayName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || ctx.from.username || "مدیر گروه";
    const pending: PendingRolePromotion = {
      actorTelegramUserId: actorTelegramId,
      actorDisplayName,
      groupId: group.id,
      groupChatId: ctx.chat.id,
      targetTelegramUserId: target.telegramUserId,
      targetDisplayName: target.displayName,
      role,
      expiresAt: Date.now() + ROLE_PROMOTION_CONFIRMATION_TTL_MS,
    };
    pendingRolePromotions.set(token, pending);
    const confirmationMessage = await ctx.reply(rolePromotionConfirmationText(pending), {
      parse_mode: "HTML",
      reply_parameters: { message_id: ctx.message.message_id },
      reply_markup: rolePromotionKeyboard(token),
    });
    if (confirmationMessage && "message_id" in confirmationMessage && typeof confirmationMessage.message_id === "number") {
      void Promise.resolve(recordRecentGroupMessage({
        groupId: group.id,
        messageId: confirmationMessage.message_id,
        autoDeleteAt: new Date(pending.expiresAt),
      })).catch(error => console.warn("[Kronos Guard] role confirmation cleanup registration failed", error));
    }
    return true;
  }
  await applyRoleChange({
    ctx,
    groupId: group.id,
    actorTelegramId,
    actorDisplayName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") || ctx.from.username || "مدیر گروه",
    targetTelegramUserId: target.telegramUserId,
    targetDisplayName: target.displayName,
    roles: rolesToChange,
    action: "remove",
  });
  return true;
}

/** Consumes the short-lived confirmation that precedes every role-promotion command. */
export async function handleRoleManagementConfirmation(ctx: Context): Promise<boolean> {
  const data = "callbackQuery" in ctx && ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
  const match = typeof data === "string" ? data.match(/^role-confirm:(yes|no):([a-z0-9]{8,32})$/i) : null;
  if (!match || !ctx.from || !ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) return false;
  const [, decision, token] = match;
  const pending = pendingRolePromotions.get(token);
  if (!pending || pending.expiresAt <= Date.now() || pending.actorTelegramUserId !== ctx.from.id || pending.groupChatId !== ctx.chat.id) {
    pendingRolePromotions.delete(token);
    await ctx.answerCbQuery("این تأیید منقضی شده یا برای شما نیست.", { show_alert: true }).catch(() => undefined);
    return true;
  }
  pendingRolePromotions.delete(token);
  await ctx.answerCbQuery().catch(() => undefined);
  if (decision === "no") {
    await ctx.editMessageText("ارتقای مقام لغو شد.").catch(async () => { await ctx.reply("ارتقای مقام لغو شد."); });
    return true;
  }
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group || group.id !== pending.groupId) {
    await ctx.editMessageText("گروه موردنظر دیگر در دسترس نیست.").catch(() => undefined);
    return true;
  }
  const actorAccess = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  if (!hasAtLeastAccess(actorAccess, "group_admin") || !mayDelegateKronosRole({ actorAccess, actorIsSoleBotOwner: ctx.from.id === OWNER_TELEGRAM_ID, role: pending.role })) {
    await ctx.editMessageText("سطح دسترسی شما برای این ارتقای مقام کافی نیست.").catch(() => undefined);
    return true;
  }
  if (pending.role === "kronos_owner" && ctx.from.id !== OWNER_TELEGRAM_ID) {
    await ctx.editMessageText("نقش محافظت‌شدهٔ «مالک» فقط توسط مالک اصلی ربات قابل تغییر است.").catch(() => undefined);
    return true;
  }
  const db = await getDb();
  const currentRoles = db ? await db.select({ role: groupRoles.role }).from(groupRoles).where(and(eq(groupRoles.groupId, group.id), eq(groupRoles.telegramUserId, pending.targetTelegramUserId))) : [];
  const highestExistingRole = currentRoles
    .map(row => row.role)
    .filter((role): role is ManagedRole => role === "kronos_owner" || role === "moderator" || role === "vip")
    .sort((left, right) => roleRank(right) - roleRank(left))[0];
  if (highestExistingRole && roleRank(highestExistingRole) >= roleRank(pending.role)) {
    await ctx.editMessageText(roleNoOpMessage({ telegramUserId: pending.targetTelegramUserId, displayName: pending.targetDisplayName }, highestExistingRole, "add"), { parse_mode: "HTML" }).catch(() => undefined);
    return true;
  }
  await applyRoleChange({
    ctx,
    groupId: group.id,
    actorTelegramId: pending.actorTelegramUserId,
    actorDisplayName: pending.actorDisplayName,
    targetTelegramUserId: pending.targetTelegramUserId,
    targetDisplayName: pending.targetDisplayName,
    roles: [pending.role],
    action: "add",
  });
  const edited = await ctx.editMessageText("✅ ارتقای مقام تأیید شد.").catch(() => undefined);
  const callbackMessage = ctx.callbackQuery && "message" in ctx.callbackQuery ? ctx.callbackQuery.message : undefined;
  await deleteTemporaryCommandSuccess({ telegram: ctx.telegram, chatId: ctx.chat.id, messageId: telegramMessageId(edited) ?? telegramMessageId(callbackMessage) });
  return true;
}

/** Consumes a deliberate, short-lived confirmation before removing a complete internal-role list. */
export async function handleRoleCleanupConfirmation(ctx: Context): Promise<boolean> {
  const data = "callbackQuery" in ctx && ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
  const match = typeof data === "string" ? data.match(/^role-cleanup-confirm:(yes|no):([a-z0-9]{8,32})$/i) : null;
  if (!match || !ctx.from || !ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) return false;
  const [, decision, token] = match;
  const pending = pendingRoleCleanups.get(token);
  if (!pending || pending.expiresAt <= Date.now() || pending.actorTelegramUserId !== ctx.from.id || pending.groupChatId !== ctx.chat.id) {
    pendingRoleCleanups.delete(token);
    await ctx.answerCbQuery("این تأیید منقضی شده یا برای شما نیست.", { show_alert: true }).catch(() => undefined);
    return true;
  }
  pendingRoleCleanups.delete(token);
  await ctx.answerCbQuery().catch(() => undefined);
  if (decision === "no") {
    await ctx.editMessageText("پاکسازی نقش لغو شد.").catch(() => undefined);
    return true;
  }
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group || group.id !== pending.groupId) {
    await ctx.editMessageText("گروه موردنظر دیگر در دسترس نیست.").catch(() => undefined);
    return true;
  }
  const actorAccess = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  if (!hasAtLeastAccess(actorAccess, "group_admin") || !mayCleanRoleList({ actorAccess, actorTelegramId: ctx.from.id, role: pending.role })) {
    await ctx.editMessageText("سطح دسترسی شما برای پاکسازی این نقش کافی نیست.").catch(() => undefined);
    return true;
  }
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while cleaning group roles");
  const roleScope = cleanupRoleScope(pending.role);
  const members = await db.select({ telegramUserId: groupRoles.telegramUserId, role: groupRoles.role }).from(groupRoles).where(and(eq(groupRoles.groupId, group.id), inArray(groupRoles.role, [...roleScope])));
  await db.delete(groupRoles).where(and(eq(groupRoles.groupId, group.id), inArray(groupRoles.role, [...roleScope])));
  const suspendedAuthorityIds = Array.from(new Set(members.filter(member => member.role === "group_owner" || member.role === "group_admin").map(member => member.telegramUserId)));
  for (const telegramUserId of suspendedAuthorityIds) await suspendGroupAuthority({ groupId: group.id, telegramUserId, suspendedByTelegramId: ctx.from.id });
  if (pending.role === "vip") {
    for (const member of members) await removeVipProtectionPolicy(group.id, member.telegramUserId);
  }
  const cleanedAt = new Date();
  await writeAuditLog({ category: "role_management", event: `clear_${pending.role}`, groupId: group.id, actorTelegramId: ctx.from.id, details: { role: pending.role, requestedCount: pending.memberCount, removedRoles: roleScope, suspendedAuthorityCount: suspendedAuthorityIds.length, cleanedAt: cleanedAt.toISOString() } });
  await ctx.editMessageText(`✅ فهرست ${roleCleanupLabel(pending.role)} پاکسازی شد.\n\n<i>مقام Telegram تغییر نکرد؛ دسترسی Kronos Guard فقط با راه‌اندازی خودکار مالک بازمی‌گردد.</i>`, { parse_mode: "HTML" }).catch(() => undefined);
  if (pending.sourcePanelMessageId) {
    await ctx.telegram.editMessageText(ctx.chat.id, pending.sourcePanelMessageId, undefined, clearedRoleListText(pending.role, cleanedAt), { parse_mode: "HTML", reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
  }
  return true;
}

/** Starts the same confirmation flow from the cleanup button beneath a role-list panel. */
export async function handleRoleListCleanupCallback(ctx: Context): Promise<boolean> {
  const data = "callbackQuery" in ctx && ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
  const match = typeof data === "string" ? data.match(/^role-list-cleanup:(kronos_owner|moderator|vip)$/) : null;
  if (!match || !ctx.from || !ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) return false;
  const role = match[1] as RoleCleanupScope;
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) {
    await ctx.answerCbQuery("گروه در دسترس نیست.", { show_alert: true }).catch(() => undefined);
    return true;
  }
  const actorAccess = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  if (!hasAtLeastAccess(actorAccess, "group_admin")) {
    await ctx.answerCbQuery("اجازهٔ پاکسازی این فهرست را ندارید.", { show_alert: true }).catch(() => undefined);
    return true;
  }
  await ctx.answerCbQuery().catch(() => undefined);
  const sourcePanelMessage = ctx.callbackQuery && "message" in ctx.callbackQuery ? ctx.callbackQuery.message : undefined;
  await requestRoleCleanup({ ctx, groupId: group.id, groupChatId: ctx.chat.id, actorTelegramId: ctx.from.id, actorAccess, role, sourcePanelMessageId: sourcePanelMessage && "message_id" in sourcePanelMessage ? sourcePanelMessage.message_id : undefined });
  return true;
}

/** Renders a requested page from a manager or owner role-list panel. */
export async function handleRoleListPageCallback(ctx: Context): Promise<boolean> {
  const data = "callbackQuery" in ctx && ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
  const match = typeof data === "string" ? data.match(/^role-list-page:(kronos_owner|moderator):(\d{1,4})$/) : null;
  if (!match || !ctx.from || !ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) return false;
  const role = match[1] as Extract<ManagedRole, "kronos_owner" | "moderator">;
  const requestedPage = Number(match[2]);
  const group = await findGroupByChatId(ctx.chat.id);
  if (!group) {
    await ctx.answerCbQuery("گروه در دسترس نیست.", { show_alert: true }).catch(() => undefined);
    return true;
  }
  const actorAccess = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
  if (!hasAtLeastAccess(actorAccess, "group_admin")) {
    await ctx.answerCbQuery("اجازهٔ مشاهدهٔ این فهرست را ندارید.", { show_alert: true }).catch(() => undefined);
    return true;
  }
  await ctx.answerCbQuery().catch(() => undefined);
  await listManagedRoles(ctx, group.id, role, requestedPage, "edit");
  return true;
}
