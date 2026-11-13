// V4b bekçisi (sipariş): tel → `POST /api/orders` gövdesi (clientToken = deneme kimliği, belirsiz hatada aynı), bulut
// yazıcısı gelen kutusu gövdesini AYNEN gönderir, başlık PATCH farkı (kısmi sevkte yalnız termin, kalem yok), sürümsüz
// sunucuda düzenleme kapalı, iptal önizleme kapısı (İE → panel, sevkiyat → dur, temiz → iki adım + yeniden önizleme).
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { createAttempt, runAttempt } from "../src/api/attempt";
import { ApiError, type ApiClient } from "../src/api/client";
import { BULUT_YETENEK, erpYetenek, setYetenek } from "../src/api/yetenek";
import { createBulutYazici, createErpYazici, iptalKarari, siparisGovdesi, siparisKaydi, type IptalOnizleme } from "../src/api/yazma";
import { siparisFormu, siparisPatch } from "../src/lib/duzenleme";
import { TERIM } from "../src/lib/terim";

const mockYazici = { kanal: "dogrudan", siparisNotu: false, siparisOku: jest.fn(), siparisGuncelle: jest.fn(), siparisIptalOnizleme: jest.fn(), siparisIptal: jest.fn() };
const mockSession = { yazici: mockYazici, permissions: ["bulut:oturum", "bulut:siparis:oku"] as string[], offline: false, api: { record: jest.fn(), list: jest.fn() }, cache: null, markOnline: jest.fn() };
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => "/siparisler", useLocalSearchParams: () => ({ id: "o1" }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const EditOrder = (require("../app/(app)/(tabs)/siparisler/duzenle") as { default: () => ReactElement }).default;
const CancelOrder = (require("../app/(app)/(tabs)/siparisler/iptal") as { default: () => ReactElement }).default;

const SETS = ["siparis", "cari-kart", "urun", "renk"];
const GOVDE = { cariKartId: "c1", doviz: "USD", termin: "2026-12-01", aciklama: "not", kalemler: [{ urunId: "u1", renkId: "r1", miktar: "1250.5", birimFiyat: "3.25" }, { urunId: "u2", miktar: "10" }] };
const HAM = { id: "o1", orderNumber: "SIP1311260001", status: "APPROVED", customerId: "c1", customer: { name: "Deniz" }, currency: "TRY", deadline: "2026-12-01T00:00:00.000Z", contentUpdatedAt: "2026-11-13T09:00:00.000Z", updatedAt: "2026-11-13T08:00:00.000Z", lines: [{ id: "l1", cancelledAt: null }, { id: "l2", cancelledAt: "x" }] };
const TEMIZ: IptalOnizleme = { siparisNo: "SIP1", isEmirleri: [], sevkiyatlar: [], iptalEdilebilir: true, belirtec: null };
const URETIMDE: IptalOnizleme = { ...TEMIZ, isEmirleri: [{ id: "w1", no: "IE-7", durum: "IN_PROGRESS", uretilenTop: 3, izinli: ["UNLINK_ONLY", "CONVERT_TO_STOCK", "CANCEL_WO"], varsayilan: "CONVERT_TO_STOCK", digerSiparisler: [] }] };

function fakeClient(reply: (m: string, path: string, body?: unknown) => unknown) {
  const calls: { m: string; path: string; body?: unknown }[] = [];
  const go = async (m: string, path: string, body?: unknown) => { calls.push({ m, path, ...(body !== undefined ? { body } : {}) }); return reply(m, path, body) as never; };
  const c: ApiClient = { get: (p) => go("GET", p), post: (p, b) => go("POST", p, b), patch: (p, b) => go("PATCH", p, b), del: (p) => go("DELETE", p), download: async () => { throw new Error("yok"); } };
  return { c, calls };
}
const ham = (o: Partial<{ affectedWorkOrders: unknown[]; activeShipments: unknown[]; canCancel: boolean }>) => ({ orderNumber: "SIP1", affectedWorkOrders: [], activeShipments: [], canCancel: true, ...o });

async function settle() {
  await act(async () => undefined);
  await act(async () => undefined);
}

afterEach(() => setYetenek(BULUT_YETENEK));

describe("§1 yaratma gövdesi ve işlem kimliği", () => {
  it("tel gövdesi → fabrika alanları; sayı sayıya, termin takvim günü (UTC gece yarısı), açıklama yok", () => {
    expect(siparisGovdesi(GOVDE, "11111111-1111-4111-8111-111111111111")).toEqual({
      customerId: "c1", currency: "USD", deadline: "2026-12-01T00:00:00.000Z",
      lines: [{ itemId: "u1", colorId: "r1", quantity: 1250.5, unitPrice: 3.25 }, { itemId: "u2", quantity: 10 }],
      clientToken: "11111111-1111-4111-8111-111111111111",
    });
  });
  it("belirsiz hatada aynı clientToken ile tekrar; kesin 4xx'te yeni token", async () => {
    let n = 0;
    const f = fakeClient(() => {
      n += 1;
      if (n === 1) throw new ApiError(0, "AG_HATASI", "koptu");
      if (n === 3) throw new ApiError(400, "VALIDATION_ERROR", "Miktar geçersiz");
      return { id: "o1" };
    });
    const y = createErpYazici(f.c);
    const a = createAttempt(() => `tok-${n}`);
    await expect(runAttempt(a, (id) => y.siparisEkle(id, GOVDE))).rejects.toMatchObject({ code: "AG_HATASI" });
    await expect(runAttempt(a, (id) => y.siparisEkle(id, GOVDE))).resolves.toEqual({ tur: "kayit", id: "o1" });
    const tokens = f.calls.map((c) => (c.body as { clientToken: string }).clientToken);
    expect(tokens[0]).toBe(tokens[1]);
    await expect(runAttempt(a, (id) => y.siparisEkle(id, GOVDE))).rejects.toMatchObject({ status: 400 });
    await runAttempt(a, (id) => y.siparisEkle(id, GOVDE)).catch(() => undefined);
    expect((f.calls[3]!.body as { clientToken: string }).clientToken).not.toBe(tokens[2]);
  });
  it("bulut yazıcısı gelen kutusu gövdesini AYNEN gönderir (açıklama dahil)", async () => {
    const inboxCreate = jest.fn(async () => ({ mesajId: "m1" }));
    const y = createBulutYazici({ inboxCreate } as never);
    expect(y.siparisNotu).toBe(true);
    expect(await y.siparisEkle("m1", GOVDE)).toEqual({ tur: "gelen-kutusu", mesajId: "m1" });
    expect(inboxCreate).toHaveBeenCalledWith("m1", "SIPARIS", GOVDE);
    await expect(y.siparisIptal("o1")).rejects.toMatchObject({ status: 404 });
    await expect(y.siparisGuncelle("o1", "x", {})).rejects.toMatchObject({ status: 404 });
  });
});

describe("§2 başlık düzenleme", () => {
  const K = siparisKaydi(HAM);
  it("sürüm yalnız contentUpdatedAt; iptal kalem sayılmaz; termin takvim günü", () => {
    expect(K.surum).toBe("2026-11-13T09:00:00.000Z");
    expect(K.kalemSayisi).toBe(1);
    expect(K.termin).toBe("01.12.2026");
    expect(siparisKaydi({ ...HAM, contentUpdatedAt: undefined }).surum).toBeNull();
  });
  it("yalnız farklar; cari değişince şube boşalır; kalem hiç gönderilmez", () => {
    expect(siparisPatch(K, siparisFormu(K))).toEqual({ ok: true, body: {} });
    expect(siparisPatch(K, { ...siparisFormu(K), cariKartId: "c2", doviz: "EUR", termin: "" })).toEqual({ ok: true, body: { deadline: null, customerId: "c2", branchId: null, currency: "EUR" } });
    expect(siparisPatch(K, { ...siparisFormu(K), termin: "5.1.2027" })).toEqual({ ok: true, body: { deadline: "2027-01-05T00:00:00.000Z" } });
    expect(siparisPatch(K, { ...siparisFormu(K), termin: "31.02.2027" }).ok).toBe(false);
  });
  it("kısmi sevkte yalnız termin (fabrika diğerini sessizce düşürürdü)", () => {
    const P = { ...K, durum: "PARTIAL_SHIPPED" };
    expect(siparisPatch(P, { ...siparisFormu(P), cariKartId: "c2", doviz: "EUR", termin: "02.12.2026" })).toEqual({ ok: true, body: { deadline: "2026-12-02T00:00:00.000Z" } });
  });
  it("ERP yazıcısı PATCH'e sürümü ekler", async () => {
    const f = fakeClient(() => HAM);
    await createErpYazici(f.c).siparisGuncelle("o1", K.surum!, { currency: "EUR" });
    expect(f.calls[0]).toEqual({ m: "PATCH", path: "/orders/o1", body: { currency: "EUR", expectedUpdatedAt: "2026-11-13T09:00:00.000Z" } });
  });
  it("ekran: sürümsüz sunucuda kaydet kapalı + ileti", async () => {
    setYetenek(erpYetenek(SETS, ["order:write", "order:read"]));
    mockYazici.siparisOku.mockReset().mockResolvedValue(siparisKaydi({ ...HAM, contentUpdatedAt: undefined }));
    render(<EditOrder />);
    await settle();
    expect(screen.getByTestId("surumsuz")).toBeTruthy();
    expect(screen.getByTestId("siparis-kaydet").props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  });
  it("ekran: STALE → form korunur, Yenile sonrası yeni sürümle kaydeder", async () => {
    setYetenek(erpYetenek(SETS, ["order:write", "order:read"]));
    const taze = siparisKaydi({ ...HAM, currency: "USD", contentUpdatedAt: "2026-11-13T09:09:00.000Z" });
    mockYazici.siparisOku.mockReset().mockResolvedValueOnce(K).mockResolvedValueOnce(taze);
    mockYazici.siparisGuncelle.mockReset().mockRejectedValueOnce(new ApiError(409, "STALE_RECORD", "x")).mockResolvedValueOnce(taze);
    mockRouter.back.mockReset();
    render(<EditOrder />);
    await settle();
    fireEvent.changeText(screen.getByTestId("termin-metin"), "15.12.2026");
    fireEvent.press(screen.getByTestId("siparis-kaydet"));
    await settle();
    expect(screen.getByText("Para birimi: USD")).toBeTruthy();
    expect(screen.getByDisplayValue("15.12.2026")).toBeTruthy();
    fireEvent.press(screen.getByTestId("bayat-yenile"));
    fireEvent.press(screen.getByTestId("siparis-kaydet"));
    await settle();
    // Yeni sürüm + kullanıcının iki değişikliği (termin; para birimi formda TRY kaldı → sunucudaki USD'den farklı)
    expect(mockYazici.siparisGuncelle).toHaveBeenLastCalledWith("o1", "2026-11-13T09:09:00.000Z", { deadline: "2026-12-15T00:00:00.000Z", currency: "TRY" });
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe("§3 iptal önizleme kapısı", () => {
  it("karar: sevkiyat → dur, İE → panel, temiz → serbest", () => {
    expect(iptalKarari(TEMIZ)).toBe("SERBEST");
    expect(iptalKarari(URETIMDE)).toBe("URETIMDE");
    expect(iptalKarari({ ...TEMIZ, iptalEdilebilir: false, sevkiyatlar: [{ no: "SV1", durum: "PLANNED" }] })).toBe("SEVKIYAT_VAR");
  });
  it("yazıcı uygulamadan önce önizlemeyi yeniden okur; arada İE bağlandıysa cancel ÇAĞRILMAZ", async () => {
    let n = 0;
    const f = fakeClient((m) => (m === "GET" ? ((n += 1), ham(n === 1 ? {} : { affectedWorkOrders: [{ id: "w1", workOrderNumber: "IE-7", status: "PLANNED" }] })) : {}));
    const y = createErpYazici(f.c);
    expect(iptalKarari(await y.siparisIptalOnizleme("o1"))).toBe("SERBEST");
    await expect(y.siparisIptal("o1")).rejects.toMatchObject({ status: 409, code: "SIPARIS_URETIMDE", message: "Bu sipariş üretimde; her iş emri için ne olacağını seçin" });
    expect(f.calls.filter((c) => c.m === "POST")).toEqual([]);
  });
  it("temiz siparişte cancel boş eylem listesiyle gider", async () => {
    const f = fakeClient((m) => (m === "GET" ? ham({}) : {}));
    await createErpYazici(f.c).siparisIptal("o1");
    expect(f.calls.map((c) => `${c.m} ${c.path}`)).toEqual(["GET /orders/o1/cancel-preview", "POST /orders/o1/cancel"]);
    expect(f.calls[1]!.body).toEqual({ workOrderActions: [] });
  });
  it("ekran: İE taşıyan siparişte kayıtlar listelenir, iptal düğmesi YOK", async () => {
    setYetenek(erpYetenek(SETS, ["order:write"]));
    mockYazici.siparisIptalOnizleme.mockReset().mockResolvedValue(URETIMDE);
    render(<CancelOrder />);
    await settle();
    expect(screen.getByText(`${TERIM.terbiyeIsEmri.tekil} IE-7`)).toBeTruthy();
    expect(screen.getByTestId("iptal-URETIMDE")).toBeTruthy();
    expect(screen.queryByTestId("siparis-iptal")).toBeNull();
  });
  it("ekran: temiz siparişte iki adım; ilk basış istek atmaz", async () => {
    setYetenek(erpYetenek(SETS, ["order:write"]));
    mockSession.offline = false;
    mockYazici.siparisIptalOnizleme.mockReset().mockResolvedValue(TEMIZ);
    mockYazici.siparisIptal.mockReset().mockResolvedValue(undefined);
    mockRouter.back.mockReset();
    render(<CancelOrder />);
    await settle();
    fireEvent.press(screen.getByTestId("siparis-iptal"));
    expect(mockYazici.siparisIptal).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("siparis-iptal-evet"));
    await settle();
    expect(mockYazici.siparisIptal).toHaveBeenCalledWith("o1", null);
    expect(mockRouter.back).toHaveBeenCalled();
  });
  it("ekran: çevrimdışı iptal pasif + 'Sunucuya ulaşılamıyor'", async () => {
    setYetenek(erpYetenek(SETS, ["order:write"]));
    mockSession.offline = true;
    mockYazici.siparisIptalOnizleme.mockReset().mockResolvedValue(TEMIZ);
    mockYazici.siparisIptal.mockReset();
    render(<CancelOrder />);
    await settle();
    expect(screen.getByTestId("yazma-kapali")).toBeTruthy();
    expect(screen.getByTestId("siparis-iptal").props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    mockSession.offline = false;
  });
});
