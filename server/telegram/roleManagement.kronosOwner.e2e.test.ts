import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));

import { getDb } from "../db";
import { handleRoleManagementCommand } from "./roleManagement";

function query(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(async () => rows);
  chain.then = (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

describe("persisted Kronos owner command boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves a stored kronos_owner record as moderator-level access and rejects role delegation", async () => {
    const rows = [
      [{ id: 7, chatId: -1007, title: "Kronos", status: "active" }],
      [],
      [{ role: "kronos_owner" }],
    ];
    const select = vi.fn(() => query(rows.shift() ?? []));
    const insert = vi.fn();
    vi.mocked(getDb).mockResolvedValue({ select, insert } as never);

    const reply = vi.fn();
    const ctx = {
      chat: { id: -1007, type: "supergroup", title: "Kronos" },
      from: { id: 9031, is_bot: false },
      message: { text: "افزودن ویژه 123456", message_id: 71 },
      telegram: { getChatMember: vi.fn().mockResolvedValue({ status: "member" }), getChat: vi.fn() },
      reply,
    } as any;

    await expect(handleRoleManagementCommand(ctx)).resolves.toBe(true);
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("فقط مدیران"));
    expect(insert).not.toHaveBeenCalled();
  });
});
