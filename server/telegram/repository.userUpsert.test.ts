import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "telegraf/types";

vi.mock("../db", () => ({ getDb: vi.fn() }));

import { getDb } from "../db";
import { buildTelegramUserUpsertValues, recordTelegramUser } from "./repository";

const telegramUser = {
  id: 8375579910,
  is_bot: false,
  first_name: "Kronos",
  last_name: undefined,
  username: "Kronosteam_official",
  language_code: "en",
} as User;

describe("Telegram user upsert after status-card removal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("builds an insert contract containing only the current telegramUsers columns", () => {
    const values = buildTelegramUserUpsertValues(telegramUser, { startedBot: true });

    expect(values).toMatchObject({
      telegramUserId: 8375579910,
      username: "Kronosteam_official",
      firstName: "Kronos",
      lastName: null,
      languageCode: "en",
      isBot: false,
      startedBotAt: expect.any(Date),
    });
    expect(values).not.toHaveProperty("preferredStatusCardStyle");
  });

  it("does not send the removed status-card column in insert or duplicate-update SQL", async () => {
    const onDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onDuplicateKeyUpdate });
    vi.mocked(getDb).mockResolvedValue({ insert: vi.fn().mockReturnValue({ values }) } as never);

    await recordTelegramUser(telegramUser, { startedBot: true });

    const insertValues = values.mock.calls[0]?.[0];
    const updateValues = onDuplicateKeyUpdate.mock.calls[0]?.[0]?.set;
    expect(insertValues).not.toHaveProperty("preferredStatusCardStyle");
    expect(updateValues).not.toHaveProperty("preferredStatusCardStyle");
    expect(updateValues).not.toHaveProperty("telegramUserId");
  });
});
