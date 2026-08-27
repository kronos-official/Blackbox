import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  clearGroupChatMetadataCache,
  getGroupChatMetadataCacheMetrics,
  getOrLoadGroupChatMetadata,
  GROUP_CHAT_METADATA_CACHE_TTL_MS,
  resetGroupChatMetadataCacheMetrics,
} from "./groupChatMetadataCache";

describe("group chat metadata cache", () => {
  beforeEach(() => {
    clearGroupChatMetadataCache();
    resetGroupChatMetadataCacheMetrics();
    vi.spyOn(Date, "now").mockReturnValue(1_000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deduplicates repeated reads within the short TTL", async () => {
    const loader = vi.fn().mockResolvedValue({ description: "بیو", photo: { big_file_id: "photo-1" } });

    const first = await getOrLoadGroupChatMetadata(-1001, loader);
    const second = await getOrLoadGroupChatMetadata(-1001, loader);

    expect(first).toEqual(second);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(getGroupChatMetadataCacheMetrics()).toMatchObject({ hits: 1, misses: 1, loads: 1, hitRate: 0.5 });
  });

  it("records loader latency without retaining a group identifier", async () => {
    const loader = vi.fn().mockResolvedValue({ description: "بیو", photo: { big_file_id: "photo-2" } });

    await getOrLoadGroupChatMetadata(-1004, loader);
    const snapshot = getGroupChatMetadataCacheMetrics();

    expect(snapshot.loads).toBe(1);
    expect(snapshot.totalLoadLatencyMs).toBeGreaterThanOrEqual(0);
    expect(snapshot.lastLoadLatencyMs).toBeGreaterThanOrEqual(0);
    expect(snapshot).not.toHaveProperty("chatId");
    expect(snapshot).not.toHaveProperty("groupId");
  });

  it("expires metadata and loads a fresh profile after the TTL", async () => {
    const loader = vi.fn()
      .mockResolvedValueOnce({ description: "قدیمی", photo: { big_file_id: "photo-1" } })
      .mockResolvedValueOnce({ description: "تازه", photo: { big_file_id: "photo-2" } });

    await getOrLoadGroupChatMetadata(-1002, loader);
    vi.spyOn(Date, "now").mockReturnValue(1_000 + GROUP_CHAT_METADATA_CACHE_TTL_MS + 1);
    const fresh = await getOrLoadGroupChatMetadata(-1002, loader);

    expect(fresh).toEqual({ description: "تازه", photo: { big_file_id: "photo-2" } });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(getGroupChatMetadataCacheMetrics()).toMatchObject({ misses: 2, expirations: 1, loads: 2 });
  });

  it("does not retain failed loads and can recover on the next request", async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("Telegram unavailable"))
      .mockResolvedValueOnce({ description: "بازیابی‌شده", photo: { big_file_id: "photo-3" } });

    await expect(getOrLoadGroupChatMetadata(-1003, loader)).rejects.toThrow("Telegram unavailable");
    await expect(getOrLoadGroupChatMetadata(-1003, loader)).resolves.toEqual({ description: "بازیابی‌شده", photo: { big_file_id: "photo-3" } });
    expect(loader).toHaveBeenCalledTimes(2);
    expect(getGroupChatMetadataCacheMetrics()).toMatchObject({ misses: 2, loaderErrors: 1, loads: 1 });
  });

  it("can reset metrics independently of cached data", async () => {
    const loader = vi.fn().mockResolvedValue({ description: "بیو", photo: null });
    await getOrLoadGroupChatMetadata(-1005, loader);
    resetGroupChatMetadataCacheMetrics();

    expect(getGroupChatMetadataCacheMetrics()).toMatchObject({ hits: 0, misses: 0, loads: 0, entryCount: 1 });
  });
});
