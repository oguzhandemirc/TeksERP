// S0 — telefon bildirim sesi: küme + kanal kimliği (bulut teliyle aynı vektörler), seçimin cihaz kaydına gidişi
// (eski fabrika 400'ünde alansız yeniden deneme), hazır düğme/grup gövdeleri, Android kanal kurulumu/temizliği.
// Portlar ve expo-notifications taklit; ağ/cihaz yok.
// NEGATİF SONDA (2026-11-14, geri alındı): 400 kodu eşleşmeyince ve `varsayilan` silinmeyince 2 ❌.
import { Platform } from "react-native";

const mockN = {
  kanallar: [] as { id: string }[],
  kur: jest.fn(async (_id: string, _o: Record<string, unknown>) => undefined),
  sil: jest.fn(async (_id: string) => undefined),
  planla: jest.fn(async (_r: unknown) => "n1"),
};
jest.mock("expo-notifications", () => ({
  AndroidImportance: { HIGH: 4, MAX: 5 },
  setNotificationChannelAsync: (id: string, o: Record<string, unknown>) => mockN.kur(id, o),
  getNotificationChannelsAsync: jest.fn(async () => mockN.kanallar),
  deleteNotificationChannelAsync: (id: string) => mockN.sil(id),
  scheduleNotificationAsync: (r: unknown) => mockN.planla(r),
}));
jest.mock("../src/push/taps-native", () => ({}));

const ses = require("../src/push/sesler") as typeof import("../src/push/sesler");
const ep = require("../src/push/erp-push") as typeof import("../src/push/erp-push");
const bil = require("../src/api/bildirim") as typeof import("../src/api/bildirim");
const { ApiError } = require("../src/api/client") as typeof import("../src/api/client");
const kn = require("../src/push/kanallar-native") as typeof import("../src/push/kanallar-native");
type Tercihler = import("../src/api/bildirim").Tercihler;

function depo() {
  const m = new Map<string, string>();
  return { m, kv: { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => void m.set(k, v), remove: async (k: string) => void m.delete(k) } };
}
function portlar() {
  return {
    platform: "android" as const,
    izinOku: jest.fn(async () => "VERILDI" as const),
    izinIste: jest.fn(async () => "VERILDI" as const),
    belirtecAl: jest.fn(async () => "ExponentPushToken[ses12345]"),
    belirtecDegisince: jest.fn(() => () => undefined),
    cihazAdi: jest.fn(() => "Telefon"),
    kanallariKur: jest.fn(async () => undefined),
    sesiOnizle: jest.fn(async () => undefined),
    kanalAyariniAc: jest.fn(async () => undefined),
  };
}
function cihazci() {
  return { kaydet: jest.fn(async (_b: unknown) => ({ kayitli: true })), birak: jest.fn(), katalog: jest.fn(), tercihler: jest.fn(), tercihYaz: jest.fn() };
}

