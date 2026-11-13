// Push köprüsü P4 — ERP kipi telefon push kaydı + dokunuş. Native modül portlarla taklit edilir; gerçek Expo/ağ yok.
import { renderHook, act } from "@testing-library/react-native";

const mockSession: { current: Record<string, unknown> } = { current: {} };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession.current }));
const mockStoreMap = new Map<string, string>();
jest.mock("../src/state/store", () => ({
  secretStore: {
    get: async (k: string) => mockStoreMap.get(k) ?? null,
    set: async (k: string, v: string) => void mockStoreMap.set(k, v),
    remove: async (k: string) => void mockStoreMap.delete(k),
  },
}));
const mockInvalidate = jest.fn();
jest.mock("../src/state/changes", () => ({ invalidate: (t: unknown) => mockInvalidate(t) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));

const ep = require("../src/push/erp-push") as typeof import("../src/push/erp-push");
const { useErpPushKaydi } = require("../src/push/useErpPush") as typeof import("../src/push/useErpPush");
const { erpYetenek, BULUT_YETENEK } = require("../src/api/yetenek") as typeof import("../src/api/yetenek");
const { openNotification } = require("../src/push/taps") as typeof import("../src/push/taps");
type Portlar = import("../src/push/erp-push").PushPortlari;
type Cihazci = import("../src/api/bildirim").PushCihazci;

const A = "https://a.fabrika.com";
const B = "https://b.fabrika.com";
const ID = "0f3c2d1e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";

function portlar(o: Partial<{ izin: string; iste: string; belirtec: string | null; ad: string | null }> = {}) {
  const st = { izin: o.izin ?? "VERILDI", iste: o.iste ?? "VERILDI", belirtec: o.belirtec === undefined ? "ExponentPushToken[ilk12345]" : o.belirtec, degis: null as null | (() => void) };
  const p = {
    platform: "android" as const,
    izinOku: jest.fn(async () => st.izin),
    izinIste: jest.fn(async () => st.iste),
    belirtecAl: jest.fn(async () => st.belirtec),
    belirtecDegisince: jest.fn((cb: () => void) => { st.degis = cb; return () => { st.degis = null; }; }),
    cihazAdi: jest.fn(() => (o.ad === undefined ? "  Samsung Galaxy  " : o.ad)),
    kanallariKur: jest.fn(async () => undefined),
    sesiOnizle: jest.fn(async () => undefined),
    kanalAyariniAc: jest.fn(async () => undefined),
  };
  return { p: p as unknown as Portlar & typeof p, st };
}
function cihazci(): Cihazci & { kaydet: jest.Mock; birak: jest.Mock } {
  return { kaydet: jest.fn(async () => ({ kayitli: true })), birak: jest.fn(async () => ({ birakildi: true })), katalog: jest.fn(), tercihler: jest.fn(), tercihYaz: jest.fn() } as never;
}
const store = () => require("../src/state/store").secretStore as import("../src/state/browser-store").KeyValue;

beforeEach(() => {
  mockStoreMap.clear();
  mockInvalidate.mockClear();
});

describe("yetenek ve kapı", () => {
  it("⭐ eski fabrika (alan yok) / 0 / kutu kapalı → patronPush kapalı; bulutta kapalı", () => {
    expect(erpYetenek([], [], 1, true, 1).patronPush).toBe(false);
    expect(erpYetenek([], [], 1, true, 1, 0).patronPush).toBe(false);
    expect(erpYetenek([], [], 1, true, 1, "1").patronPush).toBe(false);
    expect(erpYetenek([], [], 1, false, 1, 1).patronPush).toBe(false);
    expect(erpYetenek([], [], 1, true, 1, 1).patronPush).toBe(true);
    expect(BULUT_YETENEK.patronPush).toBe(false);
  });
  it("⭐ erpPushAcik = yetenek ∧ derleme kapısı ∧ telefon", () => {
    expect(ep.erpPushAcik(true, true, "android")).toBe(true);
    expect(ep.erpPushAcik(false, true, "android")).toBe(false);
    expect(ep.erpPushAcik(true, false, "android")).toBe(false);
    expect(ep.erpPushAcik(true, true, "web")).toBe(false);
    // jest ortamında derleme kapısı kapalı (extra.nativePush yok): varsayılan yol kapalı.
    expect(ep.erpPushAcik(true)).toBe(false);
  });
});

describe("kayıt", () => {
  const baglam = (c: Cihazci, p: Portlar, acik = true, adres = A) => ({ acik, adres, cihazci: c, store: store(), portlar: () => p });

  it("⭐ kapı/yetenek kapalı → portlara ve ağa hiç dokunulmaz", async () => {
    const c = cihazci();
    const factory = jest.fn();
    await expect(ep.erpPushEtkinlestir({ acik: false, adres: A, cihazci: c, store: store(), portlar: factory }, { iste: true })).resolves.toEqual({ kind: "KAPALI" });
    expect(factory).not.toHaveBeenCalled();
    expect(c.kaydet).not.toHaveBeenCalled();
  });

  it("⭐ sessiz tazeleme izin İSTEMEZ: sorulmamışsa kayıt yok", async () => {
    const c = cihazci();
    const { p } = portlar({ izin: "SORULMADI" });
    await expect(ep.erpPushEtkinlestir(baglam(c, p), { iste: false })).resolves.toEqual({ kind: "IZIN_YOK" });
    expect(p.izinIste).not.toHaveBeenCalled();
    expect(c.kaydet).not.toHaveBeenCalled();
  });

  it("⭐ izin reddi → REDDEDILDI, belirteç alınmaz, kayıt yok", async () => {
    const c = cihazci();
    const { p } = portlar({ izin: "SORULMADI", iste: "REDDEDILDI" });
    await expect(ep.erpPushEtkinlestir(baglam(c, p), { iste: true })).resolves.toEqual({ kind: "REDDEDILDI" });
    expect(p.belirtecAl).not.toHaveBeenCalled();
    expect(c.kaydet).not.toHaveBeenCalled();
  });

  it("⭐ izin verildi → POST gövdesi (belirteç, platform, kırpılmış cihaz adı) + belirteç adresle saklanır", async () => {
    const c = cihazci();
    const { p } = portlar({ izin: "SORULMADI" });
    await expect(ep.erpPushEtkinlestir(baglam(c, p), { iste: true })).resolves.toEqual({ kind: "KAYITLI" });
    expect(c.kaydet).toHaveBeenCalledWith({ belirtec: "ExponentPushToken[ilk12345]", platform: "android", cihazAdi: "Samsung Galaxy" });
    expect(JSON.parse(mockStoreMap.get(ep.ERP_PUSH_KEY)!)).toEqual({ adres: A, belirtec: "ExponentPushToken[ilk12345]" });
  });

  it("EAS proje kimliği yok → YAPILANDIRMA_EKSIK, kayıt yok; cihaz adı yoksa alan gönderilmez", async () => {
    const c = cihazci();
    await expect(ep.erpPushEtkinlestir(baglam(c, portlar({ belirtec: null }).p), { iste: true })).resolves.toEqual({ kind: "YAPILANDIRMA_EKSIK" });
    expect(c.kaydet).not.toHaveBeenCalled();
    await ep.erpPushEtkinlestir(baglam(c, portlar({ ad: null }).p), { iste: false });
    expect(c.kaydet).toHaveBeenCalledWith({ belirtec: "ExponentPushToken[ilk12345]", platform: "android" });
  });

  it("⭐ çıkış: saklı belirteç bu fabrikanınsa DELETE; çevrimdışı sessiz; kayıt her durumda silinir", async () => {
    const c = cihazci();
    await ep.erpPushEtkinlestir(baglam(c, portlar().p), { iste: false });
    c.birak.mockRejectedValueOnce(new TypeError("Network request failed"));
    await expect(ep.erpPushBirak({ adres: A, cihazci: c, store: store() })).resolves.toBeUndefined();
    expect(c.birak).toHaveBeenCalledWith("ExponentPushToken[ilk12345]");
    expect(mockStoreMap.has(ep.ERP_PUSH_KEY)).toBe(false);
  });

  it("⭐ çok fabrika: A'da kayıt → çıkış A'dan bırakır → B'de yeni kayıt; B'ye A'nın belirteci bırakılmaz", async () => {
    const ca = cihazci();
    const cb = cihazci();
    await ep.erpPushEtkinlestir(baglam(ca, portlar().p, true, A), { iste: false });
    await ep.erpPushBirak({ adres: B, cihazci: cb, store: store() });
    expect(cb.birak).not.toHaveBeenCalled();
    await ep.erpPushEtkinlestir(baglam(ca, portlar().p, true, A), { iste: false });
    await ep.erpPushBirak({ adres: A, cihazci: ca, store: store() });
    expect(ca.birak).toHaveBeenCalledTimes(1);
    await ep.erpPushEtkinlestir(baglam(cb, portlar({ belirtec: "ExponentPushToken[ikinci123]" }).p, true, B), { iste: false });
    expect(cb.kaydet).toHaveBeenCalledWith(expect.objectContaining({ belirtec: "ExponentPushToken[ikinci123]" }));
    expect(JSON.parse(mockStoreMap.get(ep.ERP_PUSH_KEY)!).adres).toBe(B);
  });
});

describe("oturum kancası (sessiz kayıt + belirteç değişimi)", () => {
  const oturum = (o: Partial<{ patronPush: boolean; offline: boolean; c: Cihazci }> = {}) => {
    const c = o.c ?? cihazci();
    mockSession.current = { yetenek: { patronPush: o.patronPush ?? true }, server: A, pushCihazci: c, offline: o.offline ?? false };
    return c;
  };
  const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  it("⭐ belirteç değişince yeniden kaydedilir", async () => {
    const c = oturum();
    const { p, st } = portlar();
    renderHook(() => useErpPushKaydi(true, () => p, true));
    await flush();
    expect(c.kaydet).toHaveBeenCalledTimes(1);
    st.belirtec = "ExponentPushToken[yeni12345]";
    await act(async () => st.degis!());
    await flush();
    expect(c.kaydet).toHaveBeenLastCalledWith(expect.objectContaining({ belirtec: "ExponentPushToken[yeni12345]" }));
  });

  it("⭐ derleme kapısı kapalı / yetenek yok / çevrimdışı → port yok, ağ yok", async () => {
    for (const [o, gate] of [[{}, false], [{ patronPush: false }, true], [{ offline: true }, true]] as const) {
      const c = oturum(o);
      const factory = jest.fn(() => portlar().p);
      renderHook(() => useErpPushKaydi(true, factory, gate));
      await flush();
      expect(factory).not.toHaveBeenCalled();
      expect(c.kaydet).not.toHaveBeenCalled();
    }
  });
});

describe("dokunuş (ERP yedek yolu)", () => {
  const deps = (yedekRota: string | null) => ({ facilityId: "t1", yedekRota, switchFacility: jest.fn(async () => true), push: jest.fn() });

  it("⭐ ERP: dürt yükü (/bildirimler + bildirimId) → satır vurgusuyla Bildirimler", async () => {
    const d = deps("/bildirimler");
    await expect(openNotification({ bildirimId: ID, rota: "/bildirimler" }, d)).resolves.toBe(true);
    expect(d.push).toHaveBeenCalledWith(`/bildirimler?vurgu=${ID}`);
    expect(d.switchFacility).not.toHaveBeenCalled();
  });

  it("⭐ ERP: güvensiz/eksik rota → Bildirimler; kimlik UUID değilse vurgu eklenmez", async () => {
    for (const rota of ["https://kotu.example", "//evil", "/a/../b", null, undefined]) {
      const d = deps("/bildirimler");
      await openNotification({ bildirimId: ID, rota }, d);
      expect(d.push).toHaveBeenCalledWith(`/bildirimler?vurgu=${ID}`);
    }
    const d = deps("/bildirimler");
    await openNotification({ bildirimId: "x/../y", rota: "javascript:1" }, d);
    expect(d.push).toHaveBeenCalledWith("/bildirimler");
  });

  it("⭐ bulut: yedek yol yok — güvensiz rota hiçbir yere gitmez (bugünkü davranış)", async () => {
    const d = deps(null);
    await expect(openNotification({ bildirimId: ID, rota: "https://kotu.example" }, d)).resolves.toBe(false);
    expect(d.push).not.toHaveBeenCalled();
    await openNotification({ bildirimId: ID, rota: "/siparisler" }, d);
    expect(d.push).toHaveBeenCalledWith("/siparisler");
  });
});

describe("taps-native: üç durum + önde gelen bildirim", () => {
  const mockN = {
    last: null as unknown,
    responseCb: null as null | ((r: unknown) => void),
    receivedCb: null as null | (() => void),
  };
  let tn: typeof import("../src/push/taps-native");
  beforeAll(() => {
    jest.doMock("expo-notifications", () => ({
      setNotificationHandler: jest.fn(),
      getLastNotificationResponseAsync: jest.fn(async () => mockN.last),
      addNotificationResponseReceivedListener: jest.fn((cb: (r: unknown) => void) => { mockN.responseCb = cb; return { remove: () => undefined }; }),
      addNotificationReceivedListener: jest.fn((cb: () => void) => { mockN.receivedCb = cb; return { remove: () => undefined }; }),
    }));
    tn = require("../src/push/taps-native") as typeof import("../src/push/taps-native");
  });
  const yanit = (identifier: string) => ({ notification: { request: { identifier, content: { data: { bildirimId: ID, rota: "/bildirimler" } } } } });

  it("⭐ kapalıyken dokunuş (soğuk açılış) son yanıttan; arka plan/önde dokunuş dinleyiciden; aynı bildirim iki kez açılmaz", async () => {
    mockN.last = yanit("soguk-1");
    const open = jest.fn();
    const off = tn.listenNativeTaps(open);
    await act(async () => undefined);
    expect(open).toHaveBeenCalledTimes(1);
    mockN.responseCb!(yanit("arka-2"));
    mockN.responseCb!(yanit("on-3"));
    expect(open).toHaveBeenCalledTimes(3);
    off();
    // Yeniden giriş: dinleyici yeniden kurulur, son yanıt AYNI → ikinci kez açılmaz.
    tn.listenNativeTaps(open);
    await act(async () => undefined);
    expect(open).toHaveBeenCalledTimes(3);
  });

  it("öndeyken gelen bildirim (dokunuşsuz) dinleyiciye düşer", () => {
    const cb = jest.fn();
    tn.listenNativeReceived(cb);
    mockN.receivedCb!();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
