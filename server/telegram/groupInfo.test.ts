import { describe, expect, it, vi } from "vitest";
import { buildGroupLinkModeCaption, buildGroupProfileCaption, buildGroupStatusCaption, consumePrivateLinkTransfer, createPrivateLinkTransfer, getGroupChatWithFallback, groupLinkActorUnavailableMessage, groupLinkModeKeyboard, groupStatusActorUnavailableMessage, isGroupLinkAccessLevelAllowed, isGroupLinkActorAllowed, isGroupLinkCommand, isGroupLinkModeCallback, isGroupStatusCommand, isTelegramGroupAdminStatus, linkResultKeyboard, replaceLinkMenuWithPhoto, sendGroupLinkPhoto, telegramPhotoFileId } from "./groupInfo";

describe("group profile card", () => {
  it("recognizes the slashless group status command and its English alias", () => {
    expect(isGroupStatusCommand("وضعیت گروه")).toBe(true);
    expect(isGroupStatusCommand(" group status ")).toBe(true);
    expect(isGroupStatusCommand("وضعیت قفل")).toBe(false);
  });

  it("renders truthful group status and actor fallback copy", () => {
    const caption = buildGroupStatusCaption({ groupStatus: "active", botStatus: "administrator", activeLockCount: 3 });
    expect(caption).toContain("وضعیت گروه");
    expect(caption).toContain("فعال");
    expect(caption).toContain("۳");
    expect(groupStatusActorUnavailableMessage()).toContain("حالت ناشناس ادمین");
  });
  it("recognizes لینک, گپ, and profile aliases without matching unrelated text", () => {
    expect(isGroupLinkCommand("لینک")).toBe(true);
    expect(isGroupLinkCommand("  لینک گروه  ")).toBe(true);
    expect(isGroupLinkCommand("گپ")).toBe(true);
    expect(isGroupLinkCommand("اطلاعات گپ")).toBe(true);
    expect(isGroupLinkCommand("لینک گروه خصوصی")).toBe(false);
  });

  it("only permits the unregistered-group metadata fallback for Telegram admins", () => {
    expect(isTelegramGroupAdminStatus("creator")).toBe(true);
    expect(isTelegramGroupAdminStatus("administrator")).toBe(true);
    expect(isTelegramGroupAdminStatus(" ADMINISTRATOR ")).toBe(true);
    expect(isTelegramGroupAdminStatus("owner")).toBe(true);
    expect(isTelegramGroupAdminStatus("member")).toBe(false);
    expect(isTelegramGroupAdminStatus(undefined)).toBe(false);
  });

  it("allows the configured owner, registered group owner, and Telegram administrators to use link", () => {
    expect(isGroupLinkActorAllowed({ telegramUserId: 8375579910, memberStatus: "member" })).toBe(true);
    expect(isGroupLinkActorAllowed({ telegramUserId: 123, ownerTelegramId: 123, memberStatus: "member" })).toBe(true);
    expect(isGroupLinkActorAllowed({ telegramUserId: 123, ownerTelegramId: "123" as unknown as number, memberStatus: "member" })).toBe(true);
    expect(isGroupLinkActorAllowed({ telegramUserId: 456, memberStatus: "administrator" })).toBe(true);
    expect(isGroupLinkActorAllowed({ telegramUserId: 789, memberStatus: "creator" })).toBe(true);
    expect(isGroupLinkActorAllowed({ telegramUserId: 999, memberStatus: "member" })).toBe(false);
  });

  it("keeps link access aligned with the delegated moderator authority boundary", () => {
    expect(isGroupLinkAccessLevelAllowed("owner")).toBe(true);
    expect(isGroupLinkAccessLevelAllowed("global_admin")).toBe(true);
    expect(isGroupLinkAccessLevelAllowed("group_owner")).toBe(true);
    expect(isGroupLinkAccessLevelAllowed("group_admin")).toBe(true);
    expect(isGroupLinkAccessLevelAllowed("moderator")).toBe(true);
    expect(isGroupLinkAccessLevelAllowed("user")).toBe(false);
  });

  it("uses update chat metadata when Telegram rejects getChat", async () => {
    const updateChat = { id: -10042, type: "supergroup" as const, title: "گروه زنده", description: "توضیح موجود در update" };
    const fallback = await getGroupChatWithFallback({ getChat: async () => { throw new Error("chat unavailable"); } }, updateChat);
    expect(fallback).toEqual(updateChat);
  });

  it("accepts only a Telegram photo file_id and never forwards the ChatPhoto object", () => {
    expect(telegramPhotoFileId({ big_file_id: "AgAC-valid-file-id" })).toBe("AgAC-valid-file-id");
    expect(telegramPhotoFileId({ big_file_id: { file_id: "AgAC-wrong-shape" } })).toBeNull();
    expect(telegramPhotoFileId({ small_file_id: "AgAC-small-only" })).toBeNull();
    expect(telegramPhotoFileId(null)).toBeNull();
  });

  it("sends the visual link as photo media with the link card as caption", async () => {
    const sendPhoto = vi.fn().mockResolvedValue({ message_id: 901 });
    const getFileLink = vi.fn();
    const sent = await sendGroupLinkPhoto({ sendPhoto, getFileLink }, -10042, {
      photoFileId: "AgAC-group-profile",
      caption: "<b>کارت لینک Kronos Guard</b>\n🔗 https://t.me/+random",
      replyMarkup: { inline_keyboard: [] },
    });
    expect(sent).toEqual({ message_id: 901 });
    expect(sendPhoto).toHaveBeenCalledWith(-10042, "AgAC-group-profile", expect.objectContaining({
      caption: expect.stringContaining("https://t.me/+random"),
      parse_mode: "HTML",
    }));
    expect(getFileLink).not.toHaveBeenCalled();
  });

  it("downloads a fresh profile file and resends it as photo media instead of falling back to text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer }));
    const sendPhoto = vi.fn()
      .mockRejectedValueOnce(new Error("cached file id rejected"))
      .mockResolvedValueOnce({ message_id: 902 });
    const getFile = vi.fn().mockResolvedValue({ file_path: "photos/profile.jpg" });
    const getFileLink = vi.fn().mockResolvedValue(new URL("https://api.telegram.org/file/bot/token/profile.jpg"));
    const sent = await sendGroupLinkPhoto({ sendPhoto, getFile, getFileLink }, -10042, {
      photoFileId: "AgAC-group-profile",
      caption: "<b>کارت لینک Kronos Guard</b>",
      replyMarkup: { inline_keyboard: [] },
    });
    expect(sent).toEqual({ message_id: 902 });
    expect(sendPhoto.mock.calls[0][2]).toEqual(expect.objectContaining({ link_preview_options: { is_disabled: true } }));
    expect(getFile).toHaveBeenCalledWith("AgAC-group-profile");
    expect(getFileLink).toHaveBeenCalledWith("AgAC-group-profile");
    expect(sendPhoto).toHaveBeenLastCalledWith(-10042, expect.objectContaining({ filename: "profile.jpg", source: expect.any(Buffer) }), expect.objectContaining({ caption: "<b>کارت لینک Kronos Guard</b>" }));
    vi.unstubAllGlobals();
  });

  it("deletes the old link menu only after photo delivery succeeds", async () => {
    const sendPhoto = vi.fn().mockResolvedValue({ message_id: 903 });
    const getFileLink = vi.fn();
    const deleteMessage = vi.fn().mockResolvedValue(true);
    const sent = await replaceLinkMenuWithPhoto({ sendPhoto, getFileLink, deleteMessage }, -10042, 77, {
      photoFileId: "AgAC-group-profile",
      caption: "<b>کارت لینک Kronos Guard</b>",
      replyMarkup: { inline_keyboard: [] },
    });
    expect(sent).toEqual({ message_id: 903 });
    expect(sendPhoto.mock.calls[0][2]).toEqual(expect.objectContaining({ link_preview_options: { is_disabled: true } }));
    expect(deleteMessage).toHaveBeenCalledWith(-10042, 77);
  });

  it("keeps the old link menu when photo delivery fails", async () => {
    const sendPhoto = vi.fn().mockRejectedValue(new Error("Telegram rejected photo"));
    const getFileLink = vi.fn().mockRejectedValue(new Error("file unavailable"));
    const deleteMessage = vi.fn();
    const sent = await replaceLinkMenuWithPhoto({ sendPhoto, getFileLink, deleteMessage }, -10042, 78, {
      photoFileId: "AgAC-group-profile",
      caption: "<b>کارت لینک Kronos Guard</b>",
      replyMarkup: { inline_keyboard: [] },
    });
    expect(sent).toBeNull();
    expect(deleteMessage).not.toHaveBeenCalled();
  });

  it("renders a ready-to-share invite link for a private group", () => {
    const caption = buildGroupProfileCaption({ title: "گپ آزمایشی", type: "supergroup", chatId: -10042, botStatus: "administrator", activeLockCount: 0, inviteLink: "https://t.me/+invite-token" });
    expect(caption).toContain("https://t.me/+invite-token");
    expect(caption).toContain("لینک آمادهٔ اشتراک");
  });

  it("returns a clear safe message when Telegram cannot identify the actor", () => {
    expect(groupLinkActorUnavailableMessage()).toContain("شناسهٔ فرستندهٔ این پیام");
    expect(groupLinkActorUnavailableMessage()).toContain("حالت ناشناس ادمین");
  });

  it("renders available group metadata and truthful fallbacks as readable HTML", () => {
    const caption = buildGroupProfileCaption({
      title: "گروه <آزمایشی>",
      username: "kronos_test",
      description: "توضیحات گروه",
      memberCount: 128,
      type: "supergroup",
      chatId: -100123,
      botStatus: "administrator",
      activeLockCount: 4,
    });
    expect(caption).toContain("گروه &lt;آزمایشی&gt;");
    expect(caption).toContain("https://t.me/kronos_test");
    expect(caption).toContain("توضیحات گروه");
    expect(caption).toContain("۱۲۸");
    expect(caption).toContain("۴");
    expect(caption).toContain("مدیر");
    expect(caption).toContain("شناسهٔ گروه");
  });

  it("delivers a private link through a one-use start payload when direct delivery is unavailable", () => {
    const deepLink = createPrivateLinkTransfer("✅ لینک با موفقیت به پیوی شما ارسال شد.\\n\\n<b>لینک آزمایشی</b>\\n🔗 https://t.me/+test");
    expect(deepLink).toMatch(/^https:\/\/t\.me\/kronosguard_bot\?start=link_[A-Za-z0-9_-]+$/);
    const payload = new URL(deepLink).searchParams.get("start");
    expect(payload).toBeTruthy();
    const delivered = consumePrivateLinkTransfer(payload!);
    expect(delivered).toContain("✅ لینک با موفقیت به پیوی شما ارسال شد.");
    expect(delivered).toContain("https://t.me/+test");
    expect(consumePrivateLinkTransfer(payload!)).toBeNull();
  });

  it("exposes linked private-chat and forwarding affordances in every link result", () => {
    const menu = groupLinkModeKeyboard();
    const menuPrivate = menu.inline_keyboard[4][0];
    expect(menuPrivate.text).not.toContain("↗");
    expect(menuPrivate.callback_data).toBe("group-link:private");
    expect(menu.inline_keyboard.flat().map((button) => button.text).join(" ")).not.toMatch(/[↗↖⬆⬈]/u);

    for (const mode of ["text", "image", "once", "request"] as const) {
      const result = linkResultKeyboard(mode, true, "https://t.me/+invite-token");
      const share = result.inline_keyboard[0][0];
      const privateChat = result.inline_keyboard[1][0];
      expect(share.text).not.toContain("↗");
      expect(share.url).toContain("https://t.me/share/url?");
      expect(share.url).toContain(encodeURIComponent("https://t.me/+invite-token"));
      expect(privateChat.text).not.toContain("↗");
      expect(privateChat.url).toMatch(/^https:\/\/t\.me\/kronosguard_bot\?start=link_[A-Za-z0-9_-]+$/);
      expect(result.inline_keyboard.flat().map((button) => button.text).join(" ")).not.toMatch(/[↗↖⬆⬈]/u);
    }
    expect(isGroupLinkModeCallback("group-link:once")).toBe(true);
    expect(isGroupLinkModeCallback("group-link:request")).toBe(true);
    expect(isGroupLinkModeCallback("group-link:revoke-confirm")).toBe(true);
    expect(isGroupLinkModeCallback("group-link:unknown")).toBe(false);
    const caption = buildGroupLinkModeCaption({ title: "گروه", type: "supergroup", chatId: -10, botStatus: "administrator", activeLockCount: 0, inviteLink: "https://t.me/+invite" }, "once", "https://t.me/+limited");
    expect(caption).toContain("Kronos Guard");
    expect(caption).toContain("◈ لینک یک‌بارمصرف امن | Kronos Guard");
    expect(caption).toContain("بیوگرافی گپ");
    expect(caption).toContain("لینک یک‌بارمصرف");
    expect(caption).toContain("https://t.me/+limited");
  });

  it("does not invent unavailable metadata", () => {
    const caption = buildGroupProfileCaption({ title: "گروه", memberCount: undefined, type: "group", chatId: -10, botStatus: "member", activeLockCount: 0 });
    expect(caption).toContain("ثبت نشده");
    expect(caption).toContain("در دسترس نیست");
    expect(caption).not.toContain("تاریخ ایجاد");
  });
});
