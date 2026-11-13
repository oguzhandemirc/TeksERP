// V5c bekçisi (fiyat): yetenek (bulutta kapalı · ERP `price:write`+`item:read`+küme), Ürünler modülü yalnız ERP'de,
// ERP uçları (liste süzgeci, upsert gövdesi, sürüm yalnız görülen satır varsa), bulut yazıcısı ağsız, form doğrulaması,
// ekranda STALE akışı (form korunur, Yenile taze sürüm), belirsiz tekrar, çevrimdışı, ticaret kapısı reddi aynen.
// NEGATİF SONDA (2026-11-13): `fiyatYaz`dan sürüm düşürüldü + yeni kipte anahtar satırı aranmadı → 2 ✕ (§2a §3b).
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { ApiError, type ApiClient } from "../src/api/client";
import { BULUT_YETENEK, erpYetenek, islemVar, setYetenek } from "../src/api/yetenek";
import { createBulutYazici, createErpYazici, fiyatKaydi, type FiyatKaydi } from "../src/api/yazma";
import { moduleVisible } from "../src/lib/access";
import { BOS_FIYAT, fiyatDegeri, fiyatGovdesi } from "../src/lib/fiyat";

const mockYazici = { kanal: "dogrudan", fiyatlar: jest.fn(), fiyatYaz: jest.fn() };
const mockSession = { yazici: mockYazici, permissions: [] as string[], offline: false };
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => "/urunler/fiyat", useLocalSearchParams: () => ({ id: "u1", ad: "POPLIN" }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const ItemPrices = (require("../app/(app)/urunler/fiyat") as { default: () => ReactElement }).default;

const SETS = ["cari-kart", "urun", "renk"];
const YAZ = ["price:write", "item:read"];
const HAM = { id: "p1", itemId: "u1", customerId: null, kind: "SALE", currency: "TRY", price: "1250.5", updatedAt: "2026-11-13T09:00:00.000Z", customer: null };
const KART: FiyatKaydi = fiyatKaydi(HAM);

function fakeClient() {
  const calls: { m: string; path: string; body?: unknown; query?: unknown }[] = [];
  const c: ApiClient = {
    get: async (path, query) => { calls.push({ m: "GET", path, query }); return [{ ...HAM }, { ...HAM, id: "p2", customerId: "c1", customer: { id: "c1", name: "ACME" }, price: 1300 }] as never; },
    post: async (path, body) => { calls.push({ m: "POST", path, body }); return { id: "p3" } as never; },
    patch: async () => { throw new Error("yok"); },
    put: async () => { throw new Error("yok"); },
    del: async () => { throw new Error("yok"); },
    download: async () => { throw new Error("yok"); },
  };
  return { c, calls };
}

async function settle() {
  await act(async () => undefined);
  await act(async () => undefined);
}

afterEach(() => setYetenek(BULUT_YETENEK));

describe("§1 yetenek ve görünürlük", () => {
  it("bulut: fiyat işlemi ve Ürünler modülü kapalı (bugünkü davranış)", () => {
    expect(islemVar("fiyat.yaz", ["bulut:siparis:yaz", "bulut:oturum"], BULUT_YETENEK)).toBe(false);
    setYetenek(BULUT_YETENEK);
    expect(moduleVisible(["bulut:oturum", "bulut:cari:yaz", "bulut:siparis:yaz"], "urunler")).toBe(false);
  });
  it("ERP: `price:write` + `item:read` + `urun` kümesi; biri eksikse kapalı", () => {
    expect(islemVar("fiyat.yaz", [], erpYetenek(SETS, YAZ))).toBe(true);
    expect(islemVar("fiyat.yaz", [], erpYetenek(SETS, ["price:write"]))).toBe(false);
    expect(islemVar("fiyat.yaz", [], erpYetenek(["renk"], ["*"]))).toBe(false);
    setYetenek(erpYetenek(SETS, YAZ));
    expect(moduleVisible(["bulut:oturum"], "urunler")).toBe(true);
    setYetenek(erpYetenek(SETS, ["item:read"]));
    expect(moduleVisible(["bulut:oturum"], "urunler")).toBe(false);
  });
});

describe("§2 uçlar ve gövde", () => {
  it("ERP yazıcısı: liste ürün süzgeciyle; upsert gövdesi; sürüm yalnız görülen satır varsa", async () => {
    const f = fakeClient();
    const y = createErpYazici(f.c);
    const list = await y.fiyatlar("u1");
    expect(f.calls[0]).toEqual({ m: "GET", path: "/item-prices", query: { "filter[itemId]": "u1", pageSize: 500 } });
    expect(list[0]).toEqual(KART);
    expect(list[1]).toMatchObject({ cariId: "c1", cariAdi: "ACME", fiyat: "1300" });
    await y.fiyatYaz({ urunId: "u1", cariId: null, yon: "SALE", doviz: "TRY", fiyat: "1300" }, KART.surum);
    expect(f.calls[1]).toEqual({ m: "POST", path: "/item-prices", body: { itemId: "u1", customerId: null, kind: "SALE", currency: "TRY", price: 1300, expectedUpdatedAt: KART.surum } });
    await y.fiyatYaz({ urunId: "u1", cariId: "c9", yon: "PURCHASE", doviz: "USD", fiyat: "2.5" }, null);
    expect(f.calls[2]!.body).toEqual({ itemId: "u1", customerId: "c9", kind: "PURCHASE", currency: "USD", price: 2.5 });
  });
  it("bulut yazıcısı fiyatta ağa gitmez (404 KIP_DESTEKLEMIYOR)", async () => {
    const inboxCreate = jest.fn();
    const y = createBulutYazici({ inboxCreate } as never);
    await expect(y.fiyatlar("u1")).rejects.toMatchObject({ status: 404, code: "KIP_DESTEKLEMIYOR" });
    await expect(y.fiyatYaz({ urunId: "u1", cariId: null, yon: "SALE", doviz: "TRY", fiyat: "1" }, null)).rejects.toMatchObject({ status: 404 });
    expect(inboxCreate).not.toHaveBeenCalled();
  });
  it("form: fiyat zorunlu, TR girişi çevrilir, negatif red; para binlik ayırıcılı", () => {
    expect(fiyatGovdesi("u1", BOS_FIYAT)).toEqual({ ok: false, error: "Fiyat girin" });
    expect(fiyatGovdesi("u1", { ...BOS_FIYAT, fiyat: "1.250,5" })).toEqual({ ok: true, body: { urunId: "u1", cariId: null, yon: "SALE", doviz: "TRY", fiyat: "1250.5" } });
    expect(fiyatGovdesi("u1", { ...BOS_FIYAT, fiyat: "1.300" })).toMatchObject({ ok: true, body: { fiyat: "1300" } });
    expect(fiyatGovdesi("u1", { ...BOS_FIYAT, fiyat: "2.5" })).toMatchObject({ ok: true, body: { fiyat: "2.5" } });
    expect(fiyatGovdesi("u1", { ...BOS_FIYAT, fiyat: "-1" })).toEqual({ ok: false, error: "Fiyat negatif olamaz" });
    expect(fiyatDegeri(KART)).toBe("1.250,5 ₺");
  });
});

describe("§3 fiyat ekranı", () => {
  beforeEach(() => {
    setYetenek(erpYetenek(SETS, YAZ));
    mockSession.permissions = ["bulut:oturum"];
    mockSession.offline = false;
    mockYazici.fiyatlar.mockReset().mockResolvedValue([KART]);
    mockYazici.fiyatYaz.mockReset().mockResolvedValue(undefined);
  });

  it("düzenle: yalnız fiyat, görülen sürümle; STALE'de form korunur, Yenile taze sürümle kaydeder", async () => {
    const taze = { ...KART, fiyat: "1400", surum: "2026-11-13T09:05:00.000Z" };
    mockYazici.fiyatYaz.mockRejectedValueOnce(new ApiError(409, "STALE_RECORD", "x")).mockResolvedValueOnce(undefined);
    mockYazici.fiyatlar.mockResolvedValueOnce([KART]).mockResolvedValueOnce([taze]);
    render(<ItemPrices />);
    await settle();
    expect(screen.getByText("1.250,5 ₺")).toBeTruthy();
    fireEvent.press(screen.getByTestId("fiyat-p1"));
    expect(screen.queryByTestId("fiyat-yon-SALE")).toBeNull(); // anahtar düzenlemede sabit
    fireEvent.changeText(screen.getByTestId("fiyat-deger"), "1.300");
    fireEvent.press(screen.getByTestId("fiyat-kaydet"));
    await settle();
    expect(mockYazici.fiyatYaz).toHaveBeenLastCalledWith({ urunId: "u1", cariId: null, yon: "SALE", doviz: "TRY", fiyat: "1300" }, KART.surum);
    expect(screen.getByTestId("bayat-kayit")).toBeTruthy();
    expect(screen.getByText("Fiyat: 1.400 ₺")).toBeTruthy();
    expect(screen.getByDisplayValue("1.300")).toBeTruthy();
    fireEvent.press(screen.getByTestId("bayat-yenile"));
    fireEvent.press(screen.getByTestId("fiyat-kaydet"));
    await settle();
    expect(mockYazici.fiyatYaz).toHaveBeenLastCalledWith(expect.objectContaining({ fiyat: "1300" }), taze.surum);
    expect(screen.queryByTestId("fiyat-kaydet")).toBeNull(); // form kapandı, liste yenilendi
  });

  it("yeni: anahtar yoksa sürüm gönderilmez; anahtar listede varsa o satırın sürümü gider", async () => {
    render(<ItemPrices />);
    await settle();
    fireEvent.press(screen.getByTestId("fiyat-ekle"));
    fireEvent.press(screen.getByTestId("fiyat-yon-PURCHASE"));
    fireEvent.press(screen.getByTestId("fiyat-doviz-USD"));
    fireEvent.changeText(screen.getByTestId("fiyat-deger"), "3,25");
    fireEvent.press(screen.getByTestId("fiyat-kaydet"));
    await settle();
    expect(mockYazici.fiyatYaz).toHaveBeenLastCalledWith({ urunId: "u1", cariId: null, yon: "PURCHASE", doviz: "USD", fiyat: "3.25" }, null);
    fireEvent.press(screen.getByTestId("fiyat-ekle"));
    fireEvent.changeText(screen.getByTestId("fiyat-deger"), "9");
    fireEvent.press(screen.getByTestId("fiyat-kaydet"));
    await settle();
    expect(mockYazici.fiyatYaz).toHaveBeenLastCalledWith(expect.objectContaining({ yon: "SALE", doviz: "TRY", fiyat: "9" }), KART.surum);
  });

  it("belirsiz hata → 'Tekrar dene' aynı gövde ve sürümle; STALE + fiyat aynı = başarı", async () => {
    const yazildi = { ...KART, fiyat: "1300", surum: "2026-11-13T09:06:00.000Z" };
    mockYazici.fiyatYaz.mockRejectedValueOnce(new ApiError(0, "AG_HATASI", "Sunucuya ulaşılamadı")).mockRejectedValueOnce(new ApiError(409, "STALE_RECORD", "x"));
    mockYazici.fiyatlar.mockResolvedValueOnce([KART]).mockResolvedValueOnce([yazildi]).mockResolvedValueOnce([yazildi]);
    render(<ItemPrices />);
    await settle();
    fireEvent.press(screen.getByTestId("fiyat-p1"));
    fireEvent.changeText(screen.getByTestId("fiyat-deger"), "1300");
    fireEvent.press(screen.getByTestId("fiyat-kaydet"));
    await settle();
    expect(screen.getByText("Tekrar dene")).toBeTruthy();
    fireEvent.press(screen.getByTestId("fiyat-kaydet"));
    await settle();
    expect(mockYazici.fiyatYaz.mock.calls[1]).toEqual(mockYazici.fiyatYaz.mock.calls[0]);
    expect(screen.queryByTestId("bayat-kayit")).toBeNull();
    expect(screen.queryByTestId("fiyat-kaydet")).toBeNull();
  });

  it("çevrimdışı: kaydet pasif + 'Sunucuya ulaşılamıyor', istek gitmez", async () => {
    mockSession.offline = true;
    render(<ItemPrices />);
    await settle();
    fireEvent.press(screen.getByTestId("fiyat-p1"));
    expect(screen.getByText("Sunucuya ulaşılamıyor; değişiklik yapılamaz")).toBeTruthy();
    fireEvent.press(screen.getByTestId("fiyat-kaydet"));
    await settle();
    expect(mockYazici.fiyatYaz).not.toHaveBeenCalled();
  });

  it("ticaret modülü kapalı: fabrikanın Türkçe reddi aynen gösterilir", async () => {
    mockYazici.fiyatlar.mockReset().mockRejectedValue(new ApiError(403, "MODULE_DISABLED", "Ticaret modülü bu kurulumda kapalı."));
    render(<ItemPrices />);
    await settle();
    expect(screen.getByText("Ticaret modülü bu kurulumda kapalı.")).toBeTruthy();
    expect(screen.queryByTestId("fiyat-ekle")).toBeNull();
  });

  it("işlem kapalıysa okuma yapılmaz", async () => {
    setYetenek(erpYetenek(SETS, ["item:read"]));
    render(<ItemPrices />);
    await settle();
    expect(mockYazici.fiyatlar).not.toHaveBeenCalled();
    expect(screen.queryByTestId("fiyat-ekle")).toBeNull();
  });
});
