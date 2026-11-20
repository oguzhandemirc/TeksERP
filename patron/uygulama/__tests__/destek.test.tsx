// Destek (Etkili Destek, bulut `/api/destek/*`): çizim durumu · form doğrulama + gövde · clientToken tek üretim ve
// belirsiz hatada aynı token · çift dokunuş tek istek · kapalıyken görünmezlik (durum false / 404 / MODULE_DISABLED) ·
// rozet yoklamasının hatayı yutması · bildirim yönlendirmesi · bağlamda sır yok · hata cümleleri.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ApiError } from "../src/api/client";
import type { DestekTalep } from "../src/api/destek-wire";

const T1 = "5f0c2a1e-8d4b-4c61-9a57-1d2e3f4a5b6c";
const TALEP: DestekTalep = {
  id: T1, number: "DST-2026-000123", type: "BUG", status: "NEW", subject: "Liste açılmıyor",
  createdAt: "2026-11-16T09:12:44.120Z", updatedAt: "2026-11-16T09:12:44.120Z", closedAt: null, messages: [],
};

const mockApi = {
  inboxList: jest.fn(async (_p: unknown) => ({ kayitlar: [], sonraki: null })),
  supportStatus: jest.fn(async () => ({ etkin: true })),
  supportUnread: jest.fn(async (_s?: string) => ({ count: 3, tickets: 2 })),
  supportCreate: jest.fn(async (_b: unknown): Promise<DestekTalep> => TALEP),
};
const mockSession = {
  api: mockApi, permissions: ["bulut:hesap:yonet"] as string[], facility: { tesis: { id: "t", ad: "Örnek Tekstil", saklamaAy: 13 }, hesap: { id: "h", ad: "Ayşe Yılmaz", eposta: "ayse@ornek.com", izinler: [] }, esitleme: null } as unknown,
  facilityId: "t", facilities: [] as unknown[], bildirimci: { ozet: jest.fn() }, offline: false, offlineSince: null, logout: jest.fn(),
};
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("../src/state/useRemote", () => ({
  useRemote: () => ({ data: null, error: null, loading: false, refreshing: false, stale: false, offline: false, savedAt: null, reload: jest.fn() }),
}));
const mockRouter = { push: jest.fn(), back: jest.fn(), canGoBack: () => false, replace: jest.fn(), navigate: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => "/siparisler/abc?ara=gizli", useLocalSearchParams: () => ({}) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("expo-notifications", () => ({ setNotificationHandler: jest.fn() }));

const C = require("../src/destek/cizim") as typeof import("../src/destek/cizim");
const F = require("../src/destek/form") as typeof import("../src/destek/form");
const G = require("../src/destek/gorunurluk") as typeof import("../src/destek/gorunurluk");
const M = require("../src/destek/metin") as typeof import("../src/destek/metin");
const B = require("../src/destek/baglam") as typeof import("../src/destek/baglam");
const Tas = require("../src/destek/taslak") as typeof import("../src/destek/taslak");
const { openNotification } = require("../src/push/taps") as typeof import("../src/push/taps");
const { safeRoute } = require("../src/lib/notification-form") as typeof import("../src/lib/notification-form");
const More = (require("../app/(app)/(tabs)/diger") as typeof import("../app/(app)/(tabs)/diger")).default;
const Yeni = (require("../app/(app)/destek/yeni") as typeof import("../app/(app)/destek/yeni")).default;

const ag = () => new ApiError(0, "AG_HATASI", "Sunucuya ulaşılamadı");
const kod = (status: number, code: string, details: Record<string, unknown> = {}) => new ApiError(status, code, "Merkez mesajı", { code, ...details });

beforeEach(() => {
  jest.clearAllMocks();
  G.destekSifirla(null);
  Tas.taslagiTemizle();
});

describe("çizim durumu", () => {
  const p = (x: number, y: number) => ({ x, y });
  it("kalem izi birikir; tek dokunuş ve küçük kutu eklenmez; geri al / temizle", () => {
    let d = C.cizimReducer(C.BOS_CIZIM, { tip: "basla", arac: "kalem", renk: "kirmizi", nokta: p(0, 0) });
    d = C.cizimReducer(d, { tip: "ilerle", nokta: p(10, 10) });
    d = C.cizimReducer(d, { tip: "ilerle", nokta: p(10.5, 10.5) }); // adımdan kısa → atlanır
    d = C.cizimReducer(d, { tip: "bitir" });
    expect(d.sekiller).toHaveLength(1);
    expect(d.sekiller[0]!.noktalar).toHaveLength(2);
    d = C.cizimReducer(d, { tip: "basla", arac: "kutu", renk: "mavi", nokta: p(5, 5) });
    d = C.cizimReducer(d, { tip: "ilerle", nokta: p(7, 50) });
    d = C.cizimReducer(d, { tip: "bitir" });
    expect(d.sekiller).toHaveLength(1); // 2 dp genişlik → yanlışlıkla dokunma
    d = C.cizimReducer(d, { tip: "basla", arac: "karart", renk: "sari", nokta: p(50, 50) });
    d = C.cizimReducer(d, { tip: "ilerle", nokta: p(10, 10) });
    d = C.cizimReducer(d, { tip: "bitir" });
    expect(d.sekiller.map((s) => s.arac)).toEqual(["kalem", "karart"]);
    expect(C.dikdortgen(p(50, 50), p(10, 10))).toEqual({ x: 10, y: 10, w: 40, h: 40 });
    d = C.cizimReducer(d, { tip: "geriAl" });
    expect(d.sekiller.map((s) => s.arac)).toEqual(["kalem"]);
    d = C.cizimReducer(d, { tip: "temizle" });
    expect(d.sekiller).toEqual([]);
  });
  it("çıktı uzun kenarı ≤ 1920 px, oran korunur; küçük görüntü büyütülmez", () => {
    expect(C.uzunKenaraSigdir(1290, 2796)).toEqual({ width: 886, height: 1920 });
    expect(C.uzunKenaraSigdir(800, 600)).toEqual({ width: 800, height: 600 });
    expect(C.okYolu(p(0, 0), p(100, 0)).startsWith("M0 0 L100 0")).toBe(true);
  });
});

describe("form doğrulama ve gövde", () => {
  it("tür/konu/mesaj zorunlu, sınırlar kırpılmış metinle", () => {
    expect(F.formuDogrula({ tur: null, konu: "  ", mesaj: "" })).toEqual({ tur: "Talep türünü seçin", konu: "Konu yazın", mesaj: "Sorunu kısaca anlatın" });
    expect(F.hataYokMu(F.formuDogrula({ tur: "QUESTION", konu: " a ", mesaj: "b" }))).toBe(true);
    expect(F.formuDogrula({ tur: "BUG", konu: "x".repeat(201), mesaj: "m" }).konu).toMatch(/200/);
    expect(F.yanitGecerliMi("   ")).toBe(false);
  });
  it("gövde: kimlik alanı yok, ek yalnız görüntü varsa, data: öneki atılır", () => {
    const g = F.talepGovdesi({ form: { tur: "REQUEST", konu: " K ", mesaj: " M " }, clientToken: "tok", baglam: { screen: "S" }, ekranJpegBase64: "data:image/jpeg;base64,QUJD\nREVG" });
    expect(g).toEqual({ type: "REQUEST", subject: "K", message: "M", clientToken: "tok", context: { screen: "S" }, files: [{ name: "ekran.jpg", contentType: "image/jpeg", dataBase64: "QUJDREVG" }] });
    expect(Object.keys(g)).not.toContain("user");
    expect(F.talepGovdesi({ form: { tur: "BUG", konu: "k", mesaj: "m" }, clientToken: "t", baglam: {}, ekranJpegBase64: null })).not.toHaveProperty("files");
  });
  it("token: belirsiz hata (ağ/5xx) ve 429'da aynı, kesin 4xx'te yeni", () => {
    const gen = jest.fn(() => "yeni");
    expect(F.hataSonrasiToken("eski", ag(), gen)).toBe("eski");
    expect(F.hataSonrasiToken("eski", kod(502, "DESTEK_ULASILAMADI"), gen)).toBe("eski");
    expect(F.hataSonrasiToken("eski", kod(504, "DESTEK_ZAMAN_ASIMI"), gen)).toBe("eski");
    expect(F.hataSonrasiToken("eski", kod(429, "RATE_LIMITED"), gen)).toBe("eski");
    expect(gen).not.toHaveBeenCalled();
    expect(F.hataSonrasiToken("eski", kod(400, "SUBJECT_EMPTY"), gen)).toBe("yeni");
  });
  it("belirsiz yanıt hatasından sonra yeniden okunan talepte yanıtımız varsa işlenmiş sayılır", () => {
    const m = (kind: "CUSTOMER" | "AGENT_REPLY", body: string) => ({ id: body, kind, body, authorName: null, authorExternalUserId: null, createdAt: "", attachments: [] });
    const t = { ...TALEP, messages: [m("CUSTOMER", "ilk"), m("CUSTOMER", " yanıtım ")] };
    expect(F.yanitIslendiMi(1, t, "yanıtım")).toBe(true);
    expect(F.yanitIslendiMi(2, t, "yanıtım")).toBe(false);
    expect(F.yanitIslendiMi(1, null, "yanıtım")).toBe(false);
  });
});

describe("talep formu ekranı: clientToken ve çift dokunuş", () => {
  async function doldur() {
    render(<Yeni />);
    fireEvent.changeText(screen.getByTestId("destek-konu"), "Liste açılmıyor");
    fireEvent.changeText(screen.getByTestId("destek-mesaj"), "Siparişler boş geliyor");
  }
  it("⭐ formun başında gönderen hesabın adı ve e-postası görünür (App Store koşulu)", async () => {
    await doldur();
    expect(screen.getByTestId("destek-gonderen")).toHaveTextContent("Gönderen: Ayşe Yılmaz (ayse@ornek.com)");
  });
  it("ağ hatasında form kapanmaz, ikinci deneme AYNI token'la; başarıda ayrıntıya geçilir", async () => {
    mockApi.supportCreate.mockRejectedValueOnce(ag());
    await doldur();
    await act(async () => void fireEvent.press(screen.getByTestId("destek-gonder")));
    expect(screen.getByTestId("destek-gonder-hata")).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await act(async () => void fireEvent.press(screen.getByTestId("destek-gonder")));
    const tok = mockApi.supportCreate.mock.calls.map((c) => (c[0] as { clientToken: string }).clientToken);
    expect(tok).toHaveLength(2);
    expect(tok[0]).toBe(tok[1]);
    expect(tok[0]).toMatch(/^[A-Za-z0-9_.:-]{1,100}$/);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/destek/[id]", params: { id: T1 } });
  });
  it("kesin 4xx'ten sonra yeni token", async () => {
    mockApi.supportCreate.mockRejectedValueOnce(kod(400, "MESSAGE_TOO_LONG"));
    await doldur();
    await act(async () => void fireEvent.press(screen.getByTestId("destek-gonder")));
    await act(async () => void fireEvent.press(screen.getByTestId("destek-gonder")));
    const tok = mockApi.supportCreate.mock.calls.map((c) => (c[0] as { clientToken: string }).clientToken);
    expect(tok[0]).not.toBe(tok[1]);
  });
  it("çift dokunuş tek istek atar", async () => {
    let bitir: (t: DestekTalep) => void = () => undefined;
    mockApi.supportCreate.mockImplementationOnce(() => new Promise<DestekTalep>((r) => (bitir = r)));
    await doldur();
    await act(async () => {
      fireEvent.press(screen.getByTestId("destek-gonder"));
      fireEvent.press(screen.getByTestId("destek-gonder"));
    });
    expect(mockApi.supportCreate).toHaveBeenCalledTimes(1);
    await act(async () => bitir(TALEP));
  });
  it("bağlam otomatik: ekran adı + yalnız yol; parola/belirteç/sorgu yok; ekran görüntüsü taslaktan gider", async () => {
    Tas.yeniTaslak({ ekran: { uri: "data:image/jpeg;base64,QUJD", width: 10, height: 20 }, ekranAdi: "Siparişler · ayrıntı", yol: "/siparisler/abc?ara=gizli" });
    await doldur();
    expect(screen.getByTestId("destek-goruntu")).toBeTruthy();
    await act(async () => void fireEvent.press(screen.getByTestId("destek-gonder")));
    const b = mockApi.supportCreate.mock.calls[0]![0] as { context: Record<string, unknown>; files: unknown[] };
    expect(b.context.screen).toBe("Siparişler · ayrıntı");
    expect(b.context.path).toBe("/siparisler/abc");
    expect(b.files).toEqual([{ name: "ekran.jpg", contentType: "image/jpeg", dataBase64: "QUJD" }]);
    expect(JSON.stringify(b.context)).not.toMatch(/gizli|parola|token|Bearer/i);
    expect(Tas.taslakAl().ekran).toBeNull(); // başarıda taslak temizlenir
  });
  it("görüntü kaldırılınca yalnız metinli talep", async () => {
    Tas.yeniTaslak({ ekran: { uri: "data:image/jpeg;base64,QUJD", width: 10, height: 20 }, ekranAdi: null, yol: null });
    await doldur();
    fireEvent.press(screen.getByTestId("destek-goruntu-kaldir"));
    expect(screen.queryByTestId("destek-goruntu")).toBeNull();
    await act(async () => void fireEvent.press(screen.getByTestId("destek-gonder")));
    expect(mockApi.supportCreate.mock.calls[0]![0]).not.toHaveProperty("files");
  });
});

describe("kapalıyken görünmez", () => {
  it("durum etkin:false / 404 / ağ hatası → kapalı ve rozet isteği atılmaz", async () => {
    for (const cevap of [() => Promise.resolve({ etkin: false }), () => Promise.reject(kod(404, "BULUNAMADI")), () => Promise.reject(ag())]) {
      const api = { supportStatus: jest.fn(cevap), supportUnread: jest.fn(async () => ({ count: 1, tickets: 1 })) };
      G.destekSifirla("t:h");
      await expect(G.destekDurumunuDenetle(api, "t:h")).resolves.toBe(false);
      await G.destekRozetiniTazele(api);
      expect(api.supportUnread).not.toHaveBeenCalled();
      expect(G.destekDurumuAl().etkin).toBe(false);
    }
  });
  it("Menü: kapalıyken Destek satırı yok; açılınca rozetle görünür; MODULE_DISABLED gizler", async () => {
    render(<More />);
    expect(screen.queryByTestId("menu-destek")).toBeNull();
    G.destekSifirla("t:h");
    await act(async () => {
      await G.destekDurumunuDenetle(mockApi, "t:h");
      await G.destekRozetiniTazele(mockApi);
    });
    expect(mockApi.supportUnread).toHaveBeenCalledWith("mine");
    expect(screen.getByTestId("menu-destek")).toBeTruthy();
    expect(screen.getByTestId("destek-okunmamis")).toBeTruthy();
    fireEvent.press(screen.getByTestId("menu-destek"));
    expect(mockRouter.push).toHaveBeenCalledWith("/destek");
    act(() => G.destekHatasiniIsle(kod(403, "MODULE_DISABLED")));
    expect(screen.queryByTestId("menu-destek")).toBeNull();
  });
  it("hesap değişince depo sıfırlanır; eski hesabın geç gelen cevabı yazılmaz", async () => {
    let coz: (v: { etkin: boolean }) => void = () => undefined;
    const api = { supportStatus: jest.fn(() => new Promise<{ etkin: boolean }>((r) => (coz = r))), supportUnread: jest.fn() };
    G.destekSifirla("t:eski");
    const p = G.destekDurumunuDenetle(api, "t:eski");
    G.destekSifirla("t:yeni");
    coz({ etkin: true });
    await p;
    expect(G.destekDurumuAl()).toMatchObject({ anahtar: "t:yeni", etkin: false });
  });
});

describe("rozet yoklaması hatayı yutar", () => {
  it("502/504/429/ağ → önceki değer kalır, hata yukarı çıkmaz", async () => {
    const api = { supportStatus: jest.fn(async () => ({ etkin: true })), supportUnread: jest.fn(async () => ({ count: 4, tickets: 3 })) };
    G.destekSifirla("t:h");
    await G.destekDurumunuDenetle(api, "t:h");
    await G.destekRozetiniTazele(api);
    expect(G.destekDurumuAl().okunmamis).toEqual({ count: 4, tickets: 3 });
    for (const e of [kod(502, "DESTEK_ULASILAMADI"), kod(504, "DESTEK_ZAMAN_ASIMI"), kod(429, "RATE_LIMITED"), ag()]) {
      api.supportUnread.mockRejectedValueOnce(e);
      await expect(G.destekRozetiniTazele(api)).resolves.toBeUndefined();
      expect(G.destekDurumuAl().okunmamis).toEqual({ count: 4, tickets: 3 });
    }
    await expect(G.okunmamisGuvenli(() => Promise.reject(ag()), undefined)).resolves.toEqual(G.SIFIR_OKUNMAMIS);
  });
  it("rozet metni talep sayısıdır; 0 → yok, 10+ → 9+", () => {
    expect(G.destekRozetMetni({ count: 5, tickets: 2 })).toBe("2");
    expect(G.destekRozetMetni({ count: 0, tickets: 0 })).toBeNull();
    expect(G.destekRozetMetni({ count: 40, tickets: 12 })).toBe("9+");
  });
});

describe("bildirim yönlendirmesi", () => {
  it("'Destek yanıtı' yükü (rota /destek/<uuid>) talep ayrıntısını açar ve rozeti tazeler", async () => {
    const push = jest.fn();
    const onSupport = jest.fn();
    await expect(openNotification({ bildirimId: "b", rota: `/destek/${T1}`, tesisId: "t" }, { facilityId: "t", switchFacility: async () => false, push, onSupport })).resolves.toBe(true);
    expect(push).toHaveBeenCalledWith(`/destek/${T1}`);
    expect(onSupport).toHaveBeenCalledTimes(1);
  });
  it("başka tesis ya da UUID olmayan kimlik açılmaz; diğer rotalar rozet tazelemez", async () => {
    const push = jest.fn();
    const onSupport = jest.fn();
    await openNotification({ rota: `/destek/${T1}`, tesisId: "baska" }, { facilityId: "t", switchFacility: async () => false, push, onSupport });
    expect(safeRoute("/destek/abc")).toBeNull();
    expect(safeRoute("/destek")).toBeNull();
    await openNotification({ rota: "/siparisler" }, { facilityId: "t", switchFacility: async () => false, push, onSupport });
    expect(push).toHaveBeenCalledTimes(1);
    expect(onSupport).not.toHaveBeenCalled();
  });
});

describe("bağlam ve metinler", () => {
  it("bağlam yalnız sözleşme alanları; sürüm + yapı, platform, cihaz", () => {
    const b = B.destekBaglami({ ekranAdi: "Stok", yol: "/stok?x=1#y", surum: "1.2.0", yapi: 3, os: "android", osSurum: "14", model: "Pixel 8" });
    expect(Object.keys(b).sort()).toEqual(["client", "path", "screen", "technical"]);
    expect(b.client).toEqual({ os: "Android 14", appVersion: "1.2.0 (3)", locale: "tr-TR", device: "Pixel 8" });
    expect(b.path).toBe("/stok");
    expect(B.ekranAdiBul("/siparisler/123")).toBe("Siparişler · ayrıntı");
    expect(B.ekranAdiBul("/diger")).toBe("Menü");
    expect(JSON.stringify(b).length).toBeLessThan(16 * 1024);
  });
  it("hata cümleleri sade Türkçe; 14 gün sonrası yeni talep önerir", () => {
    expect(M.destekHataMetni(kod(502, "DESTEK_ULASILAMADI"))).toMatch(/ulaşılamıyor/);
    expect(M.destekHataMetni(kod(504, "DESTEK_ZAMAN_ASIMI"))).toMatch(/ulaşılamıyor/);
    expect(M.destekHataMetni(kod(429, "RATE_LIMITED", { retryAfterSec: 10 }))).toMatch(/10 saniye/);
    expect(M.destekHataMetni(kod(413, "PAKET_BUYUK"))).toMatch(/çok büyük/);
    expect(M.destekHataMetni(ag())).toMatch(/Bağlantınızı/);
    expect(M.destekHataMetni(kod(400, "SUBJECT_EMPTY"))).toBe("Merkez mesajı");
    expect(M.yeniTalepGerekirMi(kod(409, "REOPEN_WINDOW_EXPIRED"))).toBe(true);
    expect(M.silinmisEkMetni({ name: "ekran.webp", size: 48213 })).toBe("Ek süresi dolduğu için silindi · ekran.webp · 47 KB");
    expect(M.durumEtiketi("WAITING_CUSTOMER")).toBe("Sizden bilgi bekleniyor");
    expect(M.durumEtiketi("YENI_DURUM")).toBe("YENI_DURUM");
  });
});
