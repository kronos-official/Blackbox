import { describe, expect, it } from "vitest";
import { parseRoleCommand } from "./roleManagement";

describe("slashless moderator and VIP command parser", () => {
  it("parses Persian and English moderator and VIP management commands", () => {
    expect(parseRoleCommand("افزودن مدیر @KronosMember")).toEqual({ role: "moderator", action: "add", target: { kind: "username", username: "KronosMember" } });
    expect(parseRoleCommand("عزل ویژه 123456789")).toEqual({ role: "vip", action: "remove", target: { kind: "id", telegramUserId: 123456789 } });
    expect(parseRoleCommand("حذف مدیر @KronosMember")).toEqual({ role: "moderator", action: "remove", target: { kind: "username", username: "KronosMember" } });
    expect(parseRoleCommand("حذف مالک 123456789")).toEqual({ role: "kronos_owner", action: "remove", target: { kind: "id", telegramUserId: 123456789 } });
    expect(parseRoleCommand("عزل @KronosMember")).toEqual({ role: "all", action: "remove", target: { kind: "username", username: "KronosMember" } });
    expect(parseRoleCommand("list moderators")).toEqual({ role: "moderator", action: "list" });
    expect(parseRoleCommand("لیست کاربران ویژه")).toEqual({ role: "vip", action: "list" });
    expect(parseRoleCommand("لیست مالکان")).toEqual({ role: "kronos_owner", action: "list" });
  });

  it("requires an exact role command and a single valid target unless replying", () => {
    expect(parseRoleCommand("تنظیم مدیر @KronosMember")).toEqual({ role: "moderator", action: "add", target: { kind: "username", username: "KronosMember" } });
    expect(parseRoleCommand("تنظیم مدیر کنین @KronosMember")).toBeUndefined();
    expect(parseRoleCommand("حذف ویژه لطفاً")).toBeUndefined();
    expect(parseRoleCommand("تنظیم مدیر", true)).toEqual({ role: "moderator", action: "add", target: { kind: "reply" } });
    expect(parseRoleCommand("تنظیم مدیر @KronosMember", true)).toBeUndefined();
  });
});
