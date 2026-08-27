import { describe, expect, it } from "vitest";
import { canChangeSupportTicketStatus, formatSupportNotificationEventNote, formatSupportReplyNotification, hasReachedActiveTicketLimit, isSupportTicketClosed, isValidSupportAttachmentUrl, normalizeSupportRequester, supportNotificationForLocale } from "./supportRouter";

const locales = ["fa", "en", "ar", "tr", "ru", "es", "fr", "pt", "it", "de", "pl", "vi"];

describe("support attachment validation", () => {
  it("accepts project storage paths and HTTPS URLs while rejecting invalid values", () => {
    expect(isValidSupportAttachmentUrl("/manus-storage/support/file.pdf")).toBe(true);
    expect(isValidSupportAttachmentUrl("https://cdn.example.com/file.pdf")).toBe(true);
    expect(isValidSupportAttachmentUrl("not-a-url")).toBe(false);
    expect(isValidSupportAttachmentUrl("http://insecure.example.com/file.pdf")).toBe(false);
  });
});

describe("support requester identity", () => {
  it("preserves username and numeric Telegram ID from the directory record", () => {
    expect(normalizeSupportRequester({ telegramUserId: 8618912202, username: "kronos_user", firstName: "Kronos" }, 1)).toEqual({ telegramUserId: 8618912202, username: "kronos_user", firstName: "Kronos", lastName: null });
  });

  it("keeps the ticket requester ID when the directory record is unavailable", () => {
    expect(normalizeSupportRequester(null, 8375579910)).toEqual({ telegramUserId: 8375579910, username: null, firstName: null, lastName: null });
  });
});

describe("support ticket limits", () => {
  it("allows at most two active tickets and ignores resolved or closed tickets", () => {
    expect(hasReachedActiveTicketLimit(["open"])).toBe(false);
    expect(hasReachedActiveTicketLimit(["open", "in_progress"])).toBe(true);
    expect(hasReachedActiveTicketLimit(["resolved", "closed", "open"])).toBe(false);
  });
});

describe("support ticket closure semantics", () => {
  it("locks only closed tickets while resolved tickets remain replyable", () => {
    expect(isSupportTicketClosed("closed")).toBe(true);
    expect(isSupportTicketClosed("resolved")).toBe(false);
    expect(isSupportTicketClosed("waiting_user")).toBe(false);
  });

  it("never permits a closed ticket to transition again", () => {
    expect(canChangeSupportTicketStatus("closed", "open", true)).toBe(false);
    expect(canChangeSupportTicketStatus("closed", "closed", false)).toBe(false);
  });

  it("allows owners to manage open tickets and requesters to close only", () => {
    expect(canChangeSupportTicketStatus("resolved", "waiting_user", true)).toBe(true);
    expect(canChangeSupportTicketStatus("resolved", "closed", false)).toBe(true);
    expect(canChangeSupportTicketStatus("resolved", "open", false)).toBe(false);
  });
});

describe("support notification localization", () => {
  it("provides complete ticket notification copy for every supported locale", () => {
    for (const locale of locales) {
      const copy = supportNotificationForLocale(locale);
      expect(copy.newTicket).not.toHaveLength(0);
      expect(copy.newReply).not.toHaveLength(0);
      expect(copy.changed).not.toHaveLength(0);
      expect(copy.openPanel).not.toHaveLength(0);
      for (const status of ["open", "in_progress", "waiting_user", "resolved", "closed"]) {
        expect(copy.statuses[status]).not.toHaveLength(0);
      }
    }
  });

  it("formats a direct reply notification for the ticket requester", () => {
    const notification = formatSupportReplyNotification("fa", "KG-T-ABC123", "پاسخ شما آماده شد.", "waiting_user");
    expect(notification).toContain("پاسخ جدید برای تیکت KG-T-ABC123");
    expect(notification).toContain("پاسخ شما آماده شد.");
    expect(notification).toContain("در انتظار پاسخ کاربر");
  });

  it("describes attachment-only replies instead of sending a blank notification", () => {
    const notification = formatSupportReplyNotification("en", "KG-T-FILE01", "", "waiting_user", 2);
    expect(notification).toContain("📎 2 attachments");
    expect(notification).toContain("Waiting for user");
  });

  it("falls back safely to Persian for an unknown locale", () => {
    expect(supportNotificationForLocale("xx").newTicket).toBe("تیکت جدید");
  });

  it("persists a deterministic notification delivery marker in ticket events", () => {
    expect(formatSupportNotificationEventNote("موضوع", "delivered")).toBe("موضوع\nnotification:delivered");
    expect(formatSupportNotificationEventNote(null, "failed")).toBe("notification:failed");
    expect(formatSupportNotificationEventNote(undefined, "not_applicable")).toBe("notification:not_applicable");
  });
});
