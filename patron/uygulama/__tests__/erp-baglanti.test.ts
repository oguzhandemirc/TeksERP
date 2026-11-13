// ERP kipi (V3b) saf katman: adres, yoklama, ERP uçları, giriş iletileri, yetenek → görünürlük, 7 günlük önbellek.
import { ApiError, createClient } from "../src/api/client";
import { adresiDuzelt, erpYokla, type Tasima } from "../src/api/baglanti";
import { createErpApi, erpGiris } from "../src/api/erp";
import { BULUT_YETENEK, erpYetenek, izinleriSuz, setYetenek } from "../src/api/yetenek";
import { visibleCards, visibleModules } from "../src/lib/access";
import { createCache, ERP_CACHE_MAX_AGE_MS, purgeExpired } from "../src/state/cache";

const SETS = ["siparis", "siparis-kalemi", "cari-kart", "ozet.siparis", "ozet.sevkiyat", "ozet.uretim", "ozet.stok", "ozet.fason", "ozet-finans", "stok-karnesi", "acik-siparis-karsilama", "tesis"];

function res(status: number, body: unknown): Response {
  return { ok: status < 400, status, json: async () => body, headers: { get: () => null } } as unknown as Response;
}
interface Seen { url: string; init: RequestInit }
function fake(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const t = jest.fn(async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return handler(url, init);
  }) as unknown as Tasima;
  return { t, seen };
}
const ok = (data: unknown) => res(200, { success: true, data });
const fail = (status: number, code?: string) => res(status, { success: false, message: "ret", details: code ? { code } : {} });

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

afterEach(() => setYetenek(BULUT_YETENEK));

describe("sunucu adresi", () => {
  it("https zorunlu; şemasız adrese https eklenir, sondaki / ve /api atılır", () => {
    expect(adresiDuzelt(" erp.fabrika.com/ ")).toBe("https://erp.fabrika.com");
    expect(adresiDuzelt("https://erp.fabrika.com/api/")).toBe("https://erp.fabrika.com");
    expect(adresiDuzelt("https://erp.fabrika.com:8443")).toBe("https://erp.fabrika.com:8443");
    expect(adresiDuzelt("http://erp.fabrika.com")).toBeNull();
    expect(adresiDuzelt("ftp://erp.fabrika.com")).toBeNull();
    expect(adresiDuzelt("")).toBeNull();
    expect(adresiDuzelt("fabrika")).toBeNull();
  });

  it("yoklama: client-policy/patron tanınırsa ERP bağlantısı; bulut/yanlış adres ve ağ hatası Türkçe ileti", async () => {
    const good = fake((url) => (url === "https://erp.x.com/api/client-policy/patron" ? ok({ apiVersion: "1.2.6", minVersion: "0.0.0", currentVersion: "1.2.0" }) : fail(404)));
    const r = await erpYokla("https://erp.x.com", good.t);
    expect(r).toMatchObject({ tamam: true, baglanti: { kip: "erp", tabanAdres: "https://erp.x.com" } });
    expect(good.seen[0]!.init.headers).not.toHaveProperty("Authorization");

    const cloud = fake(() => res(404, { success: false, message: "yok", details: { code: "BULUNAMADI" } }));
    await expect(erpYokla("https://bulut.x.com", cloud.t)).resolves.toEqual({ tamam: false, ileti: "Bu adreste TeksERP sunucusu bulunamadı" });
    const html = fake(() => ({ ok: true, status: 200, json: async () => { throw new Error("html"); } }) as unknown as Response);
    await expect(erpYokla("https://site.x.com", html.t)).resolves.toMatchObject({ tamam: false });
    const down = fake(() => { throw new TypeError("network"); });
    await expect(erpYokla("https://erp.x.com", down.t)).resolves.toMatchObject({ tamam: false, ileti: expect.stringContaining("ulaşılamıyor") });
  });
});

