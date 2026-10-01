import { readFileSync } from "fs";
import { join } from "path";
import { ApiError } from "../src/api/client";
import { clearCache, createCache, openingCacheHygiene } from "../src/state/cache";
import { browserStore } from "../src/state/browser-store";

function memStore() {
  const m = new Map<string, string>();
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    set: async (k: string, v: string) => void m.set(k, v),
    remove: async (k: string) => void m.delete(k),
    keys: async () => [...m.keys()],
    removeMany: async (ks: readonly string[]) => ks.forEach((k) => m.delete(k)),
  };
}
const net = () => Promise.reject(new ApiError(0, "AG_HATASI", "x"));

describe("çevrimdışı salt-okunur önbellek", () => {
  it("çevrimiçi okuma saklanır; ağ hatasında son veri 'çevrimdışı' damgasıyla döner", async () => {
    const s = memStore();
    const c = createCache(s, "t1:h1", () => new Date("2026-09-29T10:00:00Z"));
    await expect(c.load("pano", async () => ({ a: 1 }))).resolves.toEqual({ data: { a: 1 }, offline: false, savedAt: "2026-09-29T10:00:00.000Z" });
    await expect(c.load("pano", net)).resolves.toEqual({ data: { a: 1 }, offline: true, savedAt: "2026-09-29T10:00:00.000Z" });
  });
  it("önbellek yoksa ağ hatası yukarı çıkar", async () => {
    const c = createCache(memStore(), "t1:h1");
    await expect(c.load("yok", net)).rejects.toMatchObject({ code: "AG_HATASI" });
  });
  it("403'te saklı kopya silinir (izni kalkan veri gösterilmez)", async () => {
    const s = memStore();
    const c = createCache(s, "t1:h1");
    await c.load("finans", async () => 1);
    await expect(c.load("finans", () => Promise.reject(new ApiError(403, "YETKI_YOK", "x")))).rejects.toBeInstanceOf(ApiError);
    await expect(c.load("finans", net)).rejects.toMatchObject({ code: "AG_HATASI" });
  });
  it("401/409/5xx önbellekten cevaplanmaz", async () => {
    const c = createCache(memStore(), "t1:h1");
    await c.load("x", async () => 1);
    await expect(c.load("x", () => Promise.reject(new ApiError(503, "SUNUCU_HATASI", "x")))).rejects.toMatchObject({ status: 503 });
    await expect(c.load("x", () => Promise.reject(new ApiError(401, "OTURUM_YOK", "x")))).rejects.toMatchObject({ status: 401 });
  });
  it("kapsam hesap+tesis; çıkışta yalnız önbellek anahtarları silinir", async () => {
    const s = memStore();
    await createCache(s, "t1:h1").load("a", async () => 1);
    await expect(createCache(s, "t1:h2").load("a", net)).rejects.toBeInstanceOf(ApiError);
    s.m.set("baska", "x");
    await clearCache(s);
    expect([...s.m.keys()]).toEqual(["baska"]);
  });
});

describe("açılış hijyeni + web deposu (G19)", () => {
  /** Bellek içi `Storage` (sessionStorage/localStorage yerine). */
  function fakeStorage(): Storage {
    const m = new Map<string, string>();
    return {
      get length() {
        return m.size;
      },
      key: (i: number) => [...m.keys()][i] ?? null,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      clear: () => m.clear(),
    };
  }
  it("browserStore: anahtarları listeler, toplu siler; depo yoksa boş davranır", async () => {
    const st = fakeStorage();
    const s = browserStore(st);
    await s.set("patron:onbellek:t:h:pano", "{}");
    await s.set("baska", "x");
    expect([...(await s.keys())].sort()).toEqual(["baska", "patron:onbellek:t:h:pano"]);
    await clearCache(s);
    expect(await s.keys()).toEqual(["baska"]);
    const yok = browserStore(undefined);
    await expect(yok.get("x")).resolves.toBeNull();
    await expect(yok.keys()).resolves.toEqual([]);
  });
  it("oturum yoksa düz depodaki önbellek silinir; eski kalıcı (localStorage) önbellek her açılışta silinir", async () => {
    const plain = memStore();
    const legacy = memStore();
    plain.m.set("patron:onbellek:t1:h1:pano", "{}");
    legacy.m.set("patron:onbellek:t1:h1:cari", "{}");
    legacy.m.set("tercih", "x");
    await openingCacheHygiene({ plain, legacy, hasSession: true });
    expect([...plain.m.keys()]).toEqual(["patron:onbellek:t1:h1:pano"]);
    expect([...legacy.m.keys()]).toEqual(["tercih"]);
    await openingCacheHygiene({ plain, legacy: null, hasSession: false });
    expect([...plain.m.keys()]).toEqual([]);
  });
  it("web'de önbellek deposu sessionStorage'dır (localStorage yalnız eski önbelleği silmek için okunur)", () => {
    const src = readFileSync(join(__dirname, "..", "src", "state", "store.ts"), "utf8");
    const plain = /export const plainStore[^;]*;/s.exec(src)?.[0] ?? "";
    const legacy = /export const legacyPlainStore[^;]*;/s.exec(src)?.[0] ?? "";
    expect(plain).toMatch(/web\s*\?\s*browserStore\(browser\.sessionStorage\)/);
    expect(plain).not.toMatch(/localStorage/);
    expect(legacy).toMatch(/localStorage/);
  });
  it("Android yedeği kapalı (allowBackup: false) — önbellek bulut yedeğine girmez", () => {
    const app = JSON.parse(readFileSync(join(__dirname, "..", "app.json"), "utf8")) as { expo: { android?: { allowBackup?: unknown } } };
    expect(app.expo.android?.allowBackup).toBe(false);
  });
});
