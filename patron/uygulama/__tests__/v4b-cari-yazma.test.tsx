// V4b bekçisi (cari): yetenek türetme (bulut aynen · ERP izin+küme+joker), tel → ERP gövdesi, ERP uçları + sürüm,
// bulut yazıcısı gelen kutusu çağrısını AYNEN yapar, düzenleme farkı, STALE akışı (form korunur, Yenile sürümü alır,
// belirsiz hatadan sonra STALE = başarı), çevrimdışı kapalılık, pasif ret iletisi.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { ApiError, type ApiClient } from "../src/api/client";
import { BULUT_YETENEK, erpYetenek, islemVar, setYetenek } from "../src/api/yetenek";
import { cariGovdesi, cariKaydi, createBulutYazici, createErpYazici, type CariKaydi } from "../src/api/yazma";
import { cariFormu, cariPatch, ekleHatasi, surumluKaydet } from "../src/lib/duzenleme";

const mockYazici = { kanal: "dogrudan", siparisNotu: false, cariOku: jest.fn(), cariGuncelle: jest.fn(), cariPasif: jest.fn() };
const mockSession = { yazici: mockYazici, permissions: [] as string[], offline: false, api: { record: jest.fn(), list: jest.fn() }, cache: null, markOnline: jest.fn() };
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => "/cariler", useLocalSearchParams: () => ({ id: "c1" }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const EditCustomer = (require("../app/(app)/cariler/duzenle") as { default: () => ReactElement }).default;

const SETS = ["cari-kart", "siparis", "urun", "renk"];
const HAM = { id: "c1", code: "MUS0001", name: "Deniz Tekstil", isCustomerRole: true, isSupplierRole: false, isSubcontractorRole: false, city: "Bursa", taxNumber: "", contactPhone: null, email: null, isActive: true, updatedAt: "2026-11-13T09:00:00.000Z" };
const KAYIT: CariKaydi = cariKaydi(HAM);

function fakeClient() {
  const calls: { m: string; path: string; body?: unknown }[] = [];
  const reply = jest.fn(async (_m: string, _p: string, _b?: unknown): Promise<unknown> => ({ ...HAM }));
  const c: ApiClient = {
    get: async (path) => { calls.push({ m: "GET", path }); return reply("GET", path) as never; },
    post: async (path, body) => { calls.push({ m: "POST", path, body }); return reply("POST", path, body) as never; },
    patch: async (path, body) => { calls.push({ m: "PATCH", path, body }); return reply("PATCH", path, body) as never; },
    del: async (path) => { calls.push({ m: "DELETE", path }); return reply("DELETE", path) as never; },
    download: async () => { throw new Error("yok"); },
  };
  return { c, calls, reply };
}

async function settle() {
  await act(async () => undefined);
  await act(async () => undefined);
}

afterEach(() => setYetenek(BULUT_YETENEK));

describe("§1 yetenek türetme", () => {
  it("bulut: yalnız yaratma, bugünkü bulut kodlarıyla; düzenle/pasif/iptal yok", () => {
    const perms = ["bulut:cari:yaz", "bulut:siparis:yaz"];
    expect(islemVar("cari.ekle", perms, BULUT_YETENEK)).toBe(true);
    expect(islemVar("siparis.ekle", perms, BULUT_YETENEK)).toBe(true);
    expect(islemVar("cari.ekle", [], BULUT_YETENEK)).toBe(false);
    for (const i of ["cari.duzenle", "cari.pasif", "siparis.duzenle", "siparis.iptal"] as const) expect(islemVar(i, perms, BULUT_YETENEK)).toBe(false);
  });
  it("ERP: ham ERP izni + küme şartı; bulut kodu ERP'de işe yaramaz", () => {
    const y = erpYetenek(SETS, ["customer:write", "customer:read"]);
    expect(islemVar("cari.ekle", [], y)).toBe(true);
    expect(islemVar("cari.duzenle", [], y)).toBe(true);
    expect(islemVar("cari.pasif", [], y)).toBe(true);
    expect(islemVar("siparis.ekle", ["bulut:siparis:yaz"], y)).toBe(false);
    expect(islemVar("cari.duzenle", [], erpYetenek(SETS, ["customer:write"]))).toBe(false); // detay okuması customer:read ister
    expect(islemVar("cari.ekle", [], erpYetenek(["siparis"], ["customer:write"]))).toBe(false); // cari-kart sunulmuyor
    expect(islemVar("cari.ekle", [], erpYetenek(undefined, ["*"]))).toBe(false); // beyansız sunucu: fail-closed
  });
  it("ERP: `*` ve `alan:*` jokeri fabrikanın eşlemesiyle; `mobile:siparis` yalnız yaratma", () => {
    expect(islemVar("cari.pasif", [], erpYetenek(SETS, ["*"]))).toBe(true);
    expect(islemVar("siparis.iptal", [], erpYetenek(SETS, ["order:*"]))).toBe(true);
    const saha = erpYetenek(SETS, ["mobile:siparis"]);
    expect(islemVar("siparis.ekle", [], saha)).toBe(true);
    expect(islemVar("siparis.duzenle", [], saha)).toBe(false);
    expect(islemVar("siparis.iptal", [], saha)).toBe(false);
  });
});

describe("§2 tel → ERP gövdesi ve uçlar", () => {
  it("cari gövdesi fabrikanın gelen kutusu eşlemesiyle; finans/kod yok", () => {
    expect(cariGovdesi({ ad: "A", roller: { musteri: true, tedarikci: true }, il: "Bursa", vergiNo: "1234567890", telefon: "0555", eposta: "a@b.co" })).toEqual({
      name: "A", isCustomerRole: true, isSupplierRole: true, city: "Bursa", taxNumber: "1234567890", contactPhone: "0555", email: "a@b.co",
    });
  });
  it("ERP yazıcısı: POST /customers, PATCH sürümle, DELETE ile pasif", async () => {
    const f = fakeClient();
    const y = createErpYazici(f.c);
    expect(await y.cariEkle("t1", { ad: "A", roller: { musteri: true, tedarikci: false } })).toEqual({ tur: "kayit", id: "c1" });
    expect(f.calls[0]).toEqual({ m: "POST", path: "/customers", body: { name: "A", isCustomerRole: true, isSupplierRole: false, clientToken: "t1" } });
    await y.cariGuncelle("c1", KAYIT.surum, { city: "İzmir" });
    expect(f.calls[1]).toEqual({ m: "PATCH", path: "/customers/c1", body: { city: "İzmir", expectedUpdatedAt: "2026-11-13T09:00:00.000Z" } });
    await y.cariPasif("c1");
    expect(f.calls[2]).toEqual({ m: "DELETE", path: "/customers/c1" });
  });
  it("bulut yazıcısı gelen kutusu çağrısını AYNEN yapar; düzenle/pasif ağa gitmez", async () => {
    const inboxCreate = jest.fn(async () => ({ mesajId: "m1" }));
    const y = createBulutYazici({ inboxCreate } as never);
    const g = { ad: "A", roller: { musteri: true, tedarikci: false } };
    expect(await y.cariEkle("m1", g)).toEqual({ tur: "gelen-kutusu", mesajId: "m1" });
    expect(inboxCreate).toHaveBeenCalledWith("m1", "CARI", g);
    await expect(y.cariGuncelle("c1", "x", {})).rejects.toMatchObject({ status: 404, code: "KIP_DESTEKLEMIYOR" });
    await expect(y.cariPasif("c1")).rejects.toMatchObject({ status: 404 });
    expect(inboxCreate).toHaveBeenCalledTimes(1);
  });
});

describe("§3 düzenleme farkı ve sürümlü kaydet", () => {
  it("yalnız değişen alan; boşaltılan alan null; rol değişimi bayrakla", () => {
    const f = { ...cariFormu(KAYIT), il: "", telefon: "0555 111 22 33", tedarikci: true };
    expect(cariPatch(KAYIT, f)).toEqual({ ok: true, body: { city: null, contactPhone: "0555 111 22 33", isSupplierRole: true } });
    expect(cariPatch(KAYIT, cariFormu(KAYIT))).toEqual({ ok: true, body: {} });
    expect(cariPatch(KAYIT, { ...cariFormu(KAYIT), musteri: false })).toEqual({ ok: false, error: "En az bir rol seçin" });
    expect(cariPatch({ ...KAYIT, fason: true }, { ...cariFormu(KAYIT), musteri: false }).ok).toBe(true);
  });
  it("STALE → taze kayıt, 'bayat'; belirsiz denemeden sonra fark yoksa 'tamam'", async () => {
    const stale = new ApiError(409, "STALE_RECORD", "Kayıt siz bakarken değişti.");
    const taze = { ...KAYIT, il: "İzmir", surum: "2026-11-13T09:05:00.000Z" };
    const yaz = jest.fn(async () => { throw stale; });
    const r1 = await surumluKaydet({ yaz, oku: async () => taze, farkVar: () => true, belirsizOnce: false });
    expect(r1).toEqual({ tur: "bayat", taze });
    const r2 = await surumluKaydet({ yaz, oku: async () => taze, farkVar: () => false, belirsizOnce: true });
    expect(r2).toEqual({ tur: "tamam", kayit: taze });
    // belirsizlik yoksa fark olmasa da bayat (başkası aynı değeri yazmış olabilir; kullanıcı görsün)
    expect((await surumluKaydet({ yaz, oku: async () => taze, farkVar: () => false, belirsizOnce: false })).tur).toBe("bayat");
    await expect(surumluKaydet({ yaz: async () => { throw new ApiError(400, "VALIDATION_ERROR", "Ad zorunlu"); }, oku: async () => taze, farkVar: () => true, belirsizOnce: false })).rejects.toMatchObject({ message: "Ad zorunlu" });
  });
  it("belirsiz denemeden sonraki ad mükerreri 'önceki deneme kaydedilmiş olabilir' der", () => {
    const dup = new ApiError(409, "CUSTOMER_NAME_DUPLICATE", "'A' adında bir müşteri zaten var");
    expect((ekleHatasi(dup, true) as ApiError).message).toMatch(/önceki deneme kaydedilmiş olabilir/);
    expect(ekleHatasi(dup, false)).toBe(dup);
  });
});

describe("§4 düzenleme ekranı", () => {
  beforeEach(() => {
    setYetenek(erpYetenek(SETS, ["customer:write", "customer:read"]));
    mockSession.permissions = ["bulut:oturum", "bulut:cari:oku"]; // ERP oturumunun türetilmiş bulut okuma kodları
    mockSession.offline = false;
    mockYazici.cariOku.mockReset().mockResolvedValue(KAYIT);
    mockYazici.cariGuncelle.mockReset();
    mockRouter.back.mockReset();
  });

  it("STALE: form korunur, sunucu değeri gösterilir, Yenile yeni sürümle kaydeder", async () => {
    const taze = { ...KAYIT, il: "İzmir", surum: "2026-11-13T09:05:00.000Z" };
    mockYazici.cariGuncelle.mockRejectedValueOnce(new ApiError(409, "STALE_RECORD", "x")).mockResolvedValueOnce({ ...taze, telefon: "0555" });
    mockYazici.cariOku.mockResolvedValueOnce(KAYIT).mockResolvedValueOnce(taze);
    render(<EditCustomer />);
    await settle();
    fireEvent.changeText(screen.getByDisplayValue("Bursa"), "Ankara");
    fireEvent.press(screen.getByTestId("cari-kaydet"));
    await settle();
    expect(screen.getByTestId("bayat-kayit")).toBeTruthy();
    expect(screen.getByText("İl: İzmir")).toBeTruthy();
    expect(screen.getByDisplayValue("Ankara")).toBeTruthy(); // yazılan kaybolmadı
    expect(screen.getByTestId("cari-kaydet").props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    fireEvent.press(screen.getByTestId("bayat-yenile"));
    fireEvent.press(screen.getByTestId("cari-kaydet"));
    await settle();
    expect(mockYazici.cariGuncelle).toHaveBeenLastCalledWith("c1", "2026-11-13T09:05:00.000Z", { city: "Ankara" });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("belirsiz hata → 'Tekrar dene'; tekrar STALE ama sunucu zaten formdaysa başarı", async () => {
    const yazildi = { ...KAYIT, il: "Ankara", surum: "2026-11-13T09:06:00.000Z" };
    mockYazici.cariGuncelle.mockRejectedValueOnce(new ApiError(0, "AG_HATASI", "Sunucuya ulaşılamadı")).mockRejectedValueOnce(new ApiError(409, "STALE_RECORD", "x"));
    mockYazici.cariOku.mockResolvedValueOnce(KAYIT).mockResolvedValueOnce(yazildi);
    render(<EditCustomer />);
    await settle();
    fireEvent.changeText(screen.getByDisplayValue("Bursa"), "Ankara");
    fireEvent.press(screen.getByTestId("cari-kaydet"));
    await settle();
    expect(screen.getByText("Tekrar dene")).toBeTruthy();
    fireEvent.press(screen.getByTestId("cari-kaydet"));
    await settle();
    expect(mockYazici.cariGuncelle).toHaveBeenCalledTimes(2);
    expect(mockYazici.cariGuncelle.mock.calls[1]).toEqual(mockYazici.cariGuncelle.mock.calls[0]); // aynı sürüm, aynı gövde
    expect(screen.queryByTestId("bayat-kayit")).toBeNull();
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("çevrimdışı: kaydet pasif + 'Sunucuya ulaşılamıyor', istek gitmez", async () => {
    mockSession.offline = true;
    render(<EditCustomer />);
    await settle();
    expect(screen.getByText("Sunucuya ulaşılamıyor; değişiklik yapılamaz")).toBeTruthy();
    expect(screen.getByTestId("cari-kaydet").props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    fireEvent.press(screen.getByTestId("cari-kaydet"));
    await settle();
    expect(mockYazici.cariGuncelle).not.toHaveBeenCalled();
  });

  it("işlem kapalıysa (izin yok) okuma bile yapılmaz", async () => {
    setYetenek(erpYetenek(SETS, ["customer:read"]));
    render(<EditCustomer />);
    await settle();
    expect(screen.getByText("Bu işlem için yetkiniz yok.")).toBeTruthy();
    expect(mockYazici.cariOku).not.toHaveBeenCalled();
  });
});
