type StorageArea = "local" | "session";

function getStorage(area: StorageArea): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return area === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function safeStorageGet(area: StorageArea, key: string): string | null {
  try {
    return getStorage(area)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeStorageSet(area: StorageArea, key: string, value: string): boolean {
  try {
    const storage = getStorage(area);
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeStorageRemove(area: StorageArea, key: string): boolean {
  try {
    const storage = getStorage(area);
    if (!storage) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function safeStorageAdapter(area: StorageArea): Pick<Storage, "removeItem"> {
  return { removeItem: key => { safeStorageRemove(area, key); } };
}
