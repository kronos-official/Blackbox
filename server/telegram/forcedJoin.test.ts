import { describe, expect, it, vi } from "vitest";
import { checkedMiniAppForcedJoinStatus, ensureForcedJoinAccess, evaluateForcedJoinMembership, forcedJoinPromptText, FORCED_JOIN_VERIFICATION_RECHECK, joinKeyboard, noMiniAppForcedJoinStatus, shouldBypassGroupForcedJoinForLinkedChannelPost, shouldBypassGroupForcedJoinForMemberJoinServiceMessage, shouldEnforceGroupForcedJoin, shouldPromptNewGroupMemberForcedJoin, unavailableMiniAppForcedJoinStatus, verifiedAcquisitionChannelIds } from "./forcedJoin";

const channels = [
  { id: 1, channelChatId: -1001, title: "Alpha" },
  { id: 2, channelChatId: -1002, title: "Beta" },
] as any;

describe("forced-join membership enforcement", () => {
  it("uses a deliberate fresh retry window after a user presses verification", () => {
    expect(FORCED_JOIN_VERIFICATION_RECHECK).toEqual({ attempts: 4, retryDelayMs: 1_000 });
  });

  it("does not gate a new Mini App user when no forced-join channel is active", () => {
    expect(noMiniAppForcedJoinStatus()).toEqual({ locked: false, unavailable: false, missingCount: 0, missingChannels: [], lastMembershipCheckAt: null });
  });

  it("locks only a user who is missing a real active requirement and opens the Mini App after verification", () => {
    const missing = checkedMiniAppForcedJoinStatus({ locked: true, unavailable: false, missing: [channels[0]] });
    expect(missing).toMatchObject({ locked: true, unavailable: false, missingCount: 1, missingChannels: [{ id: 1, title: "Alpha" }] });
    const verified = checkedMiniAppForcedJoinStatus({ locked: false, unavailable: false, missing: [] });
    expect(verified).toMatchObject({ locked: false, unavailable: false, missingCount: 0, missingChannels: [] });
    expect(unavailableMiniAppForcedJoinStatus([channels[0]])).toMatchObject({ locked: true, unavailable: true, missingCount: 1 });
  });

  it("bypasses forced-join enforcement for the real linked-channel automatic-forward shape", () => {
    expect(shouldBypassGroupForcedJoinForLinkedChannelPost({
      is_automatic_forward: true,
      sender_chat: { type: "channel" },
    })).toBe(true);
    expect(shouldBypassGroupForcedJoinForLinkedChannelPost({
      is_automatic_forward: true,
      sender_chat: { type: "supergroup" },
    })).toBe(false);
    expect(shouldBypassGroupForcedJoinForLinkedChannelPost({
      is_automatic_forward: false,
      sender_chat: { type: "channel" },
    })).toBe(false);
  });

  it("does not begin a forced-join membership lookup for a linked-channel post", async () => {
    const getChatMember = vi.fn();
    const ctx = {
      from: { id: 100, is_bot: false, first_name: "مدیر" },
      chat: { id: -100123, type: "supergroup" },
      message: {
        message_id: 42,
        is_automatic_forward: true,
        sender_chat: { id: -100456, type: "channel" },
      },
      telegram: { getChatMember },
    } as any;

    await expect(ensureForcedJoinAccess(ctx)).resolves.toBe(true);
    expect(getChatMember).not.toHaveBeenCalled();
  });

  it("leaves a member-join service update to its dedicated handler so only one group prompt is sent", async () => {
    const getChatMember = vi.fn();
    const reply = vi.fn();
    const ctx = {
      from: { id: 100, is_bot: false, first_name: "عضو تازه" },
      chat: { id: -100123, type: "supergroup" },
      message: {
        message_id: 43,
        new_chat_members: [{ id: 100, is_bot: false, first_name: "عضو تازه" }],
      },
      reply,
      telegram: { getChatMember },
    } as any;

    expect(shouldBypassGroupForcedJoinForMemberJoinServiceMessage(ctx.message)).toBe(true);
    await expect(ensureForcedJoinAccess(ctx)).resolves.toBe(true);
    expect(getChatMember).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("permits only users currently present in every required channel", async () => {
    const client = { getChatMember: async () => ({ status: "member" }) };
    await expect(evaluateForcedJoinMembership(channels, 100, client)).resolves.toEqual({ allowed: true, missingChannelIds: [], unavailableChannelIds: [], lookupErrors: [] });
  });

  it("fails closed for a missing channel and separately identifies a membership lookup failure", async () => {
    const leftClient = { getChatMember: async (chatId: number) => ({ status: chatId === -1001 ? "left" : "administrator" }) };
    await expect(evaluateForcedJoinMembership(channels, 100, leftClient)).resolves.toEqual({ allowed: false, missingChannelIds: [1], unavailableChannelIds: [], lookupErrors: [] });
    const unavailableClient = { getChatMember: async () => Promise.reject(new Error("bot not administrator")) };
    await expect(evaluateForcedJoinMembership(channels, 100, unavailableClient)).resolves.toEqual(expect.objectContaining({ allowed: false, missingChannelIds: [], unavailableChannelIds: [1, 2] }));
  });

  it("rechecks a just-joined user once so short Telegram propagation does not leave them locked", async () => {
    const client = {
      getChatMember: vi.fn()
        .mockResolvedValueOnce({ status: "left" })
        .mockResolvedValueOnce({ status: "member" }),
    };

    await expect(evaluateForcedJoinMembership([channels[0]], 100, client, { attempts: 2, retryDelayMs: 0, sleep: async () => undefined }))
      .resolves.toEqual({ allowed: true, missingChannelIds: [], unavailableChannelIds: [], lookupErrors: [] });
    expect(client.getChatMember).toHaveBeenCalledTimes(2);
  });

  it("locks ordinary group members only when a group-scoped requirement is missing", () => {
    expect(shouldEnforceGroupForcedJoin({ chatType: "supergroup", requiredCount: 2, memberStatus: "member", membershipAllowed: false })).toBe(true);
    expect(shouldEnforceGroupForcedJoin({ chatType: "supergroup", requiredCount: 2, memberStatus: "member", membershipAllowed: true })).toBe(false);
    expect(shouldEnforceGroupForcedJoin({ chatType: "supergroup", requiredCount: 2, memberStatus: "administrator", membershipAllowed: false })).toBe(false);
    expect(shouldEnforceGroupForcedJoin({ chatType: "private", requiredCount: 2, memberStatus: "member", membershipAllowed: false })).toBe(false);
    expect(shouldEnforceGroupForcedJoin({ chatType: "group", requiredCount: 0, memberStatus: "member", membershipAllowed: false })).toBe(false);
  });

  it("renders one destination button per row and keeps the verification action separate", () => {
    const keyboard = joinKeyboard([
      { ...channels[0], buttonLabel: "عضویت در آلفا", inviteUrl: "https://t.me/alpha" },
      { ...channels[1], buttonLabel: "عضویت در بتا", inviteUrl: "https://t.me/beta" },
    ], "fa").reply_markup as any;
    expect(keyboard.inline_keyboard).toHaveLength(3);
    expect(keyboard.inline_keyboard[0]).toHaveLength(1);
    expect(keyboard.inline_keyboard[1]).toHaveLength(1);
    expect(keyboard.inline_keyboard[2]).toHaveLength(1);
    expect(keyboard.inline_keyboard[0][0].text).toBe("عضویت در آلفا");
    expect(keyboard.inline_keyboard[1][0].text).toBe("عضویت در بتا");
  });

  it("explains which destinations are still missing after a premature verification click", () => {
    const text = forcedJoinPromptText("fa", channels, { id: 100, firstName: "آزمایش" });
    expect(text).toContain('tg://user?id=100');
    expect(text).toContain("آزمایش");
    expect(text).toContain("هنوز تأیید نشده");
    expect(text).toContain("Alpha");
    expect(text).toContain("Beta");
  });

  it("keeps the real member mention and does not let a historical lock suppress a new valid prompt", () => {
    const text = forcedJoinPromptText("fa", channels, { id: 100, firstName: "عضو تازه" });
    expect(text).toContain('tg://user?id=100');
    expect(text).toContain("عضو تازه");
    expect(text).toContain('<a href="tg://user?id=100">عضو تازه</a>');
    expect(shouldPromptNewGroupMemberForcedJoin({ allowed: false, unavailableChannelCount: 0, missingChannelCount: 1 })).toBe(true);
    expect(shouldPromptNewGroupMemberForcedJoin({ allowed: true, unavailableChannelCount: 0, missingChannelCount: 0 })).toBe(false);
    expect(shouldPromptNewGroupMemberForcedJoin({ allowed: false, unavailableChannelCount: 1, missingChannelCount: 1 })).toBe(false);
  });

  it("uses the Telegram display name instead of a username when a member payload uses snake_case fields", () => {
    const text = forcedJoinPromptText("fa", channels, { id: 101, first_name: "نام نمایشی", last_name: "کاربر", username: "plainusername" });
    expect(text).toContain("نام نمایشی کاربر");
    expect(text).toContain('tg://user?id=101');
    expect(text).not.toContain("plainusername");
  });

  it("credits only the deduplicated channels that were missing during a prior lock", () => {
    expect(verifiedAcquisitionChannelIds({ locked: true, missingChannelIds: [1, 1, 2, 404, "bad"] }, channels))
      .toEqual([1, 2]);
    expect(verifiedAcquisitionChannelIds({ locked: false, missingChannelIds: [1, 2] }, channels)).toEqual([]);
    expect(verifiedAcquisitionChannelIds(null, channels)).toEqual([]);
  });
});
