// Push köprüsü P4 — ERP Bildirimler ekranı: "Telefon bildirimleri" bölümü (görünürlük, izin akışı, tür anahtarı) ve
// telefon bildirimine dokunarak gelinen satırın vurgusu + okundu. Portlar ve uçlar taklit; ağ/Expo yok.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";

const ID = "0f3c2d1e-4b5a-4c6d-8e7f-9a0b1c2d3e4f";
const mockCihazci = { kaydet: jest.fn(), birak: jest.fn(), katalog: jest.fn(), tercihler: jest.fn(), tercihYaz: jest.fn() };
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
  };
  return p;
}
async function flush() {
  for (let i = 0; i < 6; i++) await act(async () => undefined);
}

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
    expect(screen.getByTestId("telefon-tercih-siparis.termin-gecti").props.disabled).toBe(true);
    fireEvent(screen.getByTestId("telefon-tercih-siparis.termin-gecti"), "valueChange", true);
    fireEvent.press(screen.getByTestId("telefon-bildirim-ac"));
    await flush();
    expect(mockCihazci.tercihYaz).not.toHaveBeenCalled();
    expect(mockCihazci.kaydet).not.toHaveBeenCalled();
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
