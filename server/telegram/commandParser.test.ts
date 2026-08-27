import { describe, expect, it } from "vitest";
import { parseModerationCommand } from "./commandParser";

describe("slashless moderation parser", () => {
  it("parses composite mute durations, bare hours, permanent mute, and the safe خفه alias", () => {
    expect(parseModerationCommand("سکوت 2 30دقیقه 15ثانیه @member", false)).toMatchObject({ action: "mute", durationSeconds: 2 * 3600 + 30 * 60 + 15, target: { kind: "username", username: "member" } });
    expect(parseModerationCommand("سکوت دائمی @member", false)).toMatchObject({ action: "mute", permanentMute: true, target: { kind: "username", username: "member" } });
    expect(parseModerationCommand("خفه", true)).toBeUndefined();
    expect(parseModerationCommand("خفه @member", false)).toMatchObject({ action: "mute", target: { kind: "username", username: "member" } });
    expect(parseModerationCommand("خفه 5دقیقه", true)).toMatchObject({ action: "mute", durationSeconds: 300, target: { kind: "reply" } });
  });

  it("parses Persian aliases, reply targets, and durations deterministically", () => {
    expect(parseModerationCommand("سکوت 30دقیقه", true)).toEqual({
      action: "mute",
      sourceAlias: "سکوت",
      target: { kind: "reply" },
      durationSeconds: 1800,
      reason: undefined,
    });
  });

  it("keeps the سیک alias as a ban with its special response contract", () => {
    expect(parseModerationCommand("سیک 123456789", false)).toEqual({
      action: "ban",
      sourceAlias: "سیک",
      specialResponse: "sick_ban",
      target: { kind: "id", telegramUserId: 123456789 },
      durationSeconds: undefined,
      reason: undefined,
    });
  });

  it("accepts Persian numerals for supported numeric targets", () => {
    expect(parseModerationCommand("بن ۱۲۳۴۵۶۷۸۹", false)).toMatchObject({
      action: "ban",
      target: { kind: "id", telegramUserId: 123456789 },
    });
  });

  it("accepts leading and repeated spaces plus a compact Persian-digit target", () => {
    expect(parseModerationCommand("   بن۱۲۳۴۵۶۷۸۹  ", false)).toMatchObject({ action: "ban", target: { kind: "id", telegramUserId: 123456789 } });
    expect(parseModerationCommand("سکوت  ۲ماه", true)).toMatchObject({ action: "mute", durationSeconds: 60 * 24 * 60 * 60 });
  });

  it("accepts any supported warning count with Persian or English digits and optional spacing", () => {
    const variants = ["اخطار ۳", "اخطار۳", "اخطار 3", "اخطار3"];
    for (const input of variants) {
      expect(parseModerationCommand(input, true)).toMatchObject({
        action: "warn",
        target: { kind: "reply" },
        warningAdditionCount: 3,
      });
    }
    expect(parseModerationCommand("اخطار۲۷", true)).toMatchObject({ action: "warn", warningAdditionCount: 27 });
    expect(parseModerationCommand("اخطار 27", true)).toMatchObject({ action: "warn", warningAdditionCount: 27 });
  });

  it("leaves a self-panel target empty so the handler can safely use the sender", () => {
    expect(parseModerationCommand("پنل کاربر", false)).toMatchObject({
      action: "panel",
      sourceAlias: "پنل کاربر",
      target: undefined,
      reason: undefined,
    });
    expect(parseModerationCommand("/پنل", false)).toMatchObject({
      action: "panel",
      target: undefined,
    });
  });

  it("supports English and multiword Persian commands without accepting unrelated text", () => {
    expect(parseModerationCommand("ban @member 2h", false)).toMatchObject({ action: "ban", target: { kind: "username", username: "member" }, durationSeconds: 7200, reason: undefined });
    expect(parseModerationCommand("رفع مسدودیت 123456789", false)).toMatchObject({ action: "unban", target: { kind: "id", telegramUserId: 123456789 } });
    expect(parseModerationCommand("حذف بن 123456789", false)).toMatchObject({ action: "unban", target: { kind: "id", telegramUserId: 123456789 } });
    expect(parseModerationCommand("this is a normal group message", false)).toBeUndefined();
  });

  it("supports bounded month and year mute durations plus the explicit حذف سکوت command", () => {
    expect(parseModerationCommand("سکوت ۲ماه", true)).toMatchObject({ action: "mute", target: { kind: "reply" }, durationSeconds: 60 * 24 * 60 * 60, reason: undefined });
    expect(parseModerationCommand("mute @member 3years", false)).toMatchObject({ action: "mute", target: { kind: "username", username: "member" }, durationSeconds: 365 * 24 * 60 * 60 });
    expect(parseModerationCommand("حذف سکوت", true)).toMatchObject({ action: "unmute", target: { kind: "reply" }, durationSeconds: undefined });
  });

  it("ignores conversational lookalikes and accepts only exact command grammar", () => {
    expect(parseModerationCommand("بن کنین اینو", false)).toBeUndefined();
    expect(parseModerationCommand("سکوتش کنید", false)).toBeUndefined();
    expect(parseModerationCommand("حذف سکوت لطفاً", true)).toBeUndefined();
    expect(parseModerationCommand("بن @member تبلیغ", false)).toBeUndefined();
    expect(parseModerationCommand("بن @member", false)).toMatchObject({ action: "ban", target: { kind: "username", username: "member" } });
    expect(parseModerationCommand("سکوت 123456789 2h", false)).toMatchObject({ action: "mute", target: { kind: "id", telegramUserId: 123456789 }, durationSeconds: 7200 });
  });
});