describe("ERP okuma uçları (aynı Api tipi)", () => {
  const caps = erpYetenek(SETS);
  it("okuma /api/patron/v1 altına Bearer ile gider; sorgu bulutla aynı", async () => {
    const f = fake(() => ok({ kayitlar: [], sonraki: null }));
    const api = createErpApi(createClient({ baseUrl: "https://erp.x.com", fetchImpl: f.t, getToken: () => "jwt" }), () => caps);
    await api.list("siparis", { limit: 50, durum: "ACIK" });
    await api.record("cari-kart", "c 1");
    await api.snapshot("ozet.siparis");
    await api.session();
    expect(f.seen.map((s) => s.url)).toEqual([
      "https://erp.x.com/api/patron/v1/veri/siparis?limit=50&durum=ACIK",
      "https://erp.x.com/api/patron/v1/veri/cari-kart/c%201",
      "https://erp.x.com/api/patron/v1/anlik/ozet.siparis",
      "https://erp.x.com/api/patron/v1/oturum",
    ]);
    expect((f.seen[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
  });

  it("sunulmayan küme ve bu kipte olmayan uç AĞA GİTMEDEN 404", async () => {
    const f = fake(() => ok(null));
    const api = createErpApi(createClient({ baseUrl: "https://erp.x.com", fetchImpl: f.t, getToken: () => "jwt" }), () => caps);
    await expect(api.list("sevkiyat")).rejects.toMatchObject({ status: 404, code: "KUME_SUNULMUYOR" });
    await expect(api.snapshot("saglik")).rejects.toMatchObject({ status: 404, code: "KUME_SUNULMUYOR" });
    await expect(api.inboxList()).rejects.toMatchObject({ status: 404, code: "KIP_DESTEKLEMIYOR" });
    await expect(api.refresh()).rejects.toMatchObject({ code: "KIP_DESTEKLEMIYOR" });
    await expect(api.facilities()).resolves.toEqual([]);
    expect(f.seen).toHaveLength(0);
  });
});

describe("ERP girişi", () => {
  const client = (h: (url: string, init: RequestInit) => Response) => {
    const f = fake(h);
    return { f, c: createClient({ baseUrl: "https://erp.x.com", fetchImpl: f.t, getToken: () => null }) };
  };

  it("gövde: username/password/clientType patron; kod boşsa gönderilmez, doluysa totpCode", async () => {
    const { f, c } = client(() => ok({ token: "jwt", user: {}, mustChangePassword: false }));
    await expect(erpGiris(c, { kullanici: "ali", parola: "s3cret", kod: "" })).resolves.toMatchObject({ token: "jwt" });
    await erpGiris(c, { kullanici: "ali", parola: "s3cret", kod: " 123456 " });
    expect(f.seen[0]!.url).toBe("https://erp.x.com/api/auth/login");
    expect(JSON.parse(String(f.seen[0]!.init.body))).toEqual({ username: "ali", password: "s3cret", clientType: "patron" });
    expect(JSON.parse(String(f.seen[1]!.init.body))).toEqual({ username: "ali", password: "s3cret", clientType: "patron", totpCode: "123456" });
  });

  it.each([
    [403, "PATRON_ACCESS_DENIED", "Bu hesabın telefon uygulamasına izni yok"],
    [409, "TOTP_REQUIRED", "Doğrulama kodu gerekli"],
    [401, "TOTP_INVALID", "Doğrulama kodu yanlış"],
    [401, undefined, "Kullanıcı adı veya parola yanlış"],
    [429, "RATE_LIMITED", "Çok fazla deneme; biraz sonra tekrar deneyin"],
    [403, "PASSWORD_CHANGE_REQUIRED", "Parolanızı önce yönetim panelinden değiştirin"],
  ])("%i %s → Türkçe kısa ileti (kod korunur)", async (status, code, msg) => {
    const { c } = client(() => fail(status, code));
    const err = await erpGiris(c, { kullanici: "ali", parola: "p" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe(msg);
    expect((err as ApiError).status).toBe(status);
  });

  it("zorunlu parola değişimi (kısıtlı belirteç) girişi açmaz", async () => {
    const { c } = client(() => ok({ token: "kisitli", user: {}, mustChangePassword: true }));
    await expect(erpGiris(c, { kullanici: "ali", parola: "p" })).rejects.toMatchObject({ code: "PASSWORD_CHANGE_REQUIRED" });
  });

  it("ağ hatası → 'Sunucuya ulaşılamıyor'", async () => {
    const { c } = client(() => { throw new TypeError("x"); });
    await expect(erpGiris(c, { kullanici: "ali", parola: "p" })).rejects.toMatchObject({ status: 0, message: "Sunucuya ulaşılamıyor" });
  });
});

describe("yetenek → görünürlük", () => {
  const ALL = ["bulut:oturum", "bulut:ozet:oku", "bulut:siparis:oku", "bulut:sevkiyat:oku", "bulut:uretim:oku", "bulut:stok:oku", "bulut:cari:oku", "bulut:cari-bakiye:oku", "bulut:kasa:oku", "bulut:teklif:oku", "bulut:maliyet:oku", "bulut:rapor:oku", "bulut:siparis:yaz", "bulut:hesap:yonet"];

  it("ERP: yalnız sunulan kümeli modüller; yazma, gelen kutusu, rapor, bildirim, hesaplar gizli", () => {
    setYetenek(erpYetenek(SETS));
    expect(visibleModules(ALL).map((m) => m.key)).toEqual(["pano", "siparisler", "cariler", "stok", "profil"]);
    expect(visibleCards(ALL).map((c) => c.projection)).toEqual(["ozet.siparis", "ozet.sevkiyat", "ozet.uretim", "ozet.stok", "ozet.fason", "ozet-finans"]);
    expect(izinleriSuz(ALL)).not.toEqual(expect.arrayContaining(["bulut:siparis:yaz"]));
    expect(izinleriSuz(ALL).filter((p) => p.endsWith(":yaz") || p === "bulut:hesap:yonet" || p === "bulut:rapor:oku")).toEqual([]);
  });

  it("ERP: sunucu küme beyan etmezse hiçbir veri modülü açılmaz (fail-closed); kart da yok", () => {
    setYetenek(erpYetenek(undefined));
    expect(visibleModules(ALL).map((m) => m.key)).toEqual(["pano", "profil"]);
    expect(visibleCards(ALL)).toEqual([]);
  });

  it("bulut: bugünkü görünürlük aynen (izin süzgeci etkisiz)", () => {
    setYetenek(BULUT_YETENEK);
    expect(visibleModules(ALL).map((m) => m.key)).toEqual(["pano", "siparisler", "cariler", "sevkiyat", "uretim", "stok", "finans", "teklifler", "standart-maliyetler", "raporlar", "gelen-kutusu", "hesaplar", "bildirimler", "profil"]);
    expect(izinleriSuz(ALL, BULUT_YETENEK)).toEqual(ALL);
  });
});

describe("ERP önbelleği 7 gün", () => {
  const net = () => Promise.reject(new ApiError(0, "AG_HATASI", "x"));
  it("7 günden eski saklı kopya gösterilmez ve silinir; daha tazesi çevrimdışı döner", async () => {
    const s = memStore();
    let now = new Date("2026-11-01T10:00:00Z");
    const c = createCache(s, "erp|https://erp.x.com|u1", () => now, ERP_CACHE_MAX_AGE_MS);
    await c.load("anlik:ozet.siparis", async () => ({ a: 1 }));
    now = new Date("2026-11-08T09:59:00Z");
    await expect(c.load("anlik:ozet.siparis", net)).resolves.toMatchObject({ offline: true, data: { a: 1 } });
    now = new Date("2026-11-08T10:01:00Z");
    await expect(c.load("anlik:ozet.siparis", net)).rejects.toMatchObject({ code: "AG_HATASI" });
    expect(s.m.size).toBe(0);
  });

  it("süre verilmezse (bulut) kopya süresiz kalır", async () => {
    const s = memStore();
    let now = new Date("2026-01-01T00:00:00Z");
    const c = createCache(s, "t1:h1", () => now);
    await c.load("pano", async () => 1);
    now = new Date("2026-11-01T00:00:00Z");
    await expect(c.load("pano", net)).resolves.toMatchObject({ offline: true, data: 1 });
  });

  it("açılış temizliği eski ve bozuk kayıtları siler, tazeyi ve önbellek dışını bırakır", async () => {
    const s = memStore();
    const nowMs = Date.parse("2026-11-13T00:00:00Z");
    s.m.set("patron:onbellek:x:eski", JSON.stringify({ savedAt: "2026-11-01T00:00:00Z", data: 1 }));
    s.m.set("patron:onbellek:x:taze", JSON.stringify({ savedAt: "2026-11-12T00:00:00Z", data: 1 }));
    s.m.set("patron:onbellek:x:bozuk", "{");
    s.m.set("patron.tema", "koyu");
    await purgeExpired(s, ERP_CACHE_MAX_AGE_MS, nowMs);
    expect([...s.m.keys()].sort()).toEqual(["patron.tema", "patron:onbellek:x:taze"]);
  });
});

describe("canlı veri şeridi", () => {
  it("kopukken 'Sunucuya ulaşılamıyor — son güncelleme SS:DD' (fabrika saati)", () => {
    const { liveOfflineText } = require("../src/lib/format") as typeof import("../src/lib/format");
    expect(liveOfflineText("2026-11-13T11:05:00.000Z")).toBe("Sunucuya ulaşılamıyor — son güncelleme 14:05");
    expect(liveOfflineText(null)).toBe("Sunucuya ulaşılamıyor — son güncelleme bilinmiyor");
  });
});
