import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("localStorage", new MemoryStorage());
});
describe("browser persistence", () => {
  it("recovers the newest IndexedDB write when LocalStorage retains an older snapshot", async () => {
    const { persistence } = await import("../src/lib/persistence");
    await persistence.setItem("workspace", '{"revision":1}');
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
    await persistence.setItem("workspace", '{"revision":2}');
    expect(await persistence.getItem("workspace")).toBe('{"revision":2}');
    await persistence.removeItem("workspace");
    expect(await persistence.getItem("workspace")).toBeNull();
  });
  it("preserves unreadable data as a recovery file", async () => {
    localStorage.setItem("broken", "{unreadable-workspace");
    const storage = await import("../src/lib/persistence");
    expect(await storage.persistence.getItem("broken")).toBeNull();
    expect(storage.recoveryData).toBe("{unreadable-workspace");
    expect(localStorage.getItem("apex-os-workspace-recovery")).toBe(
      "{unreadable-workspace",
    );
  });
  it("serializes rapid edits and reads legacy storage", async () => {
    localStorage.setItem("legacy", '{"state":{"name":"Frankie"},"version":1}');
    const { persistence, storageStatus } = await import(
      "../src/lib/persistence"
    );
    expect(await persistence.getItem("legacy")).toContain("Frankie");
    await Promise.all([
      persistence.setItem("workspace", '{"revision":1}'),
      persistence.setItem("workspace", '{"revision":2}'),
      persistence.setItem("workspace", '{"revision":3}'),
    ]);
    expect(await persistence.getItem("workspace")).toBe('{"revision":3}');
    expect(storageStatus.get()).toBe("saved");
  });
  it("reports failure when both stores are unavailable and recovers when a write succeeds", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const { persistence, storageStatus } = await import(
      "../src/lib/persistence"
    );
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Disabled");
    });
    await persistence.setItem("workspace", "{}");
    expect(storageStatus.get()).toBe("error");
    setItem.mockRestore();
    await persistence.setItem("workspace", "{}");
    expect(storageStatus.get()).toBe("saved");
  });
});
