// Push köprüsü P4 — ERP Bildirimler ekranı: "Telefon bildirimleri" bölümü (görünürlük, izin akışı, tür anahtarı) ve
// telefon bildirimine dokunarak gelinen satırın vurgusu + okundu. Portlar ve uçlar taklit; ağ/Expo yok.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";

const ID = "0f3c2d1e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";
const mockCihazci = {
  kaydet: jest.fn(), birak: jest.fn(), katalog: jest.fn(), tercihler: jest.fn(), tercihYaz: jest.fn(),
  profiller: jest.fn(), profilUygula: jest.fn(), profilKaydet: jest.fn(), profilGuncelle: jest.fn(), profilSil: jest.fn(),
};
const mockBildirimci = { ozet: jest.fn(), liste: jest.fn(), okundu: jest.fn(), tumunuOkundu: jest.fn() };
const mockSession = {
  server: "https://a.fabrika.com" as string | null, pushCihazci: mockCihazci as unknown, bildirimci: mockBildirimci, offline: false,
  cache: { load: jest.fn(async (_k: string, f: () => Promise<unknown>) => ({ data: await f(), offline: false, savedAt: "2026-11-13T10:00:00.000Z" })), peek: jest.fn(async () => null) },
  markOnline: jest.fn(),
};
let mockParams: Record<string, string> = {};
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
const mockStore = new Map<string, string>();
jest.mock("../src/state/store", () => ({
  secretStore: { get: async (k: string) => mockStore.get(k) ?? null, set: async (k: string, v: string) => void mockStore.set(k, v), remove: async (k: string) => void mockStore.delete(k) },
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  usePathname: () => "/bildirimler",
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void | (() => void)) => (require("react") as typeof import("react")).useEffect(() => cb(), [cb]),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const yet = require("../src/api/yetenek") as typeof import("../src/api/yetenek");
const { TelefonBildirimleri } = require("../src/ui/bildirim/TelefonBildirimleri") as typeof import("../src/ui/bildirim/TelefonBildirimleri");
const { GelenBildirimler } = require("../src/ui/bildirim/GelenBildirimler") as typeof import("../src/ui/bildirim/GelenBildirimler");
const { pushTercihGovdesi } = require("../src/api/bildirim") as typeof import("../src/api/bildirim");
type Tercihler = import("../src/api/bildirim").Tercihler;

const TERCIH: Tercihler = {
  hucreler: [
    { kind: "dokuma.tezgah-alarmi", kanallar: [{ kanal: "UYGULAMA", durum: "ACIK", kilit: false }, { kanal: "PATRON_PUSH", durum: "ACIK", kilit: false }] },
    { kind: "siparis.termin-gecti", kanallar: [{ kanal: "UYGULAMA", durum: "ACIK", kilit: false }, { kanal: "OZET", durum: "KAPALI", kilit: false }, { kanal: "PATRON_PUSH", durum: "KAPALI", kilit: false }] },
    { kind: "sistem.disk", kanallar: [{ kanal: "UYGULAMA", durum: "ACIK", kilit: true }] },
  ],
  satirlar: [
    { tur: "siparis.termin-gecti", kanal: "UYGULAMA", acik: true, kapsam: { yalnizTakip: true } },
    { tur: "siparis.termin-gecti", kanal: "OZET", acik: false, kapsam: null },
    { tur: "dokuma.tezgah-alarmi", kanal: "PATRON_PUSH", acik: true, kapsam: null },
    { tur: "gorunmeyen.tur", kanal: "PATRON_PUSH", acik: true, kapsam: null },
  ],
};

function portlar(izin: string, iste = "VERILDI"): import("../src/push/erp-push").PushPortlari & Record<string, jest.Mock | string> {
  const p = {
    platform: "android" as const,
    izinOku: jest.fn(async () => izin as never),
    izinIste: jest.fn(async () => { izin = iste; return iste as never; }),
    belirtecAl: jest.fn(async () => "ExponentPushToken[ekran123]"),
    belirtecDegisince: jest.fn(() => () => undefined),
    cihazAdi: jest.fn(() => "Telefon"),
    kanallariKur: jest.fn(async () => undefined),
    sesiOnizle: jest.fn(async () => undefined),
    kanalAyariniAc: jest.fn(async () => undefined),
  };
  return p;
}
async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => undefined);
}
/** Katlanır grupların hepsini açar (varsayılan kapalı). */
async function gruplariAc() {
  for (const b of screen.queryAllByTestId(/^telefon-grup-baslik-/)) fireEvent.press(b);
  await flush();
}
const { ApiError } = require("../src/api/client") as typeof import("../src/api/client");

