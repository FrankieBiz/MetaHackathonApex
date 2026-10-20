import type { StateStorage } from "zustand/middleware";
export let recoveryData = "";
export function preserveRecovery(value: unknown) {
  recoveryData =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  try {
    localStorage.setItem("apex-os-workspace-recovery", recoveryData);
  } catch {
    /* Save to the mirror below. */
  }
  void idb("readwrite", (s) =>
    s.put(recoveryData, "apex-os-workspace-recovery"),
  ).catch(() => {});
}
export type StorageStatus = "saved" | "saving" | "error";
let status: StorageStatus = "saved";
const listeners = new Set<() => void>();
export const storageStatus = {
  get: () => status,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
function updateStatus(value: StorageStatus) {
  status = value;
  listeners.forEach((listener) => listener());
}
let database: Promise<IDBDatabase> | undefined;
function db() {
  if (!database)
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("apex-os", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          database = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        database = undefined;
        reject(request.error);
      };
    });
  return database;
}
async function idb<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("state", mode);
    const request = action(transaction.objectStore("state"));
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
function unpack(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (
      parsed.format === "apex-storage-v1" &&
      typeof parsed.value === "string" &&
      typeof parsed.writtenAt === "number"
    )
      return {
        value: parsed.value as string,
        writtenAt: parsed.writtenAt as number,
      };
    return { value, writtenAt: 0 }; // Existing version-one workspaces.
  } catch {
    preserveRecovery(value);
    return null;
  }
}
let writtenAt = 0;
let pending = 0;
let queue = Promise.resolve();
export const persistence: StateStorage = {
  async getItem(key) {
    const recovery = await Promise.allSettled([
      Promise.resolve().then(() =>
        localStorage.getItem("apex-os-workspace-recovery"),
      ),
      idb<string | null>("readonly", (s) =>
        s.get("apex-os-workspace-recovery"),
      ),
    ]);
    recovery.forEach((r) => {
      if (r.status === "fulfilled" && r.value) recoveryData = r.value;
    });
    const values = await Promise.allSettled([
      Promise.resolve().then(() => localStorage.getItem(key)),
      idb<string | null>("readonly", (s) => s.get(key)),
    ]);
    const candidates = values
      .flatMap((r) => (r.status === "fulfilled" ? [unpack(r.value)] : []))
      .filter((v) => v !== null)
      .sort((a, b) => b.writtenAt - a.writtenAt);
    if (values.every((v) => v.status === "rejected")) updateStatus("error");
    writtenAt = Math.max(writtenAt, candidates[0]?.writtenAt ?? 0);
    return candidates[0]?.value ?? null;
  },
  setItem(key, value) {
    writtenAt = Math.max(Date.now(), writtenAt + 1);
    const payload = JSON.stringify({
      format: "apex-storage-v1",
      writtenAt,
      value,
    });
    pending++;
    updateStatus("saving");
    queue = queue.then(async () => {
      let localSaved = false,
        databaseSaved = false;
      try {
        localStorage.setItem(key, payload);
        localSaved = true;
      } catch {
        /* Mirrored IndexedDB can save this write. */
      }
      try {
        await idb("readwrite", (s) => s.put(payload, key));
        databaseSaved = true;
      } catch {
        /* LocalStorage can save this write. */
      }
      pending--;
      if (!localSaved && !databaseSaved) updateStatus("error");
      else if (!pending) updateStatus("saved");
    });
    return queue;
  },
  async removeItem(key) {
    await queue;
    try {
      localStorage.removeItem(key);
    } catch {
      /* Try the mirror. */
    }
    try {
      await idb("readwrite", (s) => s.delete(key));
    } catch {
      /* No available mirror. */
    }
  },
};