describe("ses kümesi ve kanal kimliği", () => {
  it("⭐ kanal kimliği seçimden türer; bulut §13f ile aynı vektörler", () => {
    expect(ses.kanalKimligi("BILDIRIM", "tekserp_zil")).toBe("tekserp-bildirim-zil");
    expect(ses.kanalKimligi("ALARM", "sessiz")).toBe("tekserp-alarm-sessiz");
    expect(ses.kanalKimligi("ALARM", "tekserp_dokuma")).toBe("tekserp-alarm-dokuma");
    expect(ses.kanalKimligi("BILDIRIM", "varsayilan")).toBe("tekserp-bildirim-varsayilan");
    // Her (sınıf, ses) çifti ayrı kanal (Android kanal sesi sonradan değişmez).
    const hepsi = (["BILDIRIM", "ALARM"] as const).flatMap((s) => ses.SESLER.map((x) => ses.kanalKimligi(s, x)));
    expect(new Set(hepsi).size).toBe(hepsi.length);
  });
  it("ses dosyası: gömülü .wav · telefon varsayılanı 'default' · sessiz null", () => {
    expect(ses.sesDosyasi("tekserp_mekik")).toBe("tekserp_mekik.wav");
    expect(ses.sesDosyasi("varsayilan")).toBe("default");
    expect(ses.sesDosyasi("sessiz")).toBeNull();
  });
  it("⭐ bozuk/eksik/bilinmeyen saklı seçim → varsayılana düşer (alan bazında)", () => {
    expect(ses.sesSecimiOku(null)).toEqual(ses.VARSAYILAN_SES);
    expect(ses.sesSecimiOku("{bozuk")).toEqual(ses.VARSAYILAN_SES);
    expect(ses.sesSecimiOku(JSON.stringify({ bildirim: "gong", alarm: "sessiz" }))).toEqual({ bildirim: "tekserp_zil", alarm: "sessiz" });
    expect(ses.sesSecimiOku(JSON.stringify({ bildirim: "tekserp_kisa" }))).toEqual({ bildirim: "tekserp_kisa", alarm: "tekserp_alarm" });
  });
});

describe("cihaz kaydında ses", () => {
  const baglam = (c: ReturnType<typeof cihazci>, p: ReturnType<typeof portlar>, kv: ReturnType<typeof depo>["kv"], acik = true) =>
    ({ acik, adres: "https://a.fabrika.com", cihazci: c as never, store: kv, portlar: () => p as never });

  it("⭐ varsayılan seçimde kaydet gövdesinde ses alanı YOK (eski fabrika katı şeması kırılmaz)", async () => {
    const c = cihazci();
    const d = depo();
    await expect(ep.erpPushEtkinlestir(baglam(c, portlar(), d.kv), { iste: false })).resolves.toEqual({ kind: "KAYITLI" });
    expect(c.kaydet).toHaveBeenCalledTimes(1);
    expect(c.kaydet.mock.calls[0]![0]).toEqual({ belirtec: "ExponentPushToken[ses12345]", platform: "android", cihazAdi: "Telefon" });
  });
  it("⭐ sapan seçimde sesBildirim/sesAlarm gider", async () => {
    const c = cihazci();
    const d = depo();
    await ses.sesSecimiKaydet(d.kv, { bildirim: "tekserp_kisa", alarm: "sessiz" });
    await ep.erpPushEtkinlestir(baglam(c, portlar(), d.kv), { iste: false });
    expect(c.kaydet.mock.calls[0]![0]).toEqual(expect.objectContaining({ sesBildirim: "tekserp_kisa", sesAlarm: "sessiz" }));
  });
  it("⭐ eski fabrika 400 PATRON_PUSH_GOVDE → alansız TEK yeniden deneme, kayıt başarılı", async () => {
    const c = cihazci();
    const d = depo();
    await ses.sesSecimiKaydet(d.kv, { bildirim: "tekserp_mekik", alarm: "tekserp_alarm" });
    c.kaydet.mockRejectedValueOnce(new ApiError(400, "PATRON_PUSH_GOVDE", "Geçersiz gövde"));
    await expect(ep.erpPushEtkinlestir(baglam(c, portlar(), d.kv), { iste: false })).resolves.toEqual({ kind: "KAYITLI" });
    expect(c.kaydet).toHaveBeenCalledTimes(2);
    expect(c.kaydet.mock.calls[1]![0]).not.toHaveProperty("sesBildirim");
    expect(c.kaydet.mock.calls[1]![0]).not.toHaveProperty("sesAlarm");
  });
  it("başka hata (500 / başka kod) yeniden denenmez, yukarı çıkar", async () => {
    for (const err of [new ApiError(500, "SUNUCU", "x"), new ApiError(400, "BASKA", "x")]) {
      const c = cihazci();
      const d = depo();
      await ses.sesSecimiKaydet(d.kv, { bildirim: "tekserp_mekik", alarm: "tekserp_alarm" });
      c.kaydet.mockRejectedValueOnce(err);
      await expect(ep.erpPushEtkinlestir(baglam(c, portlar(), d.kv), { iste: false })).rejects.toBe(err);
      expect(c.kaydet).toHaveBeenCalledTimes(1);
    }
  });
  it("⭐ erpPushSesDegistir: seçim saklanır → kanallar kurulur → kayıt yeni sesle yenilenir", async () => {
    const c = cihazci();
    const p = portlar();
    const d = depo();
    const yeni = { bildirim: "tekserp_dokuma" as const, alarm: "varsayilan" as const };
    await expect(ep.erpPushSesDegistir(baglam(c, p, d.kv), yeni)).resolves.toEqual({ kind: "KAYITLI" });
    expect(await ses.sesSecimiYukle(d.kv)).toEqual(yeni);
    expect(p.kanallariKur).toHaveBeenCalledWith(yeni);
    expect(c.kaydet.mock.calls[0]![0]).toEqual(expect.objectContaining({ sesBildirim: "tekserp_dokuma", sesAlarm: "varsayilan" }));
  });
  it("kapı kapalı → yalnız yerelde saklanır; port/ağ yok", async () => {
    const c = cihazci();
    const p = portlar();
    const d = depo();
    await expect(ep.erpPushSesDegistir(baglam(c, p, d.kv, false), { bildirim: "sessiz", alarm: "sessiz" })).resolves.toEqual({ kind: "KAPALI" });
    expect(d.m.get(ses.SES_KEY)).toBeDefined();
    expect(p.kanallariKur).not.toHaveBeenCalled();
    expect(c.kaydet).not.toHaveBeenCalled();
  });
});

