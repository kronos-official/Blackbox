import { describe, expect, it } from "vitest";
import { claimGroupEventKey, claimProtectionPrivateDelivery, collectDashboardEventRecipientIds, collectGroupEventRecipientIds, eventDefinition, formatGroupEventBody, formatGroupEventTimestamp } from "./groupEventNotifier";

describe("group event notifier contract", () => {
  it("classifies known events into stable Mini App categories", () => {
    expect(eventDefinition("member.joined")).toEqual({ category: "membership", title: "ورود عضو به گروه" });
    expect(eventDefinition("moderation.ban")).toEqual({ category: "moderation", title: "مسدودسازی عضو" });
    expect(eventDefinition("group.title_changed")).toEqual({ category: "metadata", title: "تغییر نام گروه" });
  });

  it("renders the actor mention, numeric ID and exact Tehran timestamp with English digits", () => {
    const occurredAt = new Date("2026-08-20T06:32:03.000Z");
    const body = formatGroupEventBody({
      definition: eventDefinition("moderation.ban"),
      groupTitle: "گروه <آزمایشی>",
      actor: { telegramUserId: 101, displayName: "مدیر <اصلی>" },
      subject: { telegramUserId: 202, displayName: "عضو هدف" },
      details: { reason: "تخلف <مکرر>" },
      occurredAt,
    });
    expect(body).toContain('<a href="tg://user?id=101">مدیر &lt;اصلی&gt;</a>');
    expect(body).toContain("<code>101</code>");
    expect(body).toContain('<a href="tg://user?id=202">عضو هدف</a>');
    expect(body).toContain("تخلف &lt;مکرر&gt;");
    expect(body).toContain("پنجشنبه 29 مرداد 1405، 10:02:03");
    expect(body).not.toMatch(/[۰-۹]/);
  });

  it("includes every authorized source once and excludes the actor from recipients", () => {
    const recipients = collectGroupEventRecipientIds({
      groupOwnerId: 10,
      telegramAdminIds: [10, 11, 12],
      kronosRoleIds: [11, 13, 14],
      globalAdminIds: [12, 14, 15],
      actorTelegramId: 11,
      botOwnerId: 15,
    });
    expect(recipients.sort((a, b) => a - b)).toEqual([10, 12, 13, 14, 15]);
    expect(recipients).not.toContain(11);
  });

  it("keeps self-notification disabled while retaining an actor-owned activity record in the Mini App", () => {
    const privateRecipients = collectGroupEventRecipientIds({
      groupOwnerId: 11,
      telegramAdminIds: [11, 12],
      kronosRoleIds: [],
      globalAdminIds: [],
      actorTelegramId: 11,
      botOwnerId: 13,
    });
    expect(privateRecipients.sort((a, b) => a - b)).toEqual([12, 13]);
    expect(collectDashboardEventRecipientIds(privateRecipients, 11, true).sort((a, b) => a - b)).toEqual([11, 12, 13]);
    expect(collectDashboardEventRecipientIds(privateRecipients, 11, false).sort((a, b) => a - b)).toEqual([12, 13]);
  });

  it("keeps a fixed full Tehran timestamp format for direct card rendering", () => {
    expect(formatGroupEventTimestamp(new Date("2026-08-20T06:32:03.000Z"))).toBe("پنجشنبه 29 مرداد 1405، 10:02:03");
  });

  it("suppresses a repeated event key during the webhook deduplication window", () => {
    const firstMoment = new Date("2026-08-20T06:32:03.000Z");
    expect(claimGroupEventKey("event:group-1:member-2", firstMoment)).toBe(true);
    expect(claimGroupEventKey("event:group-1:member-2", new Date(firstMoment.getTime() + 9_999))).toBe(false);
    expect(claimGroupEventKey("event:group-1:member-2", new Date(firstMoment.getTime() + 10_000))).toBe(true);
  });

  it("keeps important protection events auditable but throttles their repeated private delivery", () => {
    const firstMoment = new Date("2026-08-20T06:32:03.000Z");
    expect(claimProtectionPrivateDelivery("group-1:protection.anti_spam", 60, firstMoment)).toBe(true);
    expect(claimProtectionPrivateDelivery("group-1:protection.anti_spam", 60, new Date(firstMoment.getTime() + 59_999))).toBe(false);
    expect(claimProtectionPrivateDelivery("group-1:protection.anti_spam", 60, new Date(firstMoment.getTime() + 60_000))).toBe(true);
  });
});