beforeEach(() => {
  for (const f of [...Object.values(mockCihazci), ...Object.values(mockBildirimci)]) f.mockReset();
  mockSession.offline = false;
  mockSession.server = "https://a.fabrika.com";
  mockParams = {};
  mockStore.clear();
  yet.setYetenek(yet.erpYetenek(["tesis"], [], undefined, true, undefined, 1));
  mockCihazci.katalog.mockResolvedValue({ turler: [{ kod: "dokuma.tezgah-alarmi", ad: "Tezgâh alarmı" }, { kod: "siparis.termin-gecti", ad: "Termini geçen sipariş" }] });
  mockCihazci.tercihler.mockResolvedValue(TERCIH);
  mockCihazci.tercihYaz.mockImplementation(async () => TERCIH);
  mockCihazci.kaydet.mockResolvedValue({ kayitli: true });
  // Varsayılan: eski fabrika (profil ucu yok) → üç hazır düğme.
  mockCihazci.profiller.mockRejectedValue(new ApiError(404, "NOT_FOUND", "Bulunamadı"));
});

describe("görünürlük", () => {
  it("⭐ yetenek yok (eski fabrika) → bölüm yok, port/uç çağrısı yok", async () => {
    yet.setYetenek(yet.erpYetenek(["tesis"], [], undefined, true, undefined, undefined));
    const p = portlar("SORULMADI");
    render(<TelefonBildirimleri nativePush os="android" portlar={() => p} />);
    await flush();
    expect(screen.queryByTestId("telefon-bildirimleri")).toBeNull();
    expect(p.izinOku).not.toHaveBeenCalled();
    expect(mockCihazci.tercihler).not.toHaveBeenCalled();
  });
  it("⭐ derleme kapısı kapalı (bugünkü paket) / web → bölüm yok, izin okunmaz", async () => {
    const p = portlar("SORULMADI");
    render(<TelefonBildirimleri portlar={() => p} os="android" />);
    render(<TelefonBildirimleri nativePush os="web" portlar={() => p} />);
    await flush();
    expect(screen.queryByTestId("telefon-bildirimleri")).toBeNull();
    expect(p.izinOku).not.toHaveBeenCalled();
    expect(mockCihazci.katalog).not.toHaveBeenCalled();
  });
});

describe("izin akışı", () => {
  it("⭐ açılışta izin İSTENMEZ; 'Telefon bildirimlerini aç' ile istenir, kaydedilir", async () => {
    const p = portlar("SORULMADI");
    render(<TelefonBildirimleri nativePush os="android" portlar={() => p} />);
    await flush();
    expect(p.izinIste).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("telefon-bildirim-ac"));
    await flush();
    expect(p.izinIste).toHaveBeenCalledTimes(1);
    expect(mockCihazci.kaydet).toHaveBeenCalledWith({ belirtec: "ExponentPushToken[ekran123]", platform: "android", cihazAdi: "Telefon" });
    expect(screen.getByTestId("telefon-bildirim-mesaj")).toHaveTextContent("Bu telefon bildirim alacak.");
  });
  it("⭐ istemde ret → açıklama, kayıt yok", async () => {
    const p = portlar("SORULMADI", "REDDEDILDI");
    render(<TelefonBildirimleri nativePush os="android" portlar={() => p} />);
    await flush();
    fireEvent.press(screen.getByTestId("telefon-bildirim-ac"));
    await flush();
    expect(mockCihazci.kaydet).not.toHaveBeenCalled();
    expect(screen.getByTestId("telefon-izin-reddedildi")).toHaveTextContent(/Telefon ayarlarından/);
  });
  it("önceden reddedilmiş → aç düğmesi yok, ayarlara yönlendirme", async () => {
    const open = jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
    render(<TelefonBildirimleri nativePush os="android" portlar={() => portlar("REDDEDILDI")} />);
    await flush();
    expect(screen.queryByTestId("telefon-bildirim-ac")).toBeNull();
    fireEvent.press(screen.getByTestId("telefon-izin-ayarlar"));
    expect(open).toHaveBeenCalled();
  });
});

