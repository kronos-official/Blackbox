import { TRPCError } from "@trpc/server";
import { storagePut } from "../storage";
import { and, desc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { supportTicketEvents, supportTicketMessages, supportTickets, telegramUsers } from "../../drizzle/schema";
import { getDb } from "../db";
import { getTelegramBot } from "../telegram/bot";
import { OWNER_TELEGRAM_ID } from "../telegram/constants";
import { getPreferredLocale, writeAuditLog } from "../telegram/repository";
import { router } from "../_core/trpc";

const ticketCategory = z.enum(["technical", "moderation", "payment", "account", "suggestion", "other"]);
const ticketPriority = z.enum(["low", "normal", "high", "urgent"]);
const ticketStatus = z.enum(["open", "in_progress", "waiting_user", "resolved", "closed"]);
const bodyInput = z.string().trim().max(5000).default("");
export function isValidSupportAttachmentUrl(value: string) { return /^\/manus-storage\/[A-Za-z0-9._\/-]+$/.test(value) || /^https:\/\//i.test(value); }
const attachmentInput = z.object({ key: z.string().min(1).max(512), url: z.string().min(1).max(2048).refine(isValidSupportAttachmentUrl, "Attachment URL must be a secure storage path or HTTPS URL"), name: z.string().min(1).max(255), contentType: z.string().min(1).max(128), size: z.number().int().positive().max(8 * 1024 * 1024) });
const attachmentsInput = z.array(attachmentInput).max(5).default([]);
const attachmentUploadInput = z.object({ fileName: z.string().trim().min(1).max(255), contentType: z.string().trim().min(1).max(128), dataBase64: z.string().min(1).max(12 * 1024 * 1024) });
export const MAX_ACTIVE_SUPPORT_TICKETS = 2;
export function hasReachedActiveTicketLimit(statuses: string[]) { return statuses.filter(status => ["open", "in_progress", "waiting_user"].includes(status)).length >= MAX_ACTIVE_SUPPORT_TICKETS; }
export function isSupportTicketClosed(status: string | null | undefined) { return status === "closed"; }
export function normalizeSupportRequester(requester: { telegramUserId?: number | null; username?: string | null; firstName?: string | null; lastName?: string | null } | null | undefined, fallbackTelegramUserId: number) {
  return {
    telegramUserId: requester?.telegramUserId ?? fallbackTelegramUserId,
    username: requester?.username ?? null,
    firstName: requester?.firstName ?? null,
    lastName: requester?.lastName ?? null,
  };
}
export function canChangeSupportTicketStatus(currentStatus: string | null | undefined, nextStatus: string, actorIsOwner: boolean) {
  if (isSupportTicketClosed(currentStatus)) return false;
  return actorIsOwner || nextStatus === "closed";
}

function ticketId() {
  return `KG-T-${nanoid(10).toUpperCase()}`;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Support service is temporarily unavailable" });
  return db;
}

async function notifyTelegram(telegramId: number, text: string) {
  const bot = getTelegramBot();
  if (!bot) return false;
  try {
    await bot.telegram.sendMessage(telegramId, text);
    return true;
  } catch (error) {
    console.warn("[Kronos Guard] support notification failed", { telegramId, error: error instanceof Error ? error.message : "unknown" });
    return false;
  }
}

async function readTicket(db: Awaited<ReturnType<typeof requireDb>>, publicId: string) {
  return (await db.select().from(supportTickets).where(eq(supportTickets.publicId, publicId)).limit(1))[0];
}

async function ensureOwnerOrRequester(ticket: { requesterTelegramId: number }, actorTelegramId: number) {
  if (actorTelegramId !== OWNER_TELEGRAM_ID && ticket.requesterTelegramId !== actorTelegramId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This ticket belongs to another Telegram account" });
  }
}

function ticketEventType(status: string) {
  return status === "closed" ? "closed" as const : status === "open" ? "reopened" as const : "status_changed" as const;
}

const supportNotificationCopy: Record<string, { newTicket: string; subject: string; priority: string; requester: string; openPanel: string; newReply: string; newStatus: string; changed: string; note: string; statuses: Record<string, string> }> = {
  fa: { newTicket: "تیکت جدید", subject: "موضوع", priority: "اولویت", requester: "کاربر", openPanel: "برای بررسی، مرکز پشتیبانی Mini App را باز کنید.", newReply: "پاسخ جدید برای تیکت", newStatus: "وضعیت جدید", changed: "وضعیت تیکت تغییر کرد.", note: "توضیح", statuses: { open: "باز", in_progress: "در حال بررسی", waiting_user: "در انتظار پاسخ کاربر", resolved: "حل‌شده", closed: "بسته‌شده" } },
  en: { newTicket: "New ticket", subject: "Subject", priority: "Priority", requester: "User", openPanel: "Open the Support Center in the Mini App to review it.", newReply: "New reply for ticket", newStatus: "New status", changed: "Ticket status changed.", note: "Note", statuses: { open: "Open", in_progress: "In progress", waiting_user: "Waiting for user", resolved: "Resolved", closed: "Closed" } },
  ar: { newTicket: "تذكرة جديدة", subject: "الموضوع", priority: "الأولوية", requester: "المستخدم", openPanel: "افتح مركز الدعم في التطبيق المصغر للمراجعة.", newReply: "رد جديد على التذكرة", newStatus: "الحالة الجديدة", changed: "تم تغيير حالة التذكرة.", note: "ملاحظة", statuses: { open: "مفتوحة", in_progress: "قيد المراجعة", waiting_user: "بانتظار المستخدم", resolved: "تم الحل", closed: "مغلقة" } },
  tr: { newTicket: "Yeni destek talebi", subject: "Konu", priority: "Öncelik", requester: "Kullanıcı", openPanel: "İncelemek için Mini App Destek Merkezi'ni açın.", newReply: "Talebe yeni yanıt", newStatus: "Yeni durum", changed: "Talep durumu değişti.", note: "Not", statuses: { open: "Açık", in_progress: "İnceleniyor", waiting_user: "Kullanıcı bekleniyor", resolved: "Çözüldü", closed: "Kapalı" } },
  ru: { newTicket: "Новая заявка", subject: "Тема", priority: "Приоритет", requester: "Пользователь", openPanel: "Откройте центр поддержки в Mini App для проверки.", newReply: "Новый ответ по заявке", newStatus: "Новый статус", changed: "Статус заявки изменён.", note: "Примечание", statuses: { open: "Открыта", in_progress: "В работе", waiting_user: "Ожидание пользователя", resolved: "Решена", closed: "Закрыта" } },
  es: { newTicket: "Nuevo ticket", subject: "Asunto", priority: "Prioridad", requester: "Usuario", openPanel: "Abre el centro de soporte en la Mini App para revisarlo.", newReply: "Nueva respuesta para el ticket", newStatus: "Nuevo estado", changed: "El estado del ticket cambió.", note: "Nota", statuses: { open: "Abierto", in_progress: "En revisión", waiting_user: "Esperando al usuario", resolved: "Resuelto", closed: "Cerrado" } },
  fr: { newTicket: "Nouveau ticket", subject: "Sujet", priority: "Priorité", requester: "Utilisateur", openPanel: "Ouvrez le centre d’assistance dans la Mini App pour le traiter.", newReply: "Nouvelle réponse au ticket", newStatus: "Nouveau statut", changed: "Le statut du ticket a changé.", note: "Note", statuses: { open: "Ouvert", in_progress: "En cours", waiting_user: "En attente", resolved: "Résolu", closed: "Fermé" } },
  pt: { newTicket: "Novo chamado", subject: "Assunto", priority: "Prioridade", requester: "Usuário", openPanel: "Abra a central de suporte no Mini App para revisar.", newReply: "Nova resposta ao chamado", newStatus: "Novo status", changed: "O status do chamado mudou.", note: "Nota", statuses: { open: "Aberto", in_progress: "Em análise", waiting_user: "Aguardando usuário", resolved: "Resolvido", closed: "Fechado" } },
  it: { newTicket: "Nuovo ticket", subject: "Oggetto", priority: "Priorità", requester: "Utente", openPanel: "Apri il centro assistenza nella Mini App per esaminarlo.", newReply: "Nuova risposta al ticket", newStatus: "Nuovo stato", changed: "Lo stato del ticket è cambiato.", note: "Nota", statuses: { open: "Aperto", in_progress: "In lavorazione", waiting_user: "In attesa dell’utente", resolved: "Risolto", closed: "Chiuso" } },
  de: { newTicket: "Neues Ticket", subject: "Betreff", priority: "Priorität", requester: "Benutzer", openPanel: "Öffnen Sie das Support-Center in der Mini App zur Prüfung.", newReply: "Neue Antwort zum Ticket", newStatus: "Neuer Status", changed: "Der Ticketstatus wurde geändert.", note: "Notiz", statuses: { open: "Offen", in_progress: "In Bearbeitung", waiting_user: "Warten auf Benutzer", resolved: "Gelöst", closed: "Geschlossen" } },
  pl: { newTicket: "Nowe zgłoszenie", subject: "Temat", priority: "Priorytet", requester: "Użytkownik", openPanel: "Otwórz centrum pomocy w Mini App, aby je sprawdzić.", newReply: "Nowa odpowiedź do zgłoszenia", newStatus: "Nowy status", changed: "Status zgłoszenia został zmieniony.", note: "Notatka", statuses: { open: "Otwarte", in_progress: "W toku", waiting_user: "Oczekiwanie na użytkownika", resolved: "Rozwiązane", closed: "Zamknięte" } },
  vi: { newTicket: "Yêu cầu mới", subject: "Chủ đề", priority: "Ưu tiên", requester: "Người dùng", openPanel: "Mở Trung tâm hỗ trợ trong Mini App để xem xét.", newReply: "Phản hồi mới cho yêu cầu", newStatus: "Trạng thái mới", changed: "Trạng thái yêu cầu đã thay đổi.", note: "Ghi chú", statuses: { open: "Đang mở", in_progress: "Đang xử lý", waiting_user: "Chờ người dùng", resolved: "Đã giải quyết", closed: "Đã đóng" } },
};

export function supportNotificationForLocale(locale: string) {
  return supportNotificationCopy[locale] ?? supportNotificationCopy.fa;
}

export function formatSupportReplyNotification(locale: string, publicId: string, body: string, status: string, attachmentCount = 0) {
  const copy = supportNotificationForLocale(locale);
  const messageBody = body.trim() || (attachmentCount > 0 ? `📎 ${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}` : "—");
  return `💬 ${copy.newReply} ${publicId}\n${messageBody}\n${copy.newStatus}: ${copy.statuses[status] ?? status}`;
}

export function formatSupportNotificationEventNote(note: string | null | undefined, outcome: "delivered" | "failed" | "not_applicable") {
  return `${note ?? ""}${note ? "\n" : ""}notification:${outcome}`;
}

async function ticketLocale(telegramId: number) {
  return supportNotificationForLocale(await getPreferredLocale(telegramId));
}

export function createSupportRouter(procedures: { dashboardProcedure: any; ownerProcedure: any }) {
  const { dashboardProcedure, ownerProcedure } = procedures;
  return router({
    mine: dashboardProcedure.query(async ({ ctx }: any) => {
      const db = await requireDb();
      return db.select().from(supportTickets).where(eq(supportTickets.requesterTelegramId, ctx.actor.telegramUserId)).orderBy(desc(supportTickets.updatedAt));
    }),
    detail: dashboardProcedure.input(z.object({ publicId: z.string().min(4).max(32) })).query(async ({ ctx, input }: any) => {
      const db = await requireDb();
      const ticket = await readTicket(db, input.publicId);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      await ensureOwnerOrRequester(ticket, ctx.actor.telegramUserId);
      const [messages, events, requesterRows] = await Promise.all([
        db.select().from(supportTicketMessages).where(eq(supportTicketMessages.ticketId, ticket.id)).orderBy(supportTicketMessages.createdAt),
        db.select().from(supportTicketEvents).where(eq(supportTicketEvents.ticketId, ticket.id)).orderBy(desc(supportTicketEvents.createdAt)),
        db.select({ telegramUserId: telegramUsers.telegramUserId, username: telegramUsers.username, firstName: telegramUsers.firstName, lastName: telegramUsers.lastName }).from(telegramUsers).where(eq(telegramUsers.telegramUserId, ticket.requesterTelegramId)).limit(1),
      ]);
      return { ticket, messages, events, requester: normalizeSupportRequester(requesterRows[0], ticket.requesterTelegramId) };
    }),
    uploadAttachment: dashboardProcedure.input(attachmentUploadInput).mutation(async ({ ctx, input }: any) => {
      const allowed = /^(image\/(jpeg|png|gif|webp)|application\/pdf|text\/plain|application\/zip)$/i.test(input.contentType);
      if (!allowed) throw new TRPCError({ code: "BAD_REQUEST", message: "This file type is not supported" });
      const raw = input.dataBase64.replace(/^data:[^;]+;base64,/, "");
      const data = Buffer.from(raw, "base64");
      if (!data.length || data.length > 8 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "Attachment must be smaller than 8 MB" });
      const uploaded = await storagePut(`support/${ctx.actor.telegramUserId}/${nanoid(12)}-${input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`, data, input.contentType);
      return { ...uploaded, name: input.fileName, contentType: input.contentType, size: data.length };
    }),
    create: dashboardProcedure.input(z.object({ subject: z.string().trim().min(3).max(255), category: ticketCategory, priority: ticketPriority, body: bodyInput, attachments: attachmentsInput }).refine(value => value.body.trim().length > 0 || value.attachments.length > 0, { message: "Add a message or attachment" })).mutation(async ({ ctx, input }: any) => {
      const db = await requireDb();
      const active = await db.select({ id: supportTickets.id, status: supportTickets.status }).from(supportTickets).where(and(eq(supportTickets.requesterTelegramId, ctx.actor.telegramUserId), inArray(supportTickets.status, ["open", "in_progress", "waiting_user"]))).limit(3);
      if (hasReachedActiveTicketLimit(active.map(ticket => ticket.status ?? "open"))) throw new TRPCError({ code: "CONFLICT", message: "You can have at most two active tickets" });
      const publicId = ticketId();
      const inserted = await db.insert(supportTickets).values({ publicId, requesterTelegramId: ctx.actor.telegramUserId, subject: input.subject, category: input.category, priority: input.priority, status: "open" });
      const id = Number(inserted[0].insertId);
      await db.insert(supportTicketMessages).values({ ticketId: id, authorTelegramId: ctx.actor.telegramUserId, authorRole: "user", body: input.body || "[Attachment]", attachments: input.attachments });
      await writeAuditLog({ category: "support", event: "ticket_created", actorTelegramId: ctx.actor.telegramUserId, details: { publicId, category: input.category, priority: input.priority } });
      const ownerCopy = await ticketLocale(OWNER_TELEGRAM_ID);
      const notificationDelivered = await notifyTelegram(OWNER_TELEGRAM_ID, `🎫 ${ownerCopy.newTicket} ${publicId}\n${ownerCopy.subject}: ${input.subject}\n${ownerCopy.priority}: ${input.priority}\n${ownerCopy.requester}: ${ctx.actor.telegramUserId}\n${ownerCopy.openPanel}`);
      await db.insert(supportTicketEvents).values({ ticketId: id, actorTelegramId: ctx.actor.telegramUserId, eventType: "created", toStatus: "open", note: formatSupportNotificationEventNote(input.subject, notificationDelivered ? "delivered" : "failed") });
      return { publicId, notificationDelivered };
    }),
    reply: dashboardProcedure.input(z.object({ publicId: z.string().min(4).max(32), body: bodyInput, attachments: attachmentsInput }).refine(value => value.body.trim().length > 0 || value.attachments.length > 0, { message: "Add a message or attachment" })).mutation(async ({ ctx, input }: any) => {
      const db = await requireDb();
      const ticket = await readTicket(db, input.publicId);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      await ensureOwnerOrRequester(ticket, ctx.actor.telegramUserId);
      if (isSupportTicketClosed(ticket.status)) throw new TRPCError({ code: "CONFLICT", message: "This ticket is closed and cannot receive new messages" });
      const authorRole = ctx.actor.telegramUserId === OWNER_TELEGRAM_ID ? "owner" : "user";
      await db.insert(supportTicketMessages).values({ ticketId: ticket.id, authorTelegramId: ctx.actor.telegramUserId, authorRole, body: input.body || "[Attachment]", attachments: input.attachments });
      const nextStatus = authorRole === "owner" ? "waiting_user" : "open";
      await db.update(supportTickets).set({ status: nextStatus, lastMessageAt: new Date(), closedAt: null }).where(eq(supportTickets.id, ticket.id));
      const recipient = authorRole === "owner" ? ticket.requesterTelegramId : OWNER_TELEGRAM_ID;
      const notificationDelivered = await notifyTelegram(recipient, formatSupportReplyNotification(await getPreferredLocale(recipient), ticket.publicId, input.body, nextStatus, input.attachments.length));
      await db.insert(supportTicketEvents).values({ ticketId: ticket.id, actorTelegramId: ctx.actor.telegramUserId, eventType: "replied", fromStatus: ticket.status, toStatus: nextStatus, note: formatSupportNotificationEventNote(null, notificationDelivered ? "delivered" : "failed") });
      return { success: true, status: nextStatus, notificationDelivered };
    }),
    setStatus: dashboardProcedure.input(z.object({ publicId: z.string().min(4).max(32), status: ticketStatus, note: z.string().trim().max(1000).optional() })).mutation(async ({ ctx, input }: any) => {
      const db = await requireDb();
      const ticket = await readTicket(db, input.publicId);
      if (!ticket) throw new TRPCError({ code: "NOT_FOUND", message: "Ticket not found" });
      await ensureOwnerOrRequester(ticket, ctx.actor.telegramUserId);
      const actorIsOwner = ctx.actor.telegramUserId === OWNER_TELEGRAM_ID;
      if (!canChangeSupportTicketStatus(ticket.status, input.status, actorIsOwner)) throw new TRPCError({ code: isSupportTicketClosed(ticket.status) ? "CONFLICT" : "FORBIDDEN", message: isSupportTicketClosed(ticket.status) ? "Closed tickets cannot be reopened or changed" : "Users can only close their own ticket" });
      await db.update(supportTickets).set({ status: input.status, closedAt: input.status === "closed" ? new Date() : ticket.closedAt }).where(eq(supportTickets.id, ticket.id));
      let notificationDelivered = true;
      if (ctx.actor.telegramUserId === OWNER_TELEGRAM_ID) { const requesterCopy = await ticketLocale(ticket.requesterTelegramId); notificationDelivered = await notifyTelegram(ticket.requesterTelegramId, `📌 ${requesterCopy.changed}\n${requesterCopy.newStatus}: ${requesterCopy.statuses[input.status] ?? input.status}${input.note ? `\n${requesterCopy.note}: ${input.note}` : ""}`); }
      await db.insert(supportTicketEvents).values({ ticketId: ticket.id, actorTelegramId: ctx.actor.telegramUserId, eventType: ticketEventType(input.status), fromStatus: ticket.status, toStatus: input.status, note: formatSupportNotificationEventNote(input.note, ctx.actor.telegramUserId === OWNER_TELEGRAM_ID ? (notificationDelivered ? "delivered" : "failed") : "not_applicable") });
      return { success: true, status: input.status, notificationDelivered };
    }),
    owner: ownerProcedure.query(async () => {
      const db = await requireDb();
      const tickets = await db.select().from(supportTickets).orderBy(desc(supportTickets.updatedAt));
      const requesterIds = Array.from(new Set(tickets.map(ticket => ticket.requesterTelegramId)));
      const users = requesterIds.length ? await db.select({ telegramUserId: telegramUsers.telegramUserId, firstName: telegramUsers.firstName, username: telegramUsers.username }).from(telegramUsers).where(inArray(telegramUsers.telegramUserId, requesterIds)) : [];
      const userMap = new Map(users.map(user => [user.telegramUserId, user]));
      return tickets.map(ticket => ({ ...ticket, requester: userMap.get(ticket.requesterTelegramId) ?? null }));
    }),
  });
}
