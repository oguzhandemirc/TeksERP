// V5c bekçisi (renk): yetenek (bulutta kapalı · ERP izin+küme), Renkler modülü yalnız ERP'de görünür, ERP uçları +
// sürüm, bulut yazıcısı ağa gitmez, form doğrulaması/farkı, düzenleme ekranında STALE akışı, belirsiz tekrar,
// çevrimdışı kapalılık, pasife almada iki adım + sunucu reddi aynen.
// NEGATİF SONDA (2026-11-13): `renkGuncelle`den sürüm düşürüldü + modülün `islemler` şartı kaldırıldı → 3 ✕ (§1a §1c §2a).
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { ApiError, type ApiClient } from "../src/api/client";
import { BULUT_YETENEK, erpYetenek, islemVar, setYetenek } from "../src/api/yetenek";
import { createBulutYazici, createErpYazici, renkKaydi, type RenkKaydi } from "../src/api/yazma";
import { moduleVisible } from "../src/lib/access";
import { renkFormu, renkGovdesi, renkPatch, tanimEkleHatasi } from "../src/lib/duzenleme";

const mockYazici = { kanal: "dogrudan", renkOku: jest.fn(), renkGuncelle: jest.fn(), renkPasif: jest.fn() };
const mockSession = { yazici: mockYazici, permissions: [] as string[], offline: false };
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => "/renkler", useLocalSearchParams: () => ({ id: "r1" }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const EditColor = (require("../app/(app)/renkler/duzenle") as { default: () => ReactElement }).default;

const SETS = ["cari-kart", "urun", "renk"];
const HAM = { id: "r1", code: "RNK1311260001", name: "055 BEYAZ", hex: "#FFFFFF", isActive: true, updatedAt: "2026-11-13T09:00:00.000Z" };
const KAYIT: RenkKaydi = renkKaydi(HAM);
const YAZ = ["property:write", "property:read"];

function fakeClient() {
  const calls: { m: string; path: string; body?: unknown }[] = [];
  const c: ApiClient = {
    get: async (path) => { calls.push({ m: "GET", path }); return { ...HAM } as never; },
    post: async (path, body) => { calls.push({ m: "POST", path, body }); return { ...HAM } as never; },
    patch: async (path, body) => { calls.push({ m: "PATCH", path, body }); return { ...HAM } as never; },
    del: async (path) => { calls.push({ m: "DELETE", path }); return {} as never; },
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
  it("bulut: renk işlemleri ve Renkler modülü kapalı (bugünkü davranış)", () => {
    for (const i of ["renk.ekle", "renk.duzenle", "renk.pasif"] as const) expect(islemVar(i, ["bulut:cari:yaz", "bulut:oturum"], BULUT_YETENEK)).toBe(false);
    setYetenek(BULUT_YETENEK);
    expect(moduleVisible(["bulut:oturum", "bulut:cari:yaz", "bulut:siparis:yaz"], "renkler")).toBe(false);
  });
  it("ERP: `property:write` + küme; düzenleme okuma izni de ister; beyansız sunucu kapalı", () => {
    expect(islemVar("renk.ekle", [], erpYetenek(SETS, ["property:write"]))).toBe(true);
    expect(islemVar("renk.duzenle", [], erpYetenek(SETS, ["property:write"]))).toBe(false);
    expect(islemVar("renk.duzenle", [], erpYetenek(SETS, YAZ))).toBe(true);
    expect(islemVar("renk.pasif", [], erpYetenek(SETS, ["property:*"]))).toBe(true);
    expect(islemVar("renk.ekle", [], erpYetenek(["cari-kart"], ["*"]))).toBe(false);
    expect(islemVar("renk.ekle", [], erpYetenek(undefined, ["*"]))).toBe(false);
  });
  it("ERP: Renkler modülü yalnız işlem açıkken görünür", () => {
    setYetenek(erpYetenek(SETS, YAZ));
    expect(moduleVisible(["bulut:oturum"], "renkler")).toBe(true);
    setYetenek(erpYetenek(SETS, ["property:read"]));
    expect(moduleVisible(["bulut:oturum"], "renkler")).toBe(false);
  });
});

describe("§2 uçlar ve gövde", () => {
  it("ERP yazıcısı: POST /colors (kod yok, deneme kimliği clientToken), PATCH sürümle, DELETE pasif", async () => {
    const f = fakeClient();
    const y = createErpYazici(f.c);
    expect(await y.renkEkle("t1", { ad: "MAVI", hex: "#1D4ED8" })).toEqual({ tur: "kayit", id: "r1" });
    expect(f.calls[0]).toEqual({ m: "POST", path: "/colors", body: { name: "MAVI", hex: "#1D4ED8", clientToken: "t1" } });
    await y.renkEkle("t2", { ad: "MOR" });
    expect(f.calls[1]!.body).toEqual({ name: "MOR", clientToken: "t2" });
    expect(await y.renkOku("r1")).toEqual(KAYIT);
    await y.renkGuncelle("r1", KAYIT.surum, { name: "KREM" });
    expect(f.calls[3]).toEqual({ m: "PATCH", path: "/colors/r1", body: { name: "KREM", expectedUpdatedAt: "2026-11-13T09:00:00.000Z" } });
    await y.renkPasif("r1");
    expect(f.calls[4]).toEqual({ m: "DELETE", path: "/colors/r1" });
  });
  it("bulut yazıcısı renk işlemlerinde ağa gitmez (404 KIP_DESTEKLEMIYOR)", async () => {
    const inboxCreate = jest.fn();
    const y = createBulutYazici({ inboxCreate } as never);
    await expect(y.renkEkle("t", { ad: "A" })).rejects.toMatchObject({ status: 404, code: "KIP_DESTEKLEMIYOR" });
    await expect(y.renkGuncelle("r1", "x", {})).rejects.toMatchObject({ status: 404 });
    await expect(y.renkPasif("r1")).rejects.toMatchObject({ status: 404 });
    expect(inboxCreate).not.toHaveBeenCalled();
  });
  it("form: ad zorunlu, hex '#' tamamlanır ve doğrulanır; fark yalnız değişen alan, boşaltılan hex null", () => {
    expect(renkGovdesi({ ad: " ", hex: "" })).toEqual({ ok: false, error: "Renk adı girin" });
    expect(renkGovdesi({ ad: "Mavi", hex: "1d4ed8" })).toEqual({ ok: true, body: { ad: "Mavi", hex: "#1D4ED8" } });
    expect(renkGovdesi({ ad: "Mavi", hex: "#12" }).ok).toBe(false);
    expect(renkPatch(KAYIT, renkFormu(KAYIT))).toEqual({ ok: true, body: {} });
    expect(renkPatch(KAYIT, { ad: "055 BEYAZ", hex: "" })).toEqual({ ok: true, body: { hex: null } });
    expect(renkPatch(KAYIT, { ad: "KREM", hex: "#ffffff" })).toEqual({ ok: true, body: { name: "KREM" } });
  });
  it("belirsiz denemeden sonraki 409 'önceki deneme kaydedilmiş olabilir' der; kesin denemede aynen", () => {
    const dup = new ApiError(409, "CONFLICT", "'MAVI' adında bir renk zaten var");
    expect((tanimEkleHatasi(dup, true, "Renk") as ApiError).message).toMatch(/önceki deneme kaydedilmiş olabilir/);
    expect(tanimEkleHatasi(dup, false, "Renk")).toBe(dup);
  });
  it("yeni fabrika: token çakışması ve sonradan pasif kayıt kesin iletilere çevrilir", () => {
    expect((tanimEkleHatasi(new ApiError(409, "CLIENT_TOKEN_COLLISION", "x"), true, "Renk") as ApiError).message).toMatch(/farklı bilgilerle kaydedilmiş/);
    expect((tanimEkleHatasi(new ApiError(409, "COLOR_CREATE_GONE", "x"), false, "Renk") as ApiError).message).toMatch(/sonradan pasife alınmış/);
    expect((tanimEkleHatasi(new ApiError(409, "ITEM_CREATE_GONE", "x"), false, "Ürün") as ApiError).code).toBe("ITEM_CREATE_GONE");
  });
});

describe("§3 düzenleme ekranı", () => {
  beforeEach(() => {
    setYetenek(erpYetenek(SETS, YAZ));
    mockSession.permissions = ["bulut:oturum"];
    mockSession.offline = false;
    mockYazici.renkOku.mockReset().mockResolvedValue(KAYIT);
    mockYazici.renkGuncelle.mockReset();
    mockYazici.renkPasif.mockReset();
    mockRouter.back.mockReset();
  });

  it("STALE: form korunur, sunucu değeri gösterilir, Yenile yeni sürümle kaydeder", async () => {
    const taze = { ...KAYIT, hex: "#000000", surum: "2026-11-13T09:05:00.000Z" };
    mockYazici.renkGuncelle.mockRejectedValueOnce(new ApiError(409, "STALE_RECORD", "x")).mockResolvedValueOnce(taze);
    mockYazici.renkOku.mockResolvedValueOnce(KAYIT).mockResolvedValueOnce(taze);
    render(<EditColor />);
    await settle();
    fireEvent.changeText(screen.getByDisplayValue("055 BEYAZ"), "055 KIRIK BEYAZ");
    fireEvent.press(screen.getByTestId("renk-kaydet"));
    await settle();
    expect(screen.getByTestId("bayat-kayit")).toBeTruthy();
    expect(screen.getByText("Renk kodu: #000000")).toBeTruthy();
    expect(screen.getByDisplayValue("055 KIRIK BEYAZ")).toBeTruthy();
    fireEvent.press(screen.getByTestId("bayat-yenile"));
    fireEvent.press(screen.getByTestId("renk-kaydet"));
    await settle();
    expect(mockYazici.renkGuncelle).toHaveBeenLastCalledWith("r1", "2026-11-13T09:05:00.000Z", { name: "055 KIRIK BEYAZ", hex: "#FFFFFF" });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("belirsiz hata → 'Tekrar dene' aynı sürüm ve gövdeyle; STALE + fark yok = başarı", async () => {
    const yazildi = { ...KAYIT, ad: "KREM", surum: "2026-11-13T09:06:00.000Z" };
    mockYazici.renkGuncelle.mockRejectedValueOnce(new ApiError(0, "AG_HATASI", "Sunucuya ulaşılamadı")).mockRejectedValueOnce(new ApiError(409, "STALE_RECORD", "x"));
    mockYazici.renkOku.mockResolvedValueOnce(KAYIT).mockResolvedValueOnce(yazildi);
    render(<EditColor />);
    await settle();
    fireEvent.changeText(screen.getByDisplayValue("055 BEYAZ"), "KREM");
    fireEvent.press(screen.getByTestId("renk-kaydet"));
    await settle();
    expect(screen.getByText("Tekrar dene")).toBeTruthy();
    fireEvent.press(screen.getByTestId("renk-kaydet"));
    await settle();
    expect(mockYazici.renkGuncelle.mock.calls[1]).toEqual(mockYazici.renkGuncelle.mock.calls[0]);
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("çevrimdışı: kaydet pasif + 'Sunucuya ulaşılamıyor', istek gitmez", async () => {
    mockSession.offline = true;
    render(<EditColor />);
    await settle();
    expect(screen.getByText("Sunucuya ulaşılamıyor; değişiklik yapılamaz")).toBeTruthy();
    fireEvent.press(screen.getByTestId("renk-kaydet"));
    await settle();
    expect(mockYazici.renkGuncelle).not.toHaveBeenCalled();
  });

  it("pasife al: iki adım; sunucunun Türkçe reddi aynen gösterilir", async () => {
    mockYazici.renkPasif.mockRejectedValueOnce(new ApiError(409, "MASTER_DATA_IN_USE", "Bu renk 3 açık siparişte kullanılıyor; pasife alınamaz."));
    render(<EditColor />);
    await settle();
    fireEvent.press(screen.getByTestId("renk-pasif"));
    expect(mockYazici.renkPasif).not.toHaveBeenCalled(); // ilk dokunuş yalnız onay sorar
    fireEvent.press(screen.getByText("Evet, uygula"));
    await settle();
    expect(mockYazici.renkPasif).toHaveBeenCalledWith("r1");
    expect(screen.getByText("Bu renk 3 açık siparişte kullanılıyor; pasife alınamaz.")).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it("işlem kapalıysa okuma yapılmaz, form çizilmez (modül uyarısı)", async () => {
    setYetenek(erpYetenek(SETS, ["property:read"]));
    render(<EditColor />);
    await settle();
    expect(screen.queryByTestId("renk-kaydet")).toBeNull();
    expect(mockYazici.renkOku).not.toHaveBeenCalled();
  });
});
