// Browser storage access that never throws (private mode, denied access, SSR).

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PROBE_KEY = "r39x.storage-probe";

export function createInMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

// One shared fallback so that the api port and the auth port keep seeing the same state.
let sharedFallback: StorageLike | null = null;
function fallbackStorage(): StorageLike {
  sharedFallback ??= createInMemoryStorage();
  return sharedFallback;
}

function defaultGetLocal(): StorageLike | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function resolveBrowserStorage(
  getLocal: () => StorageLike | null = defaultGetLocal,
): StorageLike {
  try {
    const local = getLocal();
    if (local === null) return fallbackStorage();
    local.setItem(PROBE_KEY, "1");
    local.removeItem(PROBE_KEY);
    return local;
  } catch {
    return fallbackStorage();
  }
}
