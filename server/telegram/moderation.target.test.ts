import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));

import { getDb } from "../db";
import { parseModerationCommand } from "./commandParser";
import { resolveModerationTarget } from "./moderation";

function knownUserDb(user: { telegramUserId: number; firstName: string; lastName: string | null; username: string }) {
  const limit = vi.fn().mockResolvedValue([user]);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  return { db: { select: vi.fn().mockReturnValue({ from }) }, where, limit };
}

describe("moderation target resolution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves a plain @username target from the observed Telegram identity before falling back to getChat", async () => {
    const fixture = knownUserDb({ telegramUserId: 8375579910, firstName: "Kronos", lastName: null, username: "kronosteam_official" });
    vi.mocked(getDb).mockResolvedValue(fixture.db as never);
    const getChat = vi.fn();
    const command = parseModerationCommand("وضعیت کاربر @Kronosteam_official", false);

    await expect(resolveModerationTarget({ message: { text: "وضعیت کاربر @Kronosteam_official" }, telegram: { getChat } } as never, command!)).resolves.toEqual({
      telegramUserId: 8375579910,
      displayName: "Kronos",
    });
    expect(fixture.where).toHaveBeenCalledOnce();
    expect(getChat).not.toHaveBeenCalled();
  });
});