describe("tür başına telefon bildirimi anahtarı", () => {
  it("⭐ gövde yalnız (tür, PATRON_PUSH) hücresini değiştirir; öteki kanal satırları + kapsam aynen, görünmeyen tür yollanmaz", () => {
    expect(pushTercihGovdesi(TERCIH, "siparis.termin-gecti", true)).toEqual([
      { tur: "siparis.termin-gecti", kanal: "UYGULAMA", acik: true, kapsam: { yalnizTakip: true } },
      { tur: "siparis.termin-gecti", kanal: "OZET", acik: false },
      { tur: "dokuma.tezgah-alarmi", kanal: "PATRON_PUSH", acik: true },
      { tur: "siparis.termin-gecti", kanal: "PATRON_PUSH", acik: true },
    ]);
    const kapat = pushTercihGovdesi(TERCIH, "dokuma.tezgah-alarmi", false);
    expect(kapat.filter((r) => r.tur === "dokuma.tezgah-alarmi")).toEqual([{ tur: "dokuma.tezgah-alarmi", kanal: "PATRON_PUSH", acik: false }]);
    expect(kapat).toHaveLength(3);
  });
  it("⭐ liste sunucu varsayılanıyla çizilir (tür adı katalogdan); anahtar PUT'u yollar", async () => {
    render(<TelefonBildirimleri nativePush os="android" portlar={() => portlar("VERILDI")} />);
    await flush();
    expect(screen.queryByText("Tezgâh alarmı")).toBeNull(); // gruplar kapalı açılır
    await gruplariAc();
    expect(screen.getByText("Tezgâh alarmı")).toBeTruthy();
    expect(screen.queryByTestId("telefon-tercih-sistem.disk")).toBeNull();
    expect(screen.getByTestId("telefon-tercih-dokuma.tezgah-alarmi").props.value).toBe(true);
    expect(screen.getByTestId("telefon-tercih-siparis.termin-gecti").props.value).toBe(false);
    fireEvent(screen.getByTestId("telefon-tercih-siparis.termin-gecti"), "valueChange", true);
    await flush();
    expect(mockCihazci.tercihYaz).toHaveBeenCalledWith(pushTercihGovdesi(TERCIH, "siparis.termin-gecti", true));
  });
  it("⭐ çevrimdışı → anahtarlar ve aç düğmesi kapalı, yazma yok", async () => {
    mockSession.offline = true;
    render(<TelefonBildirimleri nativePush os="android" portlar={() => portlar("SORULMADI")} />);
    await flush();
    await gruplariAc();
    expect(screen.getByTestId("telefon-tercih-siparis.termin-gecti").props.disabled).toBe(true);
    fireEvent(screen.getByTestId("telefon-tercih-siparis.termin-gecti"), "valueChange", true);
    fireEvent.press(screen.getByTestId("telefon-bildirim-ac"));
    await flush();
    expect(mockCihazci.tercihYaz).not.toHaveBeenCalled();
    expect(mockCihazci.kaydet).not.toHaveBeenCalled();
  });
});