describe("hazır düğmeler ve gruplar (gövde)", () => {
  const T: Tercihler = {
    hucreler: [
      { kind: "dokuma.tezgah-alarmi", kanallar: [{ kanal: "UYGULAMA", durum: "ACIK", kilit: false }, { kanal: "PATRON_PUSH", durum: "KAPALI", kilit: false }] },
      { kind: "guvenlik.giris", kanallar: [{ kanal: "PATRON_PUSH", durum: "KAPALI", kilit: false }] },
      { kind: "siparis.termin-gecti", kanallar: [{ kanal: "UYGULAMA", durum: "ACIK", kilit: false }, { kanal: "PATRON_PUSH", durum: "ACIK", kilit: false }] },
      { kind: "sistem.disk", kanallar: [{ kanal: "PATRON_PUSH", durum: "KAPALI", kilit: false }] },
    ],
    satirlar: [{ tur: "siparis.termin-gecti", kanal: "UYGULAMA", acik: true, kapsam: { yalnizTakip: true } }],
  };
  const K = [
    { kod: "dokuma.tezgah-alarmi", ad: "Tezgâh alarmı", grup: "Dokuma", sinif: "ALARM" },
    { kod: "guvenlik.giris", ad: "Giriş", grup: "Sistem", varsayilanKanallar: ["UYGULAMA", "PATRON_PUSH"] },
    { kod: "siparis.termin-gecti", ad: "Termin", grup: "Satış", varsayilanKanallar: ["UYGULAMA"] },
    { kod: "sistem.disk", ad: "Disk" },
  ];
  it("⭐ HEPSI / ONEMLI / HICBIRI yalnız DEĞİŞEN hücreleri döner", () => {
    expect([...bil.hazirSecimDegisimi(T, K, "HEPSI")]).toEqual([["dokuma.tezgah-alarmi", true], ["guvenlik.giris", true], ["sistem.disk", true]]);
    expect([...bil.hazirSecimDegisimi(T, K, "HICBIRI")]).toEqual([["siparis.termin-gecti", false]]);
    // Önemli = ALARM sınıfı ∨ telefon varsayılanı açık tür.
    expect([...bil.hazirSecimDegisimi(T, K, "ONEMLI")]).toEqual([["dokuma.tezgah-alarmi", true], ["guvenlik.giris", true], ["siparis.termin-gecti", false]]);
  });
  it("gruplar katalog grubundan; grupsuz tür 'Diğer'", () => {
    expect(bil.pushGruplari(T, K).map((g) => [g.grup, g.hucreler.map((h) => h.tur)])).toEqual([
      ["Dokuma", ["dokuma.tezgah-alarmi"]], ["Sistem", ["guvenlik.giris"]], ["Satış", ["siparis.termin-gecti"]], ["Diğer", ["sistem.disk"]],
    ]);
  });
  it("⭐ toplu gövde: öteki satırlar (kapsamıyla) aynen, değişenler PATRON_PUSH satırı olarak", () => {
    expect(bil.pushTercihGovdesiToplu(T, new Map([["guvenlik.giris", true], ["sistem.disk", false]]))).toEqual([
      { tur: "siparis.termin-gecti", kanal: "UYGULAMA", acik: true, kapsam: { yalnizTakip: true } },
      { tur: "guvenlik.giris", kanal: "PATRON_PUSH", acik: true },
      { tur: "sistem.disk", kanal: "PATRON_PUSH", acik: false },
    ]);
  });
});

