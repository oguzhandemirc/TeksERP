import { ApiError } from "../src/api/client";
import { clearCache, createCache } from "../src/state/cache";

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
