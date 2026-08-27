import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));

vi.mock("../db", () => ({ getDb: getDbMock }));

import { listCryptoMarketFavoriteIds, setCryptoMarketFavorite } from "./cryptoMarketFavorites";

function createFavoritesDb(rows: Array<{ assetId: string }> = []) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const whereSelect = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where: whereSelect });
  const select = vi.fn().mockReturnValue({ from });
  const onDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onDuplicateKeyUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  const whereDelete = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn().mockReturnValue({ where: whereDelete });
  return { db: { select, insert, delete: remove }, orderBy, values, onDuplicateKeyUpdate, whereDelete };
}

describe("crypto market favorites", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a user's favorites in their stable saved order", async () => {
    const { db, orderBy } = createFavoritesDb([{ assetId: "bitcoin" }, { assetId: "ethereum" }]);
    getDbMock.mockResolvedValue(db);

    await expect(listCryptoMarketFavoriteIds(44)).resolves.toEqual(["bitcoin", "ethereum"]);
    expect(orderBy).toHaveBeenCalledOnce();
  });

  it("normalizes and upserts exactly one favorite without affecting other user data", async () => {
    const { db, values, onDuplicateKeyUpdate } = createFavoritesDb();
    getDbMock.mockResolvedValue(db);

    await expect(setCryptoMarketFavorite(44, "  Bitcoin ", true)).resolves.toEqual({ assetId: "bitcoin", enabled: true });
    expect(values).toHaveBeenCalledWith({ telegramUserId: 44, assetId: "bitcoin" });
    expect(onDuplicateKeyUpdate).toHaveBeenCalledWith({ set: { assetId: "bitcoin" } });
  });

  it("removes only the requested normalized favorite and remains safe without a database", async () => {
    const { db, whereDelete } = createFavoritesDb();
    getDbMock.mockResolvedValue(db);

    await expect(setCryptoMarketFavorite(44, "ETHEREUM", false)).resolves.toEqual({ assetId: "ethereum", enabled: false });
    expect(whereDelete).toHaveBeenCalledOnce();

    getDbMock.mockResolvedValue(undefined);
    await expect(listCryptoMarketFavoriteIds(44)).resolves.toEqual([]);
    await expect(setCryptoMarketFavorite(44, " Solana ", true)).resolves.toEqual({ assetId: "solana", enabled: true });
  });
});
