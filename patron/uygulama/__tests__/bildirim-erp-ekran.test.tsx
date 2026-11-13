// ERP gelen bildirim ekranı (D2): §1 modül — `bildirimKutusu` açıksa "Bildirimler" adıyla görünür, kapalıysa gizli; bulutta
// ad/alt metin aynen · §2 liste + okunmamış sayısı, satır biçimi (rozet, sayaç) · §3 dokununca okundu + liste/özet
// tazelenir; okunmuş satır dokunulmaz · §4 tümünü okundu · §5 fabrikada kapalı · §6 çevrimdışı yazma yok · §7 özet
// yoklaması: sürüm değişince liste tazelenir · §8 bulut kipi ayar ekranında kalır, bildirimci çağrılmaz · §9 Diğer rozeti.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type React from "react";

const mockApi = { notificationSettings: jest.fn(), deviceList: jest.fn(), notificationHistory: jest.fn(), inboxList: jest.fn() };
const mockBildirimci = { ozet: jest.fn(), liste: jest.fn(), okundu: jest.fn(), tumunuOkundu: jest.fn() };
const mockCache = {
  load: jest.fn(async (_k: string, f: () => Promise<unknown>) => ({ data: await f(), offline: false, savedAt: "2026-11-13T10:00:00.000Z" })),
  peek: jest.fn(async () => null),
};
const mockSession = {
  api: mockApi, bildirimci: mockBildirimci, cache: mockCache, markOnline: jest.fn(), permissions: [] as string[], offline: false,
  offlineSince: null, facility: { tesis: { id: "t", ad: "Fabrika" }, hesap: { ad: "Ali", eposta: "ali" }, esitleme: null } as unknown,
  facilities: [], facilityId: "t", switchError: null, factoryStamp: null,
};
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/bildirimler",
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void | (() => void)) => (require("react") as typeof import("react")).useEffect(() => cb(), [cb]),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const yet = require("../src/api/yetenek") as typeof import("../src/api/yetenek");
const access = require("../src/lib/access") as typeof import("../src/lib/access");
const Notifications = (require("../app/(app)/bildirimler") as { default: () => React.ReactElement }).default;
const More = (require("../app/(app)/(tabs)/diger") as { default: () => React.ReactElement }).default;

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ERP_ACIK = () => yet.erpYetenek(["tesis"], ["patron-app:login"], undefined, true);

function satir(n: number, over: Record<string, unknown> = {}) {
  return {
    id: U(n), tur: "siparis.termin-gecti", sinif: "BILDIRIM", baslik: `Sipariş S-${n} termini geçti`, govde: "Müşteri: Örnek",
    sayac: 1, sonAn: new Date(Date.now() - 5 * 60_000).toISOString(), okunduAn: null, cozulduAn: null, ...over,
  };
}

let rev = 1;
let unread = 2;
async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => undefined);
}

beforeEach(() => {
  for (const f of [...Object.values(mockApi), ...Object.values(mockBildirimci)]) f.mockReset();
  mockCache.load.mockClear();
  mockSession.offline = false;
  rev = 1;
  unread = 2;
  mockBildirimci.ozet.mockImplementation(async () => ({ enabled: true, okunmamis: unread, epoch: 7, rev }));
  mockBildirimci.liste.mockImplementation(async (p: { sekme: string }) => ({
    items: p.sekme === "okunmamis" ? [satir(1), satir(2, { sayac: 3 })] : [satir(1), satir(3, { okunduAn: "2026-11-13T09:00:00.000Z", cozulduAn: "2026-11-13T09:30:00.000Z" })],
    nextCursor: null, sayi: 2,
  }));
  mockBildirimci.okundu.mockResolvedValue({ degisti: true });
  mockBildirimci.tumunuOkundu.mockResolvedValue({ ids: [U(1), U(2)] });
  yet.setYetenek(ERP_ACIK());
});

afterAll(() => yet.setYetenek(yet.BULUT_YETENEK));

describe("§1 modül", () => {
  it("ERP'de kutu açıksa 'Bildirimler' adıyla görünür, kapalıysa gizli; bulutta ad aynen", () => {
    expect(access.moduleVisible([], "bildirimler")).toBe(true);
    expect(access.moduleTitle("bildirimler")).toBe("Bildirimler");
    expect(access.moduleDef("bildirimler").hint).toBe("Fabrikanın size gönderdiği bildirimler");
    yet.setYetenek(yet.erpYetenek(["tesis"], [], undefined, false));
    expect(access.moduleVisible([], "bildirimler")).toBe(false);
    yet.setYetenek(yet.BULUT_YETENEK);
    expect(access.moduleVisible([], "bildirimler")).toBe(true);
    expect(access.moduleTitle("bildirimler")).toBe("Bildirim Ayarları");
    expect(access.moduleDef("bildirimler").hint).toBe("Bu cihazda izin, türler, sessiz saatler");
  });
});

