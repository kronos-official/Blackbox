import { describe, expect, it } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findTelegramUserByUsername, recordTelegramUser } from "./repository";
import { parseModerationCommand } from "./commandParser";
import { parseAdministratorTitleCommand, parseNicknameCommand } from "./administratorTitles";
import { parseRoleCommand } from "./roleManagement";
import { INLINE_MENTION_TOKEN, prepareTargetAwareCommandText, resolveTelegramTarget, targetReferenceFromToken } from "./targetResolver";

vi.mock("./repository", () => ({
  findTelegramUserByUsername: vi.fn(),
  recordTelegramUser: vi.fn().mockResolvedValue(undefined),
}));

describe("target resolver command normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replaces only Telegram text mentions before command parsing", () => {
    const text = prepareTargetAwareCommandText({
      text: "بن کاربر منتخب 2h",
      entities: [{ type: "text_mention", offset: 3, length: 11, user: { id: 8375579910, first_name: "Kronos" } }],
    });
    expect(text).toBe(`بن ${INLINE_MENTION_TOKEN} 2h`);
    expect(parseModerationCommand(text, false)).toMatchObject({ action: "ban", target: { kind: "mention" }, durationSeconds: 7200 });
  });

  it("recognizes exported tg://user text links from live Telegram mentions", () => {
    const text = prepareTargetAwareCommandText({
      text: "تنظیم لقب کاربر منتخب نگهبان",
      entities: [{ type: "text_link", offset: 10, length: 11, url: "tg://user?id=8375579910" }],
    });
    expect(text).toBe(`تنظیم لقب ${INLINE_MENTION_TOKEN} نگهبان`);
    expect(parseAdministratorTitleCommand(text)).toEqual({ action: "set", target: { kind: "mention" }, title: "نگهبان" });
  });

  it("keeps reply, username, numeric ID, and selected mention as equivalent explicit targets", () => {
    expect(targetReferenceFromToken(INLINE_MENTION_TOKEN)).toEqual({ kind: "mention" });
    expect(targetReferenceFromToken("@KronosMember")).toEqual({ kind: "username", username: "KronosMember" });
    expect(targetReferenceFromToken("8375579910")).toEqual({ kind: "id", telegramUserId: 8375579910 });
    expect(targetReferenceFromToken("@KRONOSMEMBER")).toEqual({ kind: "username", username: "KRONOSMEMBER" });
    expect(parseRoleCommand(`افزودن مدیر ${INLINE_MENTION_TOKEN}`)).toEqual({ role: "moderator", action: "add", target: { kind: "mention" } });
  });

  it("parses selected mentions for both persistent Telegram tags and stored nicknames", () => {
    expect(parseAdministratorTitleCommand(`تنظیم لقب ${INLINE_MENTION_TOKEN} نگهبان`)).toEqual({ action: "set", target: { kind: "mention" }, title: "نگهبان" });
    expect(parseAdministratorTitleCommand(`حذف لقب ${INLINE_MENTION_TOKEN}`)).toEqual({ action: "remove", target: { kind: "mention" } });
    expect(parseNicknameCommand(`لقب ${INLINE_MENTION_TOKEN}`)).toEqual({ action: "show", target: { kind: "mention" } });
    expect(parseNicknameCommand(`لقب ${INLINE_MENTION_TOKEN} نگهبان`)).toEqual({ action: "set", target: { kind: "mention" }, title: "نگهبان" });
  });

  it("resolves an unobserved group administrator by case-insensitive username and records the discovered identity", async () => {
    vi.mocked(findTelegramUserByUsername).mockResolvedValue(undefined);
    const getChatAdministrators = vi.fn().mockResolvedValue([
      { status: "administrator", user: { id: 4_200, first_name: "Ada", username: "KronosAdmin", is_bot: false } },
    ]);
    const getChat = vi.fn();
    const ctx = {
      chat: { id: -100_700, type: "supergroup" },
      telegram: { getChatAdministrators, getChat },
    } as any;

    await expect(resolveTelegramTarget(ctx, { kind: "username", username: "@KRONOSADMIN" })).resolves.toEqual({
      telegramUserId: 4_200,
      displayName: "Ada",
      username: "KronosAdmin",
    });
    expect(getChatAdministrators).toHaveBeenCalledWith(-100_700);
    expect(recordTelegramUser).toHaveBeenCalledWith(expect.objectContaining({ id: 4_200, username: "KronosAdmin" }));
    expect(getChat).not.toHaveBeenCalled();
  });
});
