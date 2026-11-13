// Kalem ekranları bekçisi: düzenleme tam diziyi sürümle yazar, bayatta form korunur, belirsiz sonrası STALE'de taze kayıt
// formla aynıysa başarı; kilitli siparişte yalnız iptal; kalem iptali önizlemeyi (her İE) gösterir, belirteçli gider,
// STALE'de onay baştan, engel varsa düğme yok; çevrimdışı yazma kapalı; sunucu reddi aynen.
// NEGATİF SONDA (2026-11-13): kalemler ekranında `belirsizOnce: belirsiz.current` → `false` yapılınca §1d ✕.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { ApiError } from "../src/api/client";
import type { KalemIptalOnizleme } from "../src/api/kalem-yazma";
import { BULUT_YETENEK, erpYetenek, setYetenek } from "../src/api/yetenek";
import { siparisKaydi } from "../src/api/yazma";
import { kalemDurumu, type KalemDurumu } from "../src/lib/kalem";
import { TERIM } from "../src/lib/terim";

const mockYazici = { kanal: "dogrudan", siparisNotu: false, kalemleriOku: jest.fn(), kalemleriYaz: jest.fn(), kalemIptalOnizleme: jest.fn(), kalemIptal: jest.fn() };
const mockSession = { yazici: mockYazici, permissions: ["bulut:oturum", "bulut:siparis:oku"] as string[], // ERP oturumunun türetilmiş okuma kodları (Screen kapısı)
  offline: false, api: { record: jest.fn(), list: jest.fn() }, cache: null, markOnline: jest.fn() };
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => "/siparisler", useLocalSearchParams: () => ({ id: "o1", kalem: "l1" }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const Kalemler = (require("../app/(app)/(tabs)/siparisler/kalemler") as { default: () => ReactElement }).default;
const KalemIptal = (require("../app/(app)/(tabs)/siparisler/kalem-iptal") as { default: () => ReactElement }).default;

const L1 = { id: "l1", itemId: "u1", item: { name: "Kumaş A" }, colorId: null, quantity: "100", unit: "MT", unitPrice: null, shippedQty: "0", cancelledAt: null, requiredProperties: [{ propertyId: "p1" }], workOrderLinks: [] };
const DETAY = { id: "o1", orderNumber: "SIP1", status: "APPROVED", customerId: "c1", currency: "TRY", contentUpdatedAt: "2026-11-13T09:00:00.000Z", lines: [L1] };
const durum = (h: Record<string, unknown> = DETAY): KalemDurumu => kalemDurumu(siparisKaydi(h), h);
const ONIZ: KalemIptalOnizleme = { siparisNo: "SIP1", urunAdi: "Kumaş A", renkAdi: "", istenen: 100, sevk: 0, kalan: 100, isEmirleri: [{ id: "w1", no: "IE-7", durum: "PLANNED", stogaDoner: true }], siparisSonDurum: "CANCELLED", engeller: [], iptalEdilebilir: true, belirtec: "lc1.a" };

async function settle() {
  await act(async () => undefined);
  await act(async () => undefined);
}
beforeEach(() => {
  setYetenek(erpYetenek(["siparis", "urun"], ["order:write", "order:read"]));
  mockSession.offline = false;
  Object.values(mockYazici).forEach((f) => typeof f === "function" && (f as jest.Mock).mockReset());
  mockRouter.back.mockReset();
  mockRouter.push.mockReset();
});
afterEach(() => setYetenek(BULUT_YETENEK));

describe("§1 kalem düzenleme", () => {
  it("§1a miktar değişir + kalem eklenmeden kaydet: tam dizi sürümle gider, geri dönülür", async () => {
    mockYazici.kalemleriOku.mockResolvedValue(durum());
    mockYazici.kalemleriYaz.mockResolvedValue(durum());
    render(<Kalemler />);
    await settle();
    fireEvent.changeText(screen.getByTestId("miktar-0"), "120");
    fireEvent.press(screen.getByTestId("kalem-kaydet"));
    await settle();
    expect(mockYazici.kalemleriYaz).toHaveBeenCalledWith("o1", "2026-11-13T09:00:00.000Z", [expect.objectContaining({ id: "l1", quantity: 120, requiredPropertyIds: ["p1"] })]);
    expect(mockRouter.back).toHaveBeenCalled();
  });
  it("§1b değişiklik yoksa istek yok; çevrimdışı kaydet pasif", async () => {
    mockYazici.kalemleriOku.mockResolvedValue(durum());
    render(<Kalemler />);
    await settle();
    fireEvent.press(screen.getByTestId("kalem-kaydet"));
    await settle();
    expect(screen.getByTestId("kaydet-bilgi")).toBeTruthy();
    expect(mockYazici.kalemleriYaz).not.toHaveBeenCalled();
    mockSession.offline = true;
    render(<Kalemler />);
    await settle();
    expect(screen.getAllByTestId("yazma-kapali").length).toBeGreaterThan(0);
  });
  it("§1c bayat: form korunur, 'Yenile' sonrası yazdığı miktar durur", async () => {
    mockYazici.kalemleriOku.mockResolvedValueOnce(durum()).mockResolvedValueOnce(durum({ ...DETAY, contentUpdatedAt: "2026-11-13T10:00:00.000Z" }));
    mockYazici.kalemleriYaz.mockRejectedValueOnce(new ApiError(409, "STALE_RECORD", "Kayıt siz bakarken değişti."));
    render(<Kalemler />);
    await settle();
    fireEvent.changeText(screen.getByTestId("miktar-0"), "130");
    fireEvent.press(screen.getByTestId("kalem-kaydet"));
    await settle();
    expect(screen.getByTestId("bayat-kayit")).toBeTruthy();
    fireEvent.press(screen.getByTestId("bayat-yenile"));
    expect(screen.getByTestId("miktar-0").props.value).toBe("130");
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
  it("§1d ⭐ belirsiz hata → 'Tekrar dene' → STALE ama taze kayıt formla aynı → başarı", async () => {
    const yazildi = durum({ ...DETAY, contentUpdatedAt: "2026-11-13T10:00:00.000Z", lines: [{ ...L1, quantity: "140" }] });
    mockYazici.kalemleriOku.mockResolvedValueOnce(durum()).mockResolvedValueOnce(yazildi);
    mockYazici.kalemleriYaz.mockRejectedValueOnce(new ApiError(0, "AG_HATASI", "Bağlantı koptu")).mockRejectedValueOnce(new ApiError(409, "STALE_RECORD", "x"));
    render(<Kalemler />);
    await settle();
    fireEvent.changeText(screen.getByTestId("miktar-0"), "140");
    fireEvent.press(screen.getByTestId("kalem-kaydet"));
    await settle();
    expect(screen.getByText("Tekrar dene")).toBeTruthy();
    fireEvent.press(screen.getByTestId("kalem-kaydet"));
    await settle();
    expect(mockYazici.kalemleriYaz.mock.calls[1]![1]).toBe("2026-11-13T09:00:00.000Z");
    expect(mockRouter.back).toHaveBeenCalled();
  });
  it("§1e üretimdeki siparişte kalemler salt okunur: kaydet/ekle yok, kalem iptali var", async () => {
    mockYazici.kalemleriOku.mockResolvedValue(durum({ ...DETAY, lines: [{ ...L1, workOrderLinks: [{ workOrder: { status: "IN_PROGRESS" } }] }] }));
    render(<Kalemler />);
    await settle();
    expect(screen.getByTestId("kilit-URETIMDE")).toBeTruthy();
    expect(screen.queryByTestId("kalem-kaydet")).toBeNull();
    expect(screen.queryByTestId("kalem-ekle")).toBeNull();
    fireEvent.press(screen.getByTestId("kalem-iptal-l1"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/siparisler/kalem-iptal", params: { id: "o1", kalem: "l1" } });
  });
  it("§1f sunucu reddi aynen gösterilir", async () => {
    mockYazici.kalemleriOku.mockResolvedValue(durum());
    mockYazici.kalemleriYaz.mockRejectedValueOnce(new ApiError(400, "VALIDATION_ERROR", "Renk bu kumaşın izinli renk listesinde değil."));
    render(<Kalemler />);
    await settle();
    fireEvent.changeText(screen.getByTestId("miktar-0"), "150");
    fireEvent.press(screen.getByTestId("kalem-kaydet"));
    await settle();
    expect(screen.getByText("Renk bu kumaşın izinli renk listesinde değil.")).toBeTruthy();
  });
});

describe("§2 kalem iptali", () => {
  it("§2a önizleme her İE'yi ve sipariş sonucunu listeler; iki adımlı onay görülen önizlemeyle gider", async () => {
    mockYazici.kalemIptalOnizleme.mockResolvedValue(ONIZ);
    mockYazici.kalemIptal.mockResolvedValue(undefined);
    render(<KalemIptal />);
    await settle();
    expect(screen.getByText(`${TERIM.terbiyeIsEmri.tekil} IE-7`)).toBeTruthy();
    expect(screen.getByText(/stok üretimine döner/)).toBeTruthy();
    fireEvent.press(screen.getByTestId("kalem-iptal-onay"));
    expect(mockYazici.kalemIptal).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("kalem-iptal-onay-evet"));
    await settle();
    expect(mockYazici.kalemIptal).toHaveBeenCalledWith("o1", "l1", ONIZ);
    expect(mockRouter.back).toHaveBeenCalled();
  });
  it("§2b STALE: yeni önizleme yüklenir, uyarı, onay baştan", async () => {
    mockYazici.kalemIptalOnizleme.mockResolvedValueOnce(ONIZ).mockResolvedValueOnce({ ...ONIZ, belirtec: "lc1.b" });
    mockYazici.kalemIptal.mockRejectedValueOnce(new ApiError(409, "CANCEL_PREVIEW_STALE", "Kalem siz bakarken değişti."));
    render(<KalemIptal />);
    await settle();
    fireEvent.press(screen.getByTestId("kalem-iptal-onay"));
    fireEvent.press(screen.getByTestId("kalem-iptal-onay-evet"));
    await settle();
    expect(screen.getByTestId("kalem-iptal-degisti")).toBeTruthy();
    expect(screen.queryByTestId("kalem-iptal-onay-evet")).toBeNull();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
  it("§2c engel varsa fabrikanın iletisi, iptal düğmesi yok; çevrimdışı pasif", async () => {
    mockYazici.kalemIptalOnizleme.mockResolvedValueOnce({ ...ONIZ, iptalEdilebilir: false, engeller: ["Kalemin tamamı sevk edilmiş — iptal edilecek bir şey kalmadı."] });
    render(<KalemIptal />);
    await settle();
    expect(screen.getByText("Kalemin tamamı sevk edilmiş — iptal edilecek bir şey kalmadı.")).toBeTruthy();
    expect(screen.queryByTestId("kalem-iptal-onay")).toBeNull();
    mockSession.offline = true;
    mockYazici.kalemIptalOnizleme.mockResolvedValueOnce(ONIZ);
    render(<KalemIptal />);
    await settle();
    expect(screen.getByTestId("kalem-iptal-onay").props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  });
  it("§2d belirsiz denemeden sonra 4xx ama kalem iptal edilmiş → başarı", async () => {
    mockYazici.kalemIptalOnizleme.mockResolvedValue(ONIZ);
    mockYazici.kalemIptal.mockRejectedValueOnce(new ApiError(0, "AG_HATASI", "koptu")).mockRejectedValueOnce(new ApiError(400, "BAD_REQUEST", "Bu kalem zaten iptal edilmiş."));
    mockYazici.kalemleriOku.mockResolvedValue(durum({ ...DETAY, lines: [{ ...L1, cancelledAt: "2026-11-13T10:00:00.000Z" }] }));
    render(<KalemIptal />);
    await settle();
    fireEvent.press(screen.getByTestId("kalem-iptal-onay"));
    fireEvent.press(screen.getByTestId("kalem-iptal-onay-evet"));
    await settle();
    fireEvent.press(screen.getByTestId("kalem-iptal-tekrar"));
    await settle();
    expect(mockRouter.back).toHaveBeenCalled();
  });
});