describe("§2–§4 liste ve okundu", () => {
  it("okunmamış sekmesi: sunucu sekmesiyle okunur, sayı sekme adında, sayaç zaman satırında", async () => {
    render(<Notifications />);
    await flush();
    expect(mockBildirimci.liste).toHaveBeenCalledWith({ sekme: "okunmamis", limit: 30 });
    expect(screen.getByText("Okunmamış (2)")).toBeTruthy();
    expect(screen.getByText("Sipariş S-1 termini geçti")).toBeTruthy();
    expect(screen.getAllByText("Okunmadı")).toHaveLength(2);
    expect(screen.getByText(/· 3 kez$/)).toBeTruthy();
    expect(mockApi.notificationSettings).not.toHaveBeenCalled();
  });

  it("Tümü sekmesi: okunmuş satır 'Çözüldü' rozetli ve dokunulmaz", async () => {
    render(<Notifications />);
    await flush();
    fireEvent.press(screen.getByTestId("bildirim-sekme-tumu"));
    await flush();
    expect(mockBildirimci.liste).toHaveBeenLastCalledWith({ sekme: "tumu", limit: 30 });
    expect(screen.getByText("Çözüldü")).toBeTruthy();
    fireEvent.press(screen.getByTestId(`bildirim-${U(3)}`));
    await flush();
    expect(mockBildirimci.okundu).not.toHaveBeenCalled();
  });

  it("satıra dokununca okundu; liste ve özet yeniden okunur", async () => {
    render(<Notifications />);
    await flush();
    const liste = mockBildirimci.liste.mock.calls.length;
    const ozet = mockBildirimci.ozet.mock.calls.length;
    unread = 1;
    fireEvent.press(screen.getByTestId(`bildirim-${U(1)}`));
    await flush();
    expect(mockBildirimci.okundu).toHaveBeenCalledWith(U(1));
    expect(mockBildirimci.liste.mock.calls.length).toBeGreaterThan(liste);
    expect(mockBildirimci.ozet.mock.calls.length).toBeGreaterThan(ozet);
    expect(screen.getByText("Okunmamış (1)")).toBeTruthy();
  });

  it("tümünü okundu say: tek istek, sonra tazeleme; okunmamış yokken düğme yok", async () => {
    render(<Notifications />);
    await flush();
    unread = 0;
    fireEvent.press(screen.getByTestId("tumunu-okundu"));
    await flush();
    expect(mockBildirimci.tumunuOkundu).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("tumunu-okundu")).toBeNull();
    expect(screen.getByText("Okunmamış")).toBeTruthy();
  });

  it("okundu hatası Türkçe bantta gösterilir", async () => {
    const { ApiError } = require("../src/api/client") as typeof import("../src/api/client");
    mockBildirimci.okundu.mockRejectedValue(new ApiError(404, "BILDIRIM_YOK", "Bildirim bulunamadı."));
    render(<Notifications />);
    await flush();
    fireEvent.press(screen.getByTestId(`bildirim-${U(1)}`));
    await flush();
    expect(screen.getByTestId("bildirim-kutusu-hata")).toBeTruthy();
  });
});

describe("§5–§6 kapalı ve çevrimdışı", () => {
  it("fabrikada kapalı (enabled:false): açıklama, liste yok", async () => {
    mockBildirimci.ozet.mockResolvedValue({ enabled: false });
    render(<Notifications />);
    await flush();
    expect(screen.getByTestId("bildirim-kapali")).toBeTruthy();
    expect(screen.queryByTestId("bildirim-kutusu")).toBeNull();
  });

  it("çevrimdışı: satır ve tümünü okundu yazmaz", async () => {
    mockSession.offline = true;
    render(<Notifications />);
    await flush();
    fireEvent.press(screen.getByTestId(`bildirim-${U(1)}`));
    fireEvent.press(screen.getByTestId("tumunu-okundu"));
    await flush();
    expect(mockBildirimci.okundu).not.toHaveBeenCalled();
    expect(mockBildirimci.tumunuOkundu).not.toHaveBeenCalled();
  });
});

describe("§7 canlılık", () => {
  it("odakta 60 sn'de bir özet okunur; sürüm değişince liste tazelenir, değişmezse tazelenmez", async () => {
    jest.useFakeTimers();
    try {
      render(<Notifications />);
      await flush();
      const liste = mockBildirimci.liste.mock.calls.length;
      const ozet = mockBildirimci.ozet.mock.calls.length;
      await act(async () => void jest.advanceTimersByTime(60_000));
      await flush();
      expect(mockBildirimci.ozet.mock.calls.length).toBe(ozet + 1);
      expect(mockBildirimci.liste.mock.calls.length).toBe(liste);
      rev = 2;
      await act(async () => void jest.advanceTimersByTime(60_000));
      await flush();
      expect(mockBildirimci.ozet.mock.calls.length).toBe(ozet + 2);
      expect(mockBildirimci.liste.mock.calls.length).toBe(liste + 1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("§8 bulut kipi", () => {
  it("bulut: ayar ekranı eski uçlarla, bildirimci hiç çağrılmaz", async () => {
    yet.setYetenek(yet.BULUT_YETENEK);
    mockApi.notificationSettings.mockReturnValue(new Promise(() => undefined));
    mockApi.deviceList.mockReturnValue(new Promise(() => undefined));
    render(<Notifications />);
    await flush();
    expect(mockApi.notificationSettings).toHaveBeenCalled();
    expect(Object.values(mockBildirimci).every((f) => f.mock.calls.length === 0)).toBe(true);
  });
});

describe("§9 Diğer rozeti", () => {
  it("ERP'de okunmamış sayısı 'Bildirimler' satırında; bulutta özet okunmaz", async () => {
    unread = 5;
    render(<More />);
    await flush();
    expect(screen.getByTestId("bildirim-rozet")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("Bildirimler")).toBeTruthy();
  });

  it("bulut: bildirim satırı eski adıyla, rozet ve özet isteği yok", async () => {
    yet.setYetenek(yet.BULUT_YETENEK);
    mockApi.inboxList.mockResolvedValue({ kayitlar: [], sonraki: null });
    render(<More />);
    await flush();
    expect(screen.getByText("Bildirim Ayarları")).toBeTruthy();
    expect(screen.queryByTestId("bildirim-rozet")).toBeNull();
    expect(mockBildirimci.ozet).not.toHaveBeenCalled();
  });
});