describe("S0 — hazır düğmeler, grup anahtarı, ses", () => {
  const { pushTercihGovdesiToplu } = require("../src/api/bildirim") as typeof import("../src/api/bildirim");
  beforeEach(() => {
    mockCihazci.katalog.mockResolvedValue({ turler: [
      { kod: "dokuma.tezgah-alarmi", ad: "Tezgâh alarmı", grup: "Dokuma", sinif: "ALARM" },
      { kod: "siparis.termin-gecti", ad: "Termini geçen sipariş", grup: "Satış" },
    ] });
  });
  it("⭐ 'Hepsini kapat' tek PUT, yalnız açık hücre değişir; 'Yalnız önemliler' alarmı açık bırakır", async () => {
    render(<TelefonBildirimleri nativePush os="android" portlar={() => portlar("VERILDI")} />);
    await flush();
    fireEvent.press(screen.getByTestId("telefon-hazir-HICBIRI"));
    await flush();
    expect(mockCihazci.tercihYaz).toHaveBeenCalledTimes(1);
    expect(mockCihazci.tercihYaz).toHaveBeenCalledWith(pushTercihGovdesiToplu(TERCIH, new Map([["dokuma.tezgah-alarmi", false]])));
    mockCihazci.tercihYaz.mockClear();
    fireEvent.press(screen.getByTestId("telefon-hazir-ONEMLI"));
    await flush();
    // Alarm zaten açık, sipariş kapalı → değişiklik yok, PUT yok.
    expect(mockCihazci.tercihYaz).not.toHaveBeenCalled();
    expect(screen.getByTestId("telefon-bildirim-mesaj")).toHaveTextContent("Zaten bu şekilde.");
  });
  it("⭐ grup anahtarı yalnız o grubun hücrelerini tek PUT'ta yazar", async () => {
    render(<TelefonBildirimleri nativePush os="android" portlar={() => portlar("VERILDI")} />);
    await flush();
    expect(screen.getByTestId("telefon-grup-ozet-Satış")).toHaveTextContent("0/1 açık");
    await gruplariAc();
    expect(screen.getByTestId("telefon-grup-ac-Satış").props.value).toBe(false);
    fireEvent(screen.getByTestId("telefon-grup-ac-Satış"), "valueChange", true);
    await flush();
    expect(mockCihazci.tercihYaz).toHaveBeenCalledTimes(1);
    expect(mockCihazci.tercihYaz).toHaveBeenCalledWith(pushTercihGovdesiToplu(TERCIH, new Map([["siparis.termin-gecti", true]])));
  });
  it("⭐ Ses bölümü yalnız izin VERILDI'de; önizle/ayar portları seçili sesle çağrılır", async () => {
    const yok = render(<TelefonBildirimleri nativePush os="android" portlar={() => portlar("SORULMADI")} />);
    await flush();
    expect(screen.queryByTestId("telefon-ses")).toBeNull();
    yok.unmount();
    const p = portlar("VERILDI");
    render(<TelefonBildirimleri nativePush os="android" portlar={() => p} />);
    await flush();
    expect(screen.getByTestId("telefon-ses")).toBeTruthy();
    fireEvent.press(screen.getByTestId("telefon-ses-onizle-BILDIRIM-tekserp_mekik"));
    fireEvent.press(screen.getByTestId("telefon-ses-ayar"));
    await flush();
    expect(p.sesiOnizle).toHaveBeenCalledWith("BILDIRIM", "tekserp_mekik");
    expect(p.kanalAyariniAc).toHaveBeenCalledWith("BILDIRIM", "tekserp_zil");
  });
  it("⭐ ses seçimi: kanallar kurulur + kayıt yeni sesle yenilenir", async () => {
    const p = portlar("VERILDI");
    render(<TelefonBildirimleri nativePush os="android" portlar={() => p} />);
    await flush();
    fireEvent.press(screen.getByTestId("telefon-ses-BILDIRIM-tekserp_kisa"));
    await flush();
    expect(p.kanallariKur).toHaveBeenCalledWith({ bildirim: "tekserp_kisa", alarm: "tekserp_alarm" });
    expect(mockCihazci.kaydet).toHaveBeenCalledWith(expect.objectContaining({ sesBildirim: "tekserp_kisa", sesAlarm: "tekserp_alarm" }));
    expect(screen.getByTestId("telefon-bildirim-mesaj")).toHaveTextContent(/Ses seçildi/);
  });
});

