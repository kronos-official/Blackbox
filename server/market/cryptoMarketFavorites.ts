import { and, asc, eq } from "drizzle-orm";
import { cryptoMarketFavorites } from "../../drizzle/schema";
import { getDb } from "../db";

function normalizeAssetId(assetId: string) {
  return assetId.trim().toLowerCase();
}

/** Returns the user's pinned market assets in the same stable order in which they were added. */
export async function listCryptoMarketFavoriteIds(telegramUserId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ assetId: cryptoMarketFavorites.assetId })
    .from(cryptoMarketFavorites)
    .where(eq(cryptoMarketFavorites.telegramUserId, telegramUserId))
    .orderBy(asc(cryptoMarketFavorites.createdAt), asc(cryptoMarketFavorites.id));
  return rows.map(row => row.assetId);
}

/** Adds or removes exactly one normalized asset ID from the authenticated user's market list. */
export async function setCryptoMarketFavorite(telegramUserId: number, assetId: string, enabled: boolean) {
  const db = await getDb();
  const normalizedAssetId = normalizeAssetId(assetId);
  if (!db) return { assetId: normalizedAssetId, enabled };

  if (enabled) {
    await db.insert(cryptoMarketFavorites).values({ telegramUserId, assetId: normalizedAssetId }).onDuplicateKeyUpdate({ set: { assetId: normalizedAssetId } });
  } else {
    await db.delete(cryptoMarketFavorites).where(and(eq(cryptoMarketFavorites.telegramUserId, telegramUserId), eq(cryptoMarketFavorites.assetId, normalizedAssetId)));
  }
  return { assetId: normalizedAssetId, enabled };
}
