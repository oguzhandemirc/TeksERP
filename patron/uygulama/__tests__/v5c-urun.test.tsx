// V5c bekçisi (ürün): yetenek (bulutta kapalı · ERP `item:write`[+read] + küme), Ürünler modülü ürün işlemiyle de
// görünür, ERP uçları (POST ad+tür+birim, kod yok · PATCH yalnız ad + sürüm), bulut yazıcısı ağsız, form, düzenleme
// ekranında kod/tür salt okunur, STALE akışı, belirsiz tekrar, çevrimdışı; yeni ürün ekranında belirsiz tekrar aynı
// deneme kimliğiyle (fabrika `clientToken`ı), düzeltilmiş gövde yeni kimlikle.
// NEGATİF SONDA (2026-11-13): `urunGuncelle`den sürüm düşürüldü + birim türden türetilmedi → 2 ✕ (§2a §2c).
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { ApiError, type ApiClient } from "../src/api/client";
import { BULUT_YETENEK, erpYetenek, islemVar, setYetenek } from "../src/api/yetenek";
import { createBulutYazici, createErpYazici, urunKaydi, type UrunKaydi } from "../src/api/yazma";
import { moduleVisible } from "../src/lib/access";
import { urunGovdesi, urunPatch } from "../src/lib/urun";