describe("dokunuşla gelinen satır", () => {
  const satir = (over: Record<string, unknown> = {}) => ({
    id: ID, tur: "dokuma.tezgah-alarmi", sinif: "ALARM", baslik: "Tezgâh 4 durdu", govde: "Atkı kopuşu", sayac: 1,
    sonAn: new Date().toISOString(), okunduAn: null, cozulduAn: null, ...over,
  });
  beforeEach(() => {
    yet.setYetenek(yet.erpYetenek(["tesis"], [], undefined, true));
    mockBildirimci.ozet.mockResolvedValue({ enabled: true, okunmamis: 1, epoch: 1, rev: 1 });
    mockBildirimci.liste.mockResolvedValue({ items: [satir()], nextCursor: null, sayi: 1 });
    mockBildirimci.okundu.mockResolvedValue({ degisti: true });
  });
  it("⭐ ?vurgu=<id> → 'Tümü' açılır, satır vurgulanır ve okundu sayılır", async () => {
    mockParams = { vurgu: ID };
    render(<GelenBildirimler />);
    await flush();
    expect(mockBildirimci.okundu).toHaveBeenCalledWith(ID);
    expect(mockBildirimci.liste).toHaveBeenCalledWith(expect.objectContaining({ sekme: "tumu" }));
    expect(screen.getByTestId("bildirim-vurgu")).toBeTruthy();
  });
  it("vurgu UUID değilse yok sayılır; çevrimdışıyken yalnız vurgu (yazma yok)", async () => {
    mockParams = { vurgu: "../x" };
    render(<GelenBildirimler />);
    await flush();
    expect(mockBildirimci.okundu).not.toHaveBeenCalled();
    expect(screen.queryByTestId("bildirim-vurgu")).toBeNull();
    mockParams = { vurgu: ID };
    mockSession.offline = true;
    render(<GelenBildirimler />);
    await flush();
    expect(mockBildirimci.okundu).not.toHaveBeenCalled();
    expect(screen.getByTestId("bildirim-vurgu")).toBeTruthy();
  });
});

