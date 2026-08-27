import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: vi.fn() }));

import { getDb } from "../db";
import { GROUP_POLICY_KEYS, previewGroupPolicyOverride, rollbackGroupPolicyOverride } from "./policyAudit";

function rows<T>(value: T[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn().mockResolvedValue(value),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  return chain;
}

describe("group policy versioning", () => {
  beforeEach(() => vi.clearAllMocks());

  it("previews a real change against the stored override without mutating it", async () => {
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn().mockReturnValue(rows([{ value: false }])) } as never);

    await expect(previewGroupPolicyOverride({ groupId: 7, policyKey: GROUP_POLICY_KEYS.statistics, value: true })).resolves.toEqual({
      policyKey: GROUP_POLICY_KEYS.statistics,
      currentValue: false,
      nextValue: true,
      changed: true,
      summary: "policy value will change",
    });
  });

  it("rolls back only a version that belongs to the same group and policy, recording an immutable rollback version", async () => {
    const storedVersion = { id: 44, groupId: 7, policyKey: GROUP_POLICY_KEYS.statistics, value: false };
    const versionInsertValues = vi.fn().mockReturnValue({ $returningId: vi.fn().mockResolvedValue([{ id: 45 }]) });
    const overrideInsertValues = vi.fn().mockReturnValue({ onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined) });
    const tx = { insert: vi.fn().mockReturnValueOnce({ values: versionInsertValues }).mockReturnValueOnce({ values: overrideInsertValues }) };
    const dbInsertValues = vi.fn().mockResolvedValue(undefined);
    const db = {
      select: vi.fn().mockReturnValueOnce(rows([storedVersion])).mockReturnValueOnce(rows([{ value: true }])),
      transaction: vi.fn(async callback => callback(tx)),
      insert: vi.fn().mockReturnValue({ values: dbInsertValues }),
    };
    vi.mocked(getDb).mockResolvedValue(db as never);

    await expect(rollbackGroupPolicyOverride({ groupId: 7, policyKey: GROUP_POLICY_KEYS.statistics, versionId: 44, updatedByTelegramId: 8375579910 })).resolves.toEqual({ changed: true, versionId: 45 });
    expect(versionInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 7,
      policyKey: GROUP_POLICY_KEYS.statistics,
      value: false,
      previousValue: true,
      operation: "rollback",
      sourceVersionId: 44,
      updatedByTelegramId: 8375579910,
    }));
  });

  it("rejects a rollback request when no same-group version can be resolved", async () => {
    vi.mocked(getDb).mockResolvedValue({ select: vi.fn().mockReturnValue(rows([])) } as never);

    await expect(rollbackGroupPolicyOverride({ groupId: 7, policyKey: GROUP_POLICY_KEYS.statistics, versionId: 999, updatedByTelegramId: 8375579910 })).rejects.toThrow("Policy version was not found for this group");
  });
});
