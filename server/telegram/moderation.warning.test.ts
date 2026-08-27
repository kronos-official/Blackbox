import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));

import { getDb } from "../db";
import { issueWarning, warningEscalationMuteExpiry } from "./moderation";

describe("warning count execution", () => {
  it("persists the requested number of warnings instead of silently falling back to one", async () => {
    const onDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onDuplicateKeyUpdate });
    const insert = vi.fn().mockReturnValue({ values });
    const limit = vi.fn().mockResolvedValue([{ count: 8 }]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    vi.mocked(getDb).mockResolvedValue({ insert, select } as never);

    await expect(issueWarning(7, 88, undefined, 3)).resolves.toBe(8);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ groupId: 7, telegramUserId: 88, count: 3 }));
    expect(onDuplicateKeyUpdate).toHaveBeenCalledWith({ set: expect.objectContaining({ count: expect.anything() }) });
    expect(where).toHaveBeenCalledOnce();
  });

  it("uses a permanent mute by default and creates an expiry only for an explicit timed policy", () => {
    expect(warningEscalationMuteExpiry(0, 1_000)).toBeUndefined();
    expect(warningEscalationMuteExpiry(90, 1_000)?.getTime()).toBe(5_401_000);
  });
});