describe("tercih profilleri (PATRON_PUSH)", () => {
  const PID = "6b1f0c4e-2d3a-4b5c-9d8e-7f6a5b4c3d2e";
  type Gorunum = import("../src/api/bildirim").ProfilGorunumu;
  const gorunum = (etkin: string[], kisisel = [{ id: PID, ad: "Hafta sonu", acik: ["dokuma.tezgah-alarmi"], kapali: ["siparis.termin-gecti"] }]): Gorunum => ({
    hazir: [
      { kod: "HEPSI", ad: "Her şey", aciklama: "Bütün bildirimler", acik: ["dokuma.tezgah-alarmi", "siparis.termin-gecti"] },
      { kod: "SESSIZ", ad: "Sessiz", aciklama: "Yalnız alarmlar", acik: ["dokuma.tezgah-alarmi"] },
    ],
    kisisel,
    etkin,
  });
  const SESSIZ: Tercihler = {
    hucreler: TERCIH.hucreler.map((h) => (h.kind === "siparis.termin-gecti" ? { ...h, kanallar: h.kanallar.map((k) => (k.kanal === "PATRON_PUSH" ? { ...k, durum: "KAPALI" as const } : k)) } : h)),
    satirlar: [...TERCIH.satirlar, { tur: "siparis.termin-gecti", kanal: "PATRON_PUSH", acik: false, kapsam: null }],
  };
  const ac = async () => {
    render(<TelefonBildirimleri nativePush os="android" portlar={() => portlar("VERILDI")} />);
    await flush();
  };
  beforeEach(() => {
    mockCihazci.profiller.mockReset();
    mockCihazci.profiller.mockResolvedValue(gorunum([]));
    mockCihazci.katalog.mockResolvedValue({ turler: [
      { kod: "dokuma.tezgah-alarmi", ad: "Tezgâh alarmı", grup: "Dokuma", sinif: "ALARM" },
      { kod: "siparis.termin-gecti", ad: "Termini geçen sipariş", grup: "Satış" },
    ] });
  });

  it("⭐ uç varsa şerit çizilir, üç düğme YOK; etkin yoksa 'Özel', kanal PATRON_PUSH'tan okunur", async () => {
    await ac();
    expect(screen.getByTestId("telefon-profil-seridi")).toBeTruthy();
    expect(screen.queryByTestId("telefon-hazir")).toBeNull();
    expect(screen.getByTestId("telefon-profil-etkin")).toHaveTextContent("Özel");
    expect(screen.getByTestId("telefon-profil-kisisel-" + PID)).toBeTruthy();
  });
  it("⭐ eski fabrika (404) ya da ağ hatası → şerit yok, üç düğme var; liste yine yüklenir", async () => {
    mockCihazci.profiller.mockRejectedValue(new ApiError(404, "NOT_FOUND", "Bulunamadı"));
    await ac();
    expect(screen.queryByTestId("telefon-profil-seridi")).toBeNull();
    expect(screen.getByTestId("telefon-hazir-ONEMLI")).toBeTruthy();
    expect(screen.getByTestId("telefon-grup-baslik-Dokuma")).toBeTruthy();
  });
  it("⭐ çipe dokunmak profilUygula'yı tek kez çağırır; dönen tercih + etkin profil ekrana yansır", async () => {
    mockCihazci.profilUygula.mockResolvedValue({ ...SESSIZ, profiller: gorunum(["hazir:SESSIZ"]) });
    await ac();
    fireEvent.press(screen.getByTestId("telefon-profil-hazir-SESSIZ"));
    await flush();
    expect(mockCihazci.profilUygula).toHaveBeenCalledTimes(1);
    expect(mockCihazci.profilUygula).toHaveBeenCalledWith({ hazir: "SESSIZ" });
    expect(mockCihazci.tercihYaz).not.toHaveBeenCalled();
    expect(screen.getByTestId("telefon-profil-etkin")).toHaveTextContent("Sessiz");
    expect(screen.getByTestId("telefon-profil-hazir-SESSIZ").props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId("telefon-grup-ozet-Satış")).toHaveTextContent("0/1 açık");
  });
  it("⭐ tek tür değişince profil görünümü tazelenir (etkin 'Özel'e düşebilir)", async () => {
    mockCihazci.profiller.mockResolvedValueOnce(gorunum(["hazir:HEPSI"])).mockResolvedValue(gorunum([]));
    await ac();
    expect(screen.getByTestId("telefon-profil-etkin")).toHaveTextContent("Her şey");
    await gruplariAc();
    fireEvent(screen.getByTestId("telefon-tercih-siparis.termin-gecti"), "valueChange", true);
    await flush();
    expect(mockCihazci.profiller).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("telefon-profil-etkin")).toHaveTextContent("Özel");
  });
  it("⭐ 'Profili kaydet': belirsiz hatada AYNI clientToken yeniden gider, başarıdan sonraki kayıt YENİ token alır", async () => {
    mockCihazci.profilKaydet.mockRejectedValueOnce(new ApiError(0, "AG", "Bağlantı yok")).mockResolvedValue({ profiller: gorunum([]) });
    await ac();
    fireEvent.press(screen.getByTestId("telefon-profil-kaydet"));
    expect(screen.getByTestId("telefon-profil-ad-kaydet").props.accessibilityState?.disabled).toBe(true); // boş ad
    fireEvent.changeText(screen.getByTestId("telefon-profil-ad"), "  Gece  ");
    fireEvent.press(screen.getByTestId("telefon-profil-ad-kaydet"));
    await flush();
    expect(screen.getByTestId("telefon-bildirim-mesaj")).toHaveTextContent("Bağlantı yok");
    fireEvent.press(screen.getByTestId("telefon-profil-ad-kaydet"));
    await flush();
    const [[ad1, t1], [ad2, t2]] = mockCihazci.profilKaydet.mock.calls as [[string, string], [string, string]];
    expect([ad1, ad2]).toEqual(["Gece", "Gece"]);
    expect(t2).toBe(t1);
    expect(screen.queryByTestId("telefon-profil-ad-paneli")).toBeNull();
    expect(screen.getByTestId("telefon-bildirim-mesaj")).toHaveTextContent("“Gece” profili kaydedildi.");
    fireEvent.press(screen.getByTestId("telefon-profil-kaydet"));
    fireEvent.changeText(screen.getByTestId("telefon-profil-ad"), "Sabah");
    fireEvent.press(screen.getByTestId("telefon-profil-ad-kaydet"));
    await flush();
    expect(mockCihazci.profilKaydet.mock.calls[2]![1]).not.toBe(t1);
  });
  it("⭐ kişisel çipe uzun bas → güncelle / yeniden adlandır / onaylı sil", async () => {
    mockCihazci.profilGuncelle.mockResolvedValue({ profiller: gorunum([]) });
    mockCihazci.profilSil.mockResolvedValue(gorunum([], []));
    await ac();
    fireEvent(screen.getByTestId("telefon-profil-kisisel-" + PID), "longPress");
    fireEvent.press(screen.getByTestId("telefon-profil-guncelle"));
    await flush();
    expect(mockCihazci.profilGuncelle).toHaveBeenCalledWith(PID, { seciminiGuncelle: true });
    fireEvent(screen.getByTestId("telefon-profil-kisisel-" + PID), "longPress");
    fireEvent.press(screen.getByTestId("telefon-profil-adlandir"));
    fireEvent.changeText(screen.getByTestId("telefon-profil-ad"), "Hafta içi");
    fireEvent.press(screen.getByTestId("telefon-profil-ad-kaydet"));
    await flush();
    expect(mockCihazci.profilGuncelle).toHaveBeenLastCalledWith(PID, { ad: "Hafta içi" });
    fireEvent(screen.getByTestId("telefon-profil-kisisel-" + PID), "longPress");
    fireEvent.press(screen.getByTestId("telefon-profil-sil"));
    expect(mockCihazci.profilSil).not.toHaveBeenCalled(); // önce onay
    fireEvent.press(screen.getByTestId("telefon-profil-sil-evet"));
    await flush();
    expect(mockCihazci.profilSil).toHaveBeenCalledWith(PID);
    expect(screen.queryByTestId("telefon-profil-kisisel-" + PID)).toBeNull();
  });
  it("⭐ çevrimdışı → çipler kapalı, uygulama çağrısı yok", async () => {
    mockSession.offline = true;
    await ac();
    fireEvent.press(screen.getByTestId("telefon-profil-hazir-SESSIZ"));
    await flush();
    expect(mockCihazci.profilUygula).not.toHaveBeenCalled();
  });
});

