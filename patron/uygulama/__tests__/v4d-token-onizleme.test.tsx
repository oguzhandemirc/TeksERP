// V4d bekçisi: cari doğuşu `clientToken` taşır (deneme kimliği; belirsiz hatada aynı, kesin 4xx'te yeni), GONE ve
// COLLISION iletileri, token'ı yok sayan eski sunucuda ad mükerreri iletisi; iptal önizleme belirteci iptale gider
// (eski sunucuda gönderilmez), 409 CANCEL_PREVIEW_STALE → önizleme yeniden çekilir, iki adımlı onay BAŞTAN; bulut aynı.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { createAttempt, runAttempt } from "../src/api/attempt";
import { ApiError, type ApiClient } from "../src/api/client";
import { createApi } from "../src/api/endpoints";
import { BULUT_YETENEK, erpYetenek, setYetenek } from "../src/api/yetenek";
import { createBulutYazici, createErpYazici, iptalOnizleme, type IptalOnizleme } from "../src/api/yazma";
import { ekleHatasi } from "../src/lib/duzenleme";

const mockYazici = { kanal: "dogrudan", siparisNotu: false, cariEkle: jest.fn(), siparisOku: jest.fn(), siparisIptalOnizleme: jest.fn(), siparisIptal: jest.fn() };
const mockSession = { yazici: mockYazici, permissions: ["bulut:oturum", "bulut:siparis:oku", "bulut:cari:oku"] as string[], offline: false, api: { record: jest.fn(), list: jest.fn() }, cache: null, markOnline: jest.fn() };
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => true };
jest.mock("../src/state/session", () => ({ useSession: () => mockSession }));
jest.mock("expo-router", () => ({ useRouter: () => mockRouter, usePathname: () => "/", useLocalSearchParams: () => ({ id: "o1" }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const NewCustomer = (require("../app/(app)/cariler/yeni") as { default: () => ReactElement }).default;
const CancelOrder = (require("../app/(app)/(tabs)/siparisler/iptal") as { default: () => ReactElement }).default;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const G = { ad: "Deniz Tekstil", roller: { musteri: true, tedarikci: false } };

function fakeClient(reply: (m: string, path: string, body?: unknown) => unknown) {
  const calls: { m: string; path: string; body?: unknown }[] = [];
  const go = async (m: string, path: string, body?: unknown) => { calls.push({ m, path, ...(body !== undefined ? { body } : {}) }); return reply(m, path, body) as never; };
  const c: ApiClient = { get: (p) => go("GET", p), post: (p, b) => go("POST", p, b), patch: (p, b) => go("PATCH", p, b), del: (p) => go("DELETE", p), download: async () => { throw new Error("yok"); } };
  return { c, calls };
}
const tokenOf = (b: unknown) => (b as { clientToken?: string }).clientToken;

async function settle() {
  for (let i = 0; i < 4; i++) await act(async () => undefined);
}

afterEach(() => setYetenek(BULUT_YETENEK));

describe("§1 cari doğuşu: clientToken", () => {
  it("token gövdede; belirsiz hatada AYNI, başarıdan ve kesin 4xx'ten sonra YENİ", async () => {
    let n = 0;
    const f = fakeClient(() => {
      n += 1;
      if (n === 1) throw new ApiError(503, "SUNUCU_HATASI", "geçici");
      if (n === 3) throw new ApiError(400, "VALIDATION_ERROR", "Ad geçersiz");
      return { id: "c1" };
    });
    const y = createErpYazici(f.c);
    const a = createAttempt();
    await expect(runAttempt(a, (id) => y.cariEkle(id, G))).rejects.toMatchObject({ status: 503 });
    await runAttempt(a, (id) => y.cariEkle(id, G));
    await expect(runAttempt(a, (id) => y.cariEkle(id, G))).rejects.toMatchObject({ status: 400 });
    await runAttempt(a, (id) => y.cariEkle(id, G));
    const t = f.calls.map((c) => tokenOf(c.body));
    for (const x of t) expect(x).toMatch(UUID);
    expect(t[1]).toBe(t[0]); // belirsiz → yapışır
    expect(t[2]).not.toBe(t[1]); // başarıdan sonra yeni deneme
    expect(t[3]).not.toBe(t[2]); // kesin 4xx → yapışmaz
  });
  it("COLLISION kesin hatadır: ileti + sonraki deneme yeni token", async () => {
    let n = 0;
    const f = fakeClient(() => {
      n += 1;
      if (n === 1) throw new ApiError(409, "CLIENT_TOKEN_COLLISION", "çakışma");
      return { id: "c1" };
    });
    const y = createErpYazici(f.c);
    const a = createAttempt();
    const err = await runAttempt(a, (id) => y.cariEkle(id, G)).catch((e: unknown) => e);
    expect((ekleHatasi(err, false) as ApiError).message).toBe("Önceki deneme farklı bilgilerle kaydedilmiş; yeniden göndermek için tekrar dokunun.");
    await runAttempt(a, (id) => y.cariEkle(id, G));
    expect(tokenOf(f.calls[1]!.body)).not.toBe(tokenOf(f.calls[0]!.body));
  });
  it("GONE → 'pasife alınmış; listeden seçin' (belirsizlik olsun olmasın)", () => {
    const gone = new ApiError(409, "CUSTOMER_CREATE_GONE", "x");
    for (const b of [true, false]) expect((ekleHatasi(gone, b) as ApiError).message).toBe("Bu cari kaydedilmiş ama sonradan pasife alınmış; listeden seçin.");
  });
  it("eski sunucu (token'ı süzgeçte düşürür): belirsiz denemeden sonraki ad mükerreri hâlâ 'kaydedilmiş olabilir'", async () => {
    // Eski fabrika gövdeyi `sanitizeWriteData` ile süzer: clientToken kolonu yazılabilir değil → sessizce yok; ad tekilliği 409.
    const kayitlar = new Set<string>();
    let kop = true;
    const f = fakeClient((_m, _p, body) => {
      const ad = (body as { name: string }).name;
      if (kayitlar.has(ad)) throw new ApiError(409, "CUSTOMER_NAME_DUPLICATE", `'${ad}' adında bir müşteri zaten var`);
      kayitlar.add(ad);
      if (kop) { kop = false; throw new ApiError(0, "AG_HATASI", "koptu"); } // yazıldı ama yanıt kayboldu
      return { id: "c1" };
    });
    const y = createErpYazici(f.c);
    const a = createAttempt();
    const e1 = await runAttempt(a, (id) => y.cariEkle(id, G)).catch((e: unknown) => e);
    const e2 = await runAttempt(a, (id) => y.cariEkle(id, G)).catch((e: unknown) => e);
    expect((ekleHatasi(e1, false) as ApiError).ambiguous).toBe(true);
    expect((ekleHatasi(e2, true) as ApiError).message).toMatch(/önceki deneme kaydedilmiş olabilir/);
  });
  it("ekran: belirsiz → 'Tekrar dene' aynı kimlikle; GONE iletisi görünür; form değişince yeni kimlik", async () => {
    mockSession.offline = false;
    const ids: string[] = [];
    mockYazici.cariEkle.mockReset()
      .mockImplementationOnce(async (id: string) => { ids.push(id); throw new ApiError(0, "AG_HATASI", "koptu"); })
      .mockImplementationOnce(async (id: string) => { ids.push(id); throw new ApiError(409, "CUSTOMER_CREATE_GONE", "x"); })
      .mockImplementationOnce(async (id: string) => { ids.push(id); return { tur: "kayit", id: "c9" }; });
    mockRouter.replace.mockReset();
    render(<NewCustomer />);
    fireEvent.changeText(screen.getByTestId("cari-ad"), "Deniz Tekstil");
    fireEvent.press(screen.getByTestId("cari-gonder"));
    await settle();
    expect(screen.getByText("Tekrar dene")).toBeTruthy();
    fireEvent.press(screen.getByTestId("cari-gonder"));
    await settle();
    expect(screen.getByText("Bu cari kaydedilmiş ama sonradan pasife alınmış; listeden seçin.")).toBeTruthy();
    expect(ids[1]).toBe(ids[0]);
    fireEvent.changeText(screen.getByTestId("cari-ad"), "Deniz Tekstil 2");
    fireEvent.press(screen.getByTestId("cari-gonder"));
    await settle();
    expect(ids[2]).not.toBe(ids[1]);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: "/cariler/[id]", params: { id: "c9" } });
  });
  it("bulut kipi BAYT AYNI: gelen kutusu gövdesi token'sız, mesajId = işlem kimliği", async () => {
    const f = fakeClient(() => ({ mesajId: "m1" }));
    const y = createBulutYazici(createApi(f.c));
    await y.cariEkle("m1", G);
    expect(f.calls).toEqual([{ m: "POST", path: "/gelen-kutusu", body: { mesajId: "m1", tur: "CARI", govde: G } }]);
    await expect(y.siparisIptal("o1", "b1")).rejects.toMatchObject({ status: 404, code: "KIP_DESTEKLEMIYOR" });
    expect(f.calls).toHaveLength(1);
  });
});

const ham = (o: Record<string, unknown> = {}) => ({ orderNumber: "SIP1", affectedWorkOrders: [], activeShipments: [], canCancel: true, ...o });
const TEMIZ: IptalOnizleme = { siparisNo: "SIP1", isEmirleri: [], sevkiyatlar: [], iptalEdilebilir: true, belirtec: "b1" };

describe("§2 iptal önizleme belirteci", () => {
  it("önizleme belirteci okunur; eski sunucuda (alan yok/boş) null", () => {
    expect(iptalOnizleme(ham({ previewToken: "b1" })).belirtec).toBe("b1");
    expect(iptalOnizleme(ham()).belirtec).toBeNull();
    expect(iptalOnizleme(ham({ previewToken: null })).belirtec).toBeNull();
  });
  it("iptal görülen belirteçle gider; belirteç yoksa alan HİÇ gönderilmez (eski sunucu)", async () => {
    const f = fakeClient((m) => (m === "GET" ? ham({ previewToken: "b2" }) : {}));
    const y = createErpYazici(f.c);
    await y.siparisIptal("o1", "b1");
    expect(f.calls[1]).toEqual({ m: "POST", path: "/orders/o1/cancel", body: { workOrderActions: [], expectedPreviewToken: "b1" } });
    await y.siparisIptal("o1", null);
    expect(f.calls[3]!.body).toEqual({ workOrderActions: [] });
    await y.siparisIptal("o1");
    expect(f.calls[5]!.body).toEqual({ workOrderActions: [] });
  });
  it("uygulama öncesi yeniden okuma koruması kalır: İE bağlandıysa cancel ÇAĞRILMAZ", async () => {
    const f = fakeClient((m) => (m === "GET" ? ham({ previewToken: "b2", affectedWorkOrders: [{ id: "w1", workOrderNumber: "IE-7", status: "PLANNED" }] }) : {}));
    await expect(createErpYazici(f.c).siparisIptal("o1", "b1")).rejects.toMatchObject({ status: 409, code: "SIPARIS_URETIMDE" });
    expect(f.calls.filter((c) => c.m === "POST")).toEqual([]);
  });
  it("ekran: STALE → önizleme yeniden çekilir, uyarı görünür, onay BAŞTAN, yeni belirteçle gider", async () => {
    setYetenek(erpYetenek(["siparis"], ["order:write"]));
    mockSession.offline = false;
    mockYazici.siparisIptalOnizleme.mockReset().mockResolvedValueOnce(TEMIZ).mockResolvedValueOnce({ ...TEMIZ, belirtec: "b2" });
    mockYazici.siparisIptal.mockReset()
      .mockRejectedValueOnce(new ApiError(409, "CANCEL_PREVIEW_STALE", "Sipariş siz bakarken değişti. Önizlemeyi yenileyin."))
      .mockResolvedValueOnce(undefined);
    mockRouter.back.mockReset();
    render(<CancelOrder />);
    await settle();
    fireEvent.press(screen.getByTestId("siparis-iptal"));
    fireEvent.press(screen.getByTestId("siparis-iptal-evet"));
    await settle();
    expect(mockYazici.siparisIptal).toHaveBeenLastCalledWith("o1", "b1");
    expect(mockYazici.siparisIptalOnizleme).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("iptal-degisti")).toBeTruthy();
    expect(screen.getByText("Sipariş siz bakarken değişti; güncel durum aşağıda. Yeniden onaylayın.")).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();
    // Onay baştan: "Evet" görünmez, ilk basış istek atmaz.
    expect(screen.queryByTestId("siparis-iptal-evet")).toBeNull();
    fireEvent.press(screen.getByTestId("siparis-iptal"));
    expect(mockYazici.siparisIptal).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId("siparis-iptal-evet"));
    await settle();
    expect(mockYazici.siparisIptal).toHaveBeenLastCalledWith("o1", "b2");
    expect(mockRouter.back).toHaveBeenCalled();
  });
  it("ekran: STALE sonrası sipariş üretime girdi → İE eylemi seçilir, onay BAŞTAN, seçimle + yeni belirteçle gider", async () => {
    setYetenek(erpYetenek(["siparis"], ["order:write"]));
    mockSession.offline = false;
    mockYazici.siparisIptalOnizleme.mockReset().mockResolvedValueOnce(TEMIZ)
      .mockResolvedValueOnce({ ...TEMIZ, belirtec: "b2", isEmirleri: [{ id: "w1", no: "IE-7", durum: "PLANNED", uretilenTop: 0, izinli: ["UNLINK_ONLY"], varsayilan: "UNLINK_ONLY", digerSiparisler: [] }] });
    mockYazici.siparisIptal.mockReset().mockRejectedValueOnce(new ApiError(409, "CANCEL_PREVIEW_STALE", "x")).mockResolvedValueOnce(undefined);
    render(<CancelOrder />);
    await settle();
    fireEvent.press(screen.getByTestId("siparis-iptal"));
    fireEvent.press(screen.getByTestId("siparis-iptal-evet"));
    await settle();
    expect(screen.getByText("Sipariş siz bakarken değişti; güncel durum aşağıda. Yeniden onaylayın.")).toBeTruthy();
    expect(screen.getByTestId("eylem-w1")).toBeTruthy();
    expect(screen.queryByTestId("siparis-iptal-evet")).toBeNull();
    fireEvent.press(screen.getByTestId("siparis-iptal"));
    fireEvent.press(screen.getByTestId("siparis-iptal-evet"));
    await settle();
    expect(mockYazici.siparisIptal).toHaveBeenLastCalledWith("o1", "b2", [{ isEmriId: "w1", eylem: "UNLINK_ONLY" }]);
  });
  it("ekran: STALE sonrası üretime girdi ama fabrika eylem bildirmiyor → iptal düğmesi YOK, 'yeniden onaylayın' denmez", async () => {
    setYetenek(erpYetenek(["siparis"], ["order:write"]));
    mockSession.offline = false;
    mockYazici.siparisIptalOnizleme.mockReset().mockResolvedValueOnce(TEMIZ)
      .mockResolvedValueOnce({ ...TEMIZ, belirtec: "b2", isEmirleri: [{ id: "w1", no: "IE-7", durum: "PLANNED", uretilenTop: 0, izinli: [], varsayilan: null, digerSiparisler: [] }] });
    mockYazici.siparisIptal.mockReset().mockRejectedValueOnce(new ApiError(409, "CANCEL_PREVIEW_STALE", "x"));
    render(<CancelOrder />);
    await settle();
    fireEvent.press(screen.getByTestId("siparis-iptal"));
    fireEvent.press(screen.getByTestId("siparis-iptal-evet"));
    await settle();
    expect(screen.getByText("Sipariş siz bakarken değişti; güncel durum aşağıda.")).toBeTruthy();
    expect(screen.getByTestId("iptal-URETIMDE")).toBeTruthy();
    expect(screen.queryByTestId("siparis-iptal")).toBeNull();
  });
  it("ekran: belirsiz denemeden sonra STALE ama sipariş iptal → başarı (ilk deneme işlemiş)", async () => {
    setYetenek(erpYetenek(["siparis"], ["order:write"]));
    mockSession.offline = false;
    mockYazici.siparisIptalOnizleme.mockReset().mockResolvedValue(TEMIZ);
    mockYazici.siparisOku.mockReset().mockResolvedValue({ durum: "CANCELLED" });
    mockYazici.siparisIptal.mockReset()
      .mockRejectedValueOnce(new ApiError(0, "AG_HATASI", "koptu"))
      .mockRejectedValueOnce(new ApiError(409, "CANCEL_PREVIEW_STALE", "x"));
    mockRouter.back.mockReset();
    render(<CancelOrder />);
    await settle();
    fireEvent.press(screen.getByTestId("siparis-iptal"));
    fireEvent.press(screen.getByTestId("siparis-iptal-evet"));
    await settle();
    fireEvent.press(screen.getByTestId("iptal-tekrar"));
    await settle();
    expect(mockRouter.back).toHaveBeenCalled();
    expect(screen.queryByTestId("iptal-degisti")).toBeNull();
  });
});
