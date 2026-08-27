type CacheEntry<T> = {
  value?: T;
  expiresAt: number;
  pending?: Promise<T>;
};

export const GROUP_CHAT_METADATA_CACHE_TTL_MS = 30_000;
export const GROUP_CHAT_METADATA_CACHE_MAX_ENTRIES = 128;

const entries = new Map<string, CacheEntry<unknown>>();

const metrics = {
  hits: 0,
  misses: 0,
  expirations: 0,
  loaderErrors: 0,
  inFlightJoins: 0,
  evictions: 0,
  loads: 0,
  totalLoadLatencyMs: 0,
  lastLoadLatencyMs: 0,
  maxLoadLatencyMs: 0,
};

type GroupChatMetadataCacheMetrics = {
  hits: number;
  misses: number;
  expirations: number;
  loaderErrors: number;
  inFlightJoins: number;
  evictions: number;
  loads: number;
  totalLoadLatencyMs: number;
  lastLoadLatencyMs: number;
  maxLoadLatencyMs: number;
  hitRate: number;
  entryCount: number;
  collectedAt: number;
};

function keyFor(chatId: number | string) {
  return String(chatId);
}

function evictExpired(now: number) {
  entries.forEach((entry, key) => {
    if (entry.expiresAt <= now && !entry.pending) {
      entries.delete(key);
      metrics.expirations += 1;
    }
  });
}

function enforceLimit() {
  while (entries.size >= GROUP_CHAT_METADATA_CACHE_MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) return;
    entries.delete(oldest);
    metrics.evictions += 1;
  }
}

export function clearGroupChatMetadataCache() {
  entries.clear();
}

export function resetGroupChatMetadataCacheMetrics() {
  metrics.hits = 0;
  metrics.misses = 0;
  metrics.expirations = 0;
  metrics.loaderErrors = 0;
  metrics.inFlightJoins = 0;
  metrics.evictions = 0;
  metrics.loads = 0;
  metrics.totalLoadLatencyMs = 0;
  metrics.lastLoadLatencyMs = 0;
  metrics.maxLoadLatencyMs = 0;
}

export function getGroupChatMetadataCacheMetrics(now = Date.now()): GroupChatMetadataCacheMetrics {
  const lookups = metrics.hits + metrics.misses;
  return {
    ...metrics,
    hitRate: lookups === 0 ? 0 : Number((metrics.hits / lookups).toFixed(4)),
    entryCount: entries.size,
    collectedAt: now,
  };
}

export function getOrLoadGroupChatMetadata<T>(
  chatId: number | string,
  loader: () => Promise<T>,
  now = Date.now(),
) {
  const key = keyFor(chatId);
  evictExpired(now);
  const cached = entries.get(key) as CacheEntry<T> | undefined;
  if (cached && cached.value !== undefined && cached.expiresAt > now) {
    metrics.hits += 1;
    return Promise.resolve(cached.value);
  }
  if (cached?.pending) {
    metrics.inFlightJoins += 1;
    return cached.pending;
  }

  metrics.misses += 1;
  enforceLimit();
  const startedAt = Date.now();
  const pending = loader().then(value => {
    const latencyMs = Math.max(0, Date.now() - startedAt);
    metrics.loads += 1;
    metrics.totalLoadLatencyMs += latencyMs;
    metrics.lastLoadLatencyMs = latencyMs;
    metrics.maxLoadLatencyMs = Math.max(metrics.maxLoadLatencyMs, latencyMs);
    entries.set(key, { value, expiresAt: Date.now() + GROUP_CHAT_METADATA_CACHE_TTL_MS });
    return value;
  }).catch(error => {
    metrics.loaderErrors += 1;
    entries.delete(key);
    throw error;
  });
  entries.set(key, { expiresAt: now + GROUP_CHAT_METADATA_CACHE_TTL_MS, pending });
  return pending;
}

export function groupChatMetadataCacheSize() {
  return entries.size;
}