describe("tür listesi: katlanır gruplar + arama", () => {
  beforeEach(() => {
    mockCihazci.katalog.mockResolvedValue({ turler: [
      { kod: "dokuma.tezgah-alarmi", ad: "Tezgâh alarmı", grup: "Dokuma", sinif: "ALARM" },
      { kod: "siparis.termin-gecti", ad: "Termini geçen sipariş", grup: "Satış" },
    ] });
  });
  it("⭐ başlık 'x/y açık'; arama eşleşen türü açık grupta gösterir (Türkçe büyük/küçük harf), eşleşme yoksa ileti", async () => {
    render(<TelefonBildirimleri nativePush os="android" portlar={() => portlar("VERILDI")} />);
    await flush();
    expect(screen.getByTestId("telefon-grup-ozet-Dokuma")).toHaveTextContent("1/1 açık");
    expect(screen.queryByTestId("telefon-tercih-siparis.termin-gecti")).toBeNull();
    fireEvent.changeText(screen.getByTestId("telefon-tur-ara"), "TERMİNİ");
    await flush();
    expect(screen.getByTestId("telefon-tercih-siparis.termin-gecti")).toBeTruthy();
    expect(screen.queryByTestId("telefon-grup-baslik-Dokuma")).toBeNull();
    expect(screen.queryByTestId("telefon-grup-ac-Satış")).toBeNull(); // aramada grup toplu anahtarı yok
    fireEvent.changeText(screen.getByTestId("telefon-tur-ara"), "yokboyle");
    await flush();
    expect(screen.getByTestId("telefon-tur-ara-bos")).toBeTruthy();
    fireEvent.press(screen.getByTestId("telefon-tur-ara-temizle"));
    await flush();
    expect(screen.getByTestId("telefon-grup-baslik-Dokuma")).toBeTruthy();
  });
  it("⭐ eski fabrika geri düşüşü: 'Yalnız önemliler' katalog `onemli` işaretini okur, telefon varsayılanını değil", async () => {
    mockCihazci.katalog.mockResolvedValue({ turler: [
      { kod: "dokuma.tezgah-alarmi", ad: "Tezgâh alarmı", grup: "Dokuma", varsayilanKanallar: ["UYGULAMA", "PATRON_PUSH"] },
      { kod: "siparis.termin-gecti", ad: "Termini geçen sipariş", grup: "Satış", varsayilanKanallar: ["UYGULAMA", "PATRON_PUSH"], onemli: true },
    ] });
    render(<TelefonBildirimleri nativePush os="android" portlar={() => portlar("VERILDI")} />);
    await flush();
    fireEvent.press(screen.getByTestId("telefon-hazir-ONEMLI"));
    await flush();
    const { pushTercihGovdesiToplu } = require("../src/api/bildirim") as typeof import("../src/api/bildirim");
    expect(mockCihazci.tercihYaz).toHaveBeenCalledWith(pushTercihGovdesiToplu(TERCIH, new Map([["dokuma.tezgah-alarmi", false], ["siparis.termin-gecti", true]])));
  });
});