const mockYazici = { kanal: "dogrudan", urunOku: jest.fn(), urunGuncelle: jest.fn(), urunEkle: jest.fn() };
const mockSession = { yazici: mockYazici, permissions: [] as string[], offline: false };
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => "/urunler", useLocalSearchParams: () => ({ id: "u1" }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const EditItem = (require("../app/(app)/urunler/duzenle") as { default: () => ReactElement }).default;
const NewItem = (require("../app/(app)/urunler/yeni") as { default: () => ReactElement }).default;

const SETS = ["cari-kart", "urun", "renk"];
const YAZ = ["item:write", "item:read"];
const HAM = { id: "u1", code: "STK-000012", name: "POPLIN 120", itemType: "FABRIC", unit: "MT", isActive: true, updatedAt: "2026-11-13T09:00:00.000Z" };
const KAYIT: UrunKaydi = urunKaydi(HAM);

function fakeClient() {
  const calls: { m: string; path: string; body?: unknown }[] = [];
  const c: ApiClient = {
    get: async (path) => { calls.push({ m: "GET", path }); return { ...HAM } as never; },
    post: async (path, body) => { calls.push({ m: "POST", path, body }); return { ...HAM } as never; },
    patch: async (path, body) => { calls.push({ m: "PATCH", path, body }); return { ...HAM } as never; },
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
  it("bulut: ürün işlemleri ve Ürünler modülü kapalı", () => {
    for (const i of ["urun.ekle", "urun.duzenle"] as const) expect(islemVar(i, ["bulut:siparis:yaz", "bulut:oturum"], BULUT_YETENEK)).toBe(false);
    setYetenek(BULUT_YETENEK);
    expect(moduleVisible(["bulut:oturum", "bulut:siparis:yaz"], "urunler")).toBe(false);
  });
  it("ERP: ekle `item:write`, düzenle + `item:read`; küme yoksa kapalı; modül ürün işlemiyle görünür", () => {
    expect(islemVar("urun.ekle", [], erpYetenek(SETS, ["item:write"]))).toBe(true);
    expect(islemVar("urun.duzenle", [], erpYetenek(SETS, ["item:write"]))).toBe(false);
    expect(islemVar("urun.duzenle", [], erpYetenek(SETS, YAZ))).toBe(true);
    expect(islemVar("urun.ekle", [], erpYetenek(["renk"], ["*"]))).toBe(false);
    setYetenek(erpYetenek(SETS, ["item:write"]));
    expect(moduleVisible(["bulut:oturum"], "urunler")).toBe(true);
  });
});

describe("§2 uçlar ve gövde", () => {
  it("ERP yazıcısı: POST /items ad+tür+birim (kod yok), GET kart, PATCH yalnız fark + sürüm", async () => {
    const f = fakeClient();
    const y = createErpYazici(f.c);
    expect(await y.urunEkle("t1", { ad: "SARDIN", tur: "YARN", birim: "KG" })).toEqual({ tur: "kayit", id: "u1" });
    expect(f.calls[0]).toEqual({ m: "POST", path: "/items", body: { name: "SARDIN", itemType: "YARN", unit: "KG", clientToken: "t1" } });
    expect(await y.urunOku("u1")).toEqual(KAYIT);
    await y.urunGuncelle("u1", KAYIT.surum, { name: "POPLIN 140" });
    expect(f.calls[2]).toEqual({ m: "PATCH", path: "/items/u1", body: { name: "POPLIN 140", expectedUpdatedAt: KAYIT.surum } });
  });
  it("bulut yazıcısı ürün işlemlerinde ağa gitmez", async () => {
    const inboxCreate = jest.fn();
    const y = createBulutYazici({ inboxCreate } as never);
    await expect(y.urunEkle("t", { ad: "A", tur: "FABRIC", birim: "MT" })).rejects.toMatchObject({ status: 404, code: "KIP_DESTEKLEMIYOR" });
    await expect(y.urunGuncelle("u1", "x", {})).rejects.toMatchObject({ status: 404 });
    expect(inboxCreate).not.toHaveBeenCalled();
  });
  it("form: ad zorunlu, birim türden; düzenleme yalnız ad farkı", () => {
    expect(urunGovdesi({ ad: " ", tur: "FABRIC" })).toEqual({ ok: false, error: "Ürün adı girin" });
    expect(urunGovdesi({ ad: " Sardın  iplik ", tur: "YARN" })).toEqual({ ok: true, body: { ad: "Sardın iplik", tur: "YARN", birim: "KG" } });
    expect(urunGovdesi({ ad: "X", tur: "CONSUMABLE" })).toMatchObject({ body: { birim: "ADET" } });
    expect(urunGovdesi({ ad: "X", tur: "FABRIC" })).toMatchObject({ body: { birim: "MT" } });
    expect(urunPatch(KAYIT, "POPLIN 120")).toEqual({ ok: true, body: {} });
    expect(urunPatch(KAYIT, "POPLIN 140")).toEqual({ ok: true, body: { name: "POPLIN 140" } });
  });
});

describe("§3 düzenleme ekranı", () => {
  beforeEach(() => {
    setYetenek(erpYetenek(SETS, YAZ));
    mockSession.permissions = ["bulut:oturum"];
    mockSession.offline = false;
    mockYazici.urunOku.mockReset().mockResolvedValue(KAYIT);
    mockYazici.urunGuncelle.mockReset();
    mockRouter.back.mockReset();
  });

  it("kod, tür, birim salt okunur; fiyat izni yoksa Fiyatlar düğmesi yok", async () => {
    render(<EditItem />);
    await settle();
    expect(screen.getByText("STK-000012")).toBeTruthy();
    expect(screen.getByText("Kumaş")).toBeTruthy();
    expect(screen.queryByDisplayValue("STK-000012")).toBeNull();
    expect(screen.queryByTestId("urun-fiyatlar")).toBeNull();
  });

  it("STALE: form korunur, sunucu adı gösterilir, Yenile yeni sürümle kaydeder", async () => {
    const taze = { ...KAYIT, ad: "POPLIN 125", surum: "2026-11-13T09:05:00.000Z" };
    mockYazici.urunGuncelle.mockRejectedValueOnce(new ApiError(409, "STALE_RECORD", "x")).mockResolvedValueOnce(taze);
    mockYazici.urunOku.mockResolvedValueOnce(KAYIT).mockResolvedValueOnce(taze);
    render(<EditItem />);
    await settle();
    fireEvent.changeText(screen.getByTestId("urun-ad"), "POPLIN 140");
    fireEvent.press(screen.getByTestId("urun-kaydet"));
    await settle();
    expect(screen.getByTestId("bayat-kayit")).toBeTruthy();
    expect(screen.getByText("Ad: POPLIN 125")).toBeTruthy();
    expect(screen.getByDisplayValue("POPLIN 140")).toBeTruthy();
    fireEvent.press(screen.getByTestId("bayat-yenile"));
    fireEvent.press(screen.getByTestId("urun-kaydet"));
    await settle();
    expect(mockYazici.urunGuncelle).toHaveBeenLastCalledWith("u1", taze.surum, { name: "POPLIN 140" });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("belirsiz hata → 'Tekrar dene' aynı sürüm ve gövdeyle; STALE + fark yok = başarı", async () => {
    const yazildi = { ...KAYIT, ad: "POPLIN 140", surum: "2026-11-13T09:06:00.000Z" };
    mockYazici.urunGuncelle.mockRejectedValueOnce(new ApiError(0, "AG_HATASI", "Sunucuya ulaşılamadı")).mockRejectedValueOnce(new ApiError(409, "STALE_RECORD", "x"));
    mockYazici.urunOku.mockResolvedValueOnce(KAYIT).mockResolvedValueOnce(yazildi);
    render(<EditItem />);
    await settle();
    fireEvent.changeText(screen.getByTestId("urun-ad"), "POPLIN 140");
    fireEvent.press(screen.getByTestId("urun-kaydet"));
    await settle();
    expect(screen.getByText("Tekrar dene")).toBeTruthy();
    fireEvent.press(screen.getByTestId("urun-kaydet"));
    await settle();
    expect(mockYazici.urunGuncelle.mock.calls[1]).toEqual(mockYazici.urunGuncelle.mock.calls[0]);
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("çevrimdışı: kaydet pasif, istek gitmez", async () => {
    mockSession.offline = true;
    render(<EditItem />);
    await settle();
    expect(screen.getByText("Sunucuya ulaşılamıyor; değişiklik yapılamaz")).toBeTruthy();
    fireEvent.press(screen.getByTestId("urun-kaydet"));
    await settle();
    expect(mockYazici.urunGuncelle).not.toHaveBeenCalled();
  });

  it("işlem kapalıysa okuma yapılmaz", async () => {
    setYetenek(erpYetenek(SETS, ["item:read"]));
    render(<EditItem />);
    await settle();
    expect(mockYazici.urunOku).not.toHaveBeenCalled();
    expect(screen.queryByTestId("urun-kaydet")).toBeNull();
  });
});

describe("§4 yeni ürün ekranı", () => {
  beforeEach(() => {
    setYetenek(erpYetenek(SETS, YAZ));
    mockSession.permissions = ["bulut:oturum"];
    mockSession.offline = false;
    mockYazici.urunEkle.mockReset();
    mockRouter.back.mockReset();
  });

  it("belirsiz hata → 'Tekrar dene' AYNI deneme kimliğiyle; gövde ad+tür+birim", async () => {
    mockYazici.urunEkle.mockRejectedValueOnce(new ApiError(0, "AG_HATASI", "Sunucuya ulaşılamadı")).mockResolvedValueOnce({ tur: "kayit", id: "u9" });
    render(<NewItem />);
    fireEvent.changeText(screen.getByTestId("urun-ad"), "SARDIN");
    fireEvent.press(screen.getByTestId("urun-tur-YARN"));
    fireEvent.press(screen.getByTestId("urun-gonder"));
    await settle();
    expect(screen.getByText("Tekrar dene")).toBeTruthy();
    fireEvent.press(screen.getByTestId("urun-gonder"));
    await settle();
    const [a, b] = mockYazici.urunEkle.mock.calls;
    expect(a![0]).toBe(b![0]);
    expect(a![1]).toEqual({ ad: "SARDIN", tur: "YARN", birim: "KG" });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("kesin hata (ad mükerreri) aynen; düzeltilen gövde yeni deneme kimliği alır", async () => {
    mockYazici.urunEkle.mockRejectedValueOnce(new ApiError(409, "CONFLICT", "'SARDIN' adında ürün zaten var")).mockResolvedValueOnce({ tur: "kayit", id: "u9" });
    render(<NewItem />);
    fireEvent.changeText(screen.getByTestId("urun-ad"), "SARDIN");
    fireEvent.press(screen.getByTestId("urun-gonder"));
    await settle();
    expect(screen.getByText("'SARDIN' adında ürün zaten var")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("urun-ad"), "SARDIN 2");
    fireEvent.press(screen.getByTestId("urun-gonder"));
    await settle();
    const [a, b] = mockYazici.urunEkle.mock.calls;
    expect(a![0]).not.toBe(b![0]);
  });
});
