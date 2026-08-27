import { describe, expect, it } from "vitest";
import { compactNotificationBody, groupSimilarNotifications } from "./notificationCompact";

describe("compactNotificationBody", () => {
  it("extracts the compact fields from the new label-based group event body", () => {
    const result = compactNotificationBody(`<b>◆ تغییر لقب</b>
<code>گروه</code> │ <b>Kronos Guard</b>
<code>انجام‌دهنده</code> │ <a href="tg://user?id=101">مدیر گروه</a>
<code>شناسه</code> │ <code>101</code>
<code>هدف</code> │ <a href="tg://user?id=202">کاربر هدف</a>
<code>شناسهٔ هدف</code> │ <code>202</code>
<code>جزئیات</code> │ لقب از «قدیمی» به «جدید» تغییر کرد.
<code>زمان تهران</code> │ <b>پنجشنبه 29 مرداد 1405، 21:02:53</b>`);

    expect(result).toMatchObject({
      actor: "مدیر گروه",
      actorId: "101",
      target: "کاربر هدف",
      targetId: "202",
      summary: "لقب از «قدیمی» به «جدید» تغییر کرد.",
      tehranTime: "پنجشنبه 29 مرداد 1405، 21:02:53",
    });
  });

  it("turns a verbose Persian group event into a small actor-target summary", () => {
    const result = compactNotificationBody("ورود عضو به گروه 👥 گروه: <b>𝐊𝐃 𝐈𝐬𝐥𝐚𝐧𝐝 𝐆𝐩</b> 👤 انجام‌دهنده: <a href=\"tg://user?id=7503294474\">parnian</a> 🆔 شناسهٔ انجام‌دهنده: 7503294474 🎯 کاربر/هدف: parnian 🆔 شناسهٔ هدف: 7503294474 📌 جزئیات: عضو با ورود مستقیم به گروه اضافه شد. 🕰 زمان تهران: پنجشنبه 29 مرداد 1405، 21:02:53");

    expect(result).toMatchObject({
      actor: "parnian",
      actorId: "7503294474",
      target: "parnian",
      targetId: "7503294474",
      summary: "عضو با ورود مستقیم به گروه اضافه شد.",
      tehranTime: "پنجشنبه 29 مرداد 1405، 21:02:53",
    });
  });

  it("keeps an understandable short fallback when a legacy notification has no structured fields", () => {
    expect(compactNotificationBody("یک رویداد قدیمی بدون فیلد ساختاریافته").summary).toBe("یک رویداد قدیمی بدون فیلد ساختاریافته");
  });

  it("groups recent repeated events for the same group and actor while preserving unrelated activity", () => {
    const body = "👤 انجام‌دهنده: parnian 🆔 شناسهٔ انجام‌دهنده: 7503294474 📌 جزئیات: رویداد ثبت شد.";
    const grouped = groupSimilarNotifications([
      { id: 3, eventType: "member.joined", relatedGroupId: -1001, body, createdAt: new Date("2026-08-20T18:00:00.000Z"), isRead: false },
      { id: 2, eventType: "member.joined", relatedGroupId: -1001, body, createdAt: new Date("2026-08-20T17:58:00.000Z"), isRead: true },
      { id: 1, eventType: "member.joined", relatedGroupId: -1002, body, createdAt: new Date("2026-08-20T17:57:00.000Z"), isRead: false },
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0]?.items.map(item => item.id)).toEqual([3, 2]);
    expect(grouped[1]?.items.map(item => item.id)).toEqual([1]);
  });
});
