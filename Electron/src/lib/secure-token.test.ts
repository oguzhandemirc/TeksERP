import { describe, it, expect, vi, beforeEach } from "vitest";

// tokenStore modül-içi cache tutar → her test taze modül ister (resetModules +
// dinamik import). window.api köprüsü test başına mock'lanır.
function makeApi(diskValue: string | null = "disk-token") {
  return {
    get: vi.fn(async () => diskValue),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
}

async function loadTokenStore(api: ReturnType<typeof makeApi>) {
  (window as unknown as { api: unknown }).api = { secureStore: api };
  const mod = await import("./secure-token");
  return mod.tokenStore;
}

beforeEach(() => {
  vi.resetModules();
});

describe("tokenStore bellek cache'i", () => {
  it("ilk get IPC'den prime eder; sonraki get'ler IPC'ye DÖNMEZ", async () => {
    const api = makeApi();
    const ts = await loadTokenStore(api);
    expect(await ts.get()).toBe("disk-token");
    expect(await ts.get()).toBe("disk-token");
    expect(await ts.get()).toBe("disk-token");
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("set diski yazar VE cache'i günceller — get IPC'siz yeni değeri döner", async () => {
    const api = makeApi();
    const ts = await loadTokenStore(api);
    await ts.set("yeni-token");
    expect(api.set).toHaveBeenCalledWith("auth.token", "yeni-token");
    expect(await ts.get()).toBe("yeni-token");
    expect(api.get).not.toHaveBeenCalled(); // set prime etti, IPC get hiç gerekmedi
  });

  it("clear sonrası get null (IPC'siz) ve disk delete çağrıldı", async () => {
    const api = makeApi();
    const ts = await loadTokenStore(api);
    await ts.set("t");
    await ts.clear();
    expect(api.delete).toHaveBeenCalledWith("auth.token");
    expect(await ts.get()).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("clear'da disk silme HATASINDA bile cache null — istekler token kullanmayı bırakır (güvenli yön)", async () => {
    const api = makeApi();
    api.delete.mockRejectedValueOnce(new Error("ipc down"));
    const ts = await loadTokenStore(api);
    await ts.set("t");
    await expect(ts.clear()).rejects.toThrow("ipc down");
    expect(await ts.get()).toBeNull();
  });

  it("set disk yazımı reddederse cache ESKİ doğru değerde kalır", async () => {
    const api = makeApi();
    const ts = await loadTokenStore(api);
    await ts.set("eski");
    api.set.mockRejectedValueOnce(new Error("disk"));
    await expect(ts.set("yeni")).rejects.toThrow("disk");
    expect(await ts.get()).toBe("eski");
  });
});
