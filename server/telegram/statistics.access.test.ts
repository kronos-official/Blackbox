import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repository", () => ({ findGroupByChatId: vi.fn() }));
vi.mock("./authorization", async importOriginal => {
  const actual = await importOriginal<typeof import("./authorization")>();
  return { ...actual, resolveAccessLevel: vi.fn() };
});

import { resolveAccessLevel } from "./authorization";
import { findGroupByChatId } from "./repository";
import { handleStatisticsCallback, handleStatisticsCommand } from "./statistics";

const group = { id: 9, chatId: -1009, title: "Kronos Guard" };

function statisticsContext(overrides: Record<string, unknown> = {}) {
  return {
    chat: { id: -1009, type: "supergroup" },
    from: { id: 9009 },
    message: { text: "آمار" },
    telegram: { getChatMember: vi.fn().mockResolvedValue({ status: "member" }) },
    reply: vi.fn().mockResolvedValue(undefined),
    answerCbQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
}

describe("statistics internal-role access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findGroupByChatId).mockResolvedValue(group as never);
    vi.mocked(resolveAccessLevel).mockResolvedValue("moderator" as never);
  });

  it("permits an internal Kronos moderator to receive the approved daily activity report", async () => {
    const ctx = statisticsContext();

    await expect(handleStatisticsCommand(ctx)).resolves.toBe(true);

    expect(resolveAccessLevel).toHaveBeenCalledWith(expect.objectContaining({ groupId: 9, groupChatId: -1009, telegramUserId: 9009 }), ctx.telegram);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("✅ فعالیت های امروز :"), expect.objectContaining({ parse_mode: "HTML" }));
    const report = ctx.reply.mock.calls[0][0] as string;
    expect(report).toContain("▪️ کل پیام ها :");
    expect(report).toContain("▪️ فیلم سلفی :");
    expect(report).toContain("✅ فعال ترین اعضای گروه:");
    expect(report).toContain("✅ کاربران برتر در افزودن عضو :");
    expect(report).toContain("▪️ اعضای وارد شده با لینک :");
    expect(report).not.toContain('tg://user?id=777000');
  });

  it("keeps the statistics close callback available to the same internal moderator", async () => {
    const ctx = statisticsContext({ callbackQuery: { data: "stats:close" } });

    await expect(handleStatisticsCallback(ctx)).resolves.toBe(true);

    expect(ctx.answerCbQuery).toHaveBeenCalledWith();
    expect(ctx.editMessageText).toHaveBeenCalledWith("منوی آمار بسته شد.");
  });

  it("continues to deny a regular member before exposing statistics", async () => {
    vi.mocked(resolveAccessLevel).mockResolvedValue("user" as never);
    const ctx = statisticsContext();

    await expect(handleStatisticsCommand(ctx)).resolves.toBe(true);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("مدیران مجاز گروه"));
  });
});