describe("Android kanalları (kanallar-native)", () => {
  let restore: { restore(): void };
  beforeEach(() => {
    restore = jest.replaceProperty(Platform, "OS", "android");
    mockN.kur.mockClear();
    mockN.sil.mockClear();
    mockN.planla.mockClear();
    mockN.kanallar = [];
  });
  afterEach(() => restore.restore());

  it("⭐ iki kanal kurulur (alarm MAX, bildirim HIGH); eski 'varsayilan' ve seçilmeyen tekserp-* silinir, yabancı kanal kalır", async () => {
    mockN.kanallar = [{ id: "varsayilan" }, { id: "tekserp-bildirim-zil" }, { id: "tekserp-alarm-mekik" }, { id: "tekserp-bildirim-kisa" }, { id: "baska-kanal" }];
    await kn.kanallariKur({ bildirim: "tekserp_kisa", alarm: "sessiz" });
    expect(mockN.kur.mock.calls.map((c) => c[0])).toEqual(["tekserp-bildirim-kisa", "tekserp-alarm-sessiz"]);
    expect(mockN.kur.mock.calls[0]![1]).toEqual(expect.objectContaining({ importance: 4, sound: "tekserp_kisa.wav" }));
    expect(mockN.kur.mock.calls[1]![1]).toEqual(expect.objectContaining({ importance: 5, sound: null, enableVibrate: true }));
    expect(mockN.sil.mock.calls.map((c) => c[0]).sort()).toEqual(["tekserp-alarm-mekik", "tekserp-bildirim-zil", "varsayilan"]);
  });
  it("telefon varsayılanı → kanal 'sound' alanı verilmez (sistem sesi)", async () => {
    await kn.kanallariKur({ bildirim: "varsayilan", alarm: "tekserp_alarm" });
    expect(mockN.kur.mock.calls[0]![1]).not.toHaveProperty("sound");
  });
  it("önizleme seçilen sesin kanalında yerel bildirim planlar", async () => {
    await kn.sesiOnizle("ALARM", "tekserp_dokuma", ses.VARSAYILAN_SES);
    expect(mockN.kur.mock.calls.map((c) => c[0])).toEqual(["tekserp-bildirim-zil", "tekserp-alarm-dokuma"]);
    expect(mockN.planla).toHaveBeenCalledWith(expect.objectContaining({ trigger: { channelId: "tekserp-alarm-dokuma" } }));
  });
  it("Android dışı → kanal kurulmaz", async () => {
    restore.restore();
    restore = jest.replaceProperty(Platform, "OS", "ios");
    await kn.kanallariKur(ses.VARSAYILAN_SES);
    expect(mockN.kur).not.toHaveBeenCalled();
  });
});
