import { describe, expect, it } from "vitest";
import { normalizeTelegramMemberStatus } from "./liveTelegramRoles";

describe("live Telegram member role normalization", () => {
  it("maps Telegram owner and administrator statuses to the dashboard access hierarchy", () => {
    expect(normalizeTelegramMemberStatus("creator")).toMatchObject({ telegramRole: "owner", membershipStatus: "active", access: "group_owner" });
    expect(normalizeTelegramMemberStatus("administrator")).toMatchObject({ telegramRole: "administrator", membershipStatus: "active", access: "group_admin" });
  });

  it("records current non-administrator statuses without granting Telegram administration access", () => {
    expect(normalizeTelegramMemberStatus("member")).toMatchObject({ telegramRole: "member", membershipStatus: "active", access: null });
    expect(normalizeTelegramMemberStatus("restricted")).toMatchObject({ telegramRole: "restricted", membershipStatus: "active", access: null });
    expect(normalizeTelegramMemberStatus("left")).toMatchObject({ membershipStatus: "left", access: null });
  });
});
