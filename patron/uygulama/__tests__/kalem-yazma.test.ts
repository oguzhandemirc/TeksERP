// Kalem yazımı (ERP) bekçisi: fabrika diziyi TAM değiştirdiği için her mevcut kalem kayıtlı alanlarıyla (zorunlu
// özellikler + iptal edilmiş kalemler dahil) geri gider; kalem formdan çıkarılamaz (iptal ayrı uç); kalem iptali ve
// üretimdeki sipariş iptali görülen önizlemeye bağlı (belirteç + İE kümesi + İE başına eylem); bulutta hepsi kapalı.
// NEGATİF SONDA (2026-11-13): `requiredPropertyIds` geri yollanmayınca 2 ✕ · `eylemlerTam` kapısı kapatılınca 1 ✕.
import { ApiError, type ApiClient } from "../src/api/client";
import { eylemlerTam } from "../src/api/kalem-yazma";
import { BULUT_YETENEK, erpYetenek, islemVar } from "../src/api/yetenek";
import { createBulutYazici, createErpYazici, siparisKaydi } from "../src/api/yazma";
import { kalemDizisi, kalemDurumu, kalemFarkVar, kalemSatirlari, type KalemDurumu } from "../src/lib/kalem";

function fakeClient(reply: (m: string, path: string, body?: unknown) => unknown) {
  const calls: { m: string; path: string; body?: unknown }[] = [];
  const go = async (m: string, path: string, body?: unknown) => { calls.push({ m, path, ...(body !== undefined ? { body } : {}) }); return reply(m, path, body) as never; };
  const c: ApiClient = { get: (p) => go("GET", p), post: (p, b) => go("POST", p, b), patch: (p, b) => go("PATCH", p, b), put: async () => { throw new Error("yok"); }, del: (p) => go("DELETE", p), download: async () => { throw new Error("yok"); } };
  return { c, calls };
}

const L1 = {
  id: "l1", itemId: "u1", item: { name: "Kumaş A" }, colorId: "r1", color: { name: "Mavi" }, quantity: "100.000", unit: "MT", unitPrice: "3.5", width: "1.6",
  customerItemName: "Müşteri adı", customerColorName: null, cutNote: "not", tolerancePct: "2", recipeId: "v1", pieceLengthM: "50", shippedQty: "0",
  cancelledAt: null, requiredProperties: [{ propertyId: "p1" }, { propertyId: "p2" }], workOrderLinks: [],
};
const L2 = { ...L1, id: "l2", itemId: "u2", item: { name: "Kumaş B" }, colorId: null, color: null, quantity: "40", unitPrice: null, requiredProperties: [], recipeId: null };
const L3 = { ...L1, id: "l3", cancelledAt: "2026-11-10T10:00:00.000Z", quantity: "10" };
const DETAY = { id: "o1", orderNumber: "SIP1", status: "APPROVED", customerId: "c1", customer: { name: "Deniz" }, currency: "TRY", contentUpdatedAt: "2026-11-13T09:00:00.000Z", lines: [L1, L2, L3] };
const durum = (h: Record<string, unknown> = DETAY): KalemDurumu => kalemDurumu(siparisKaydi(h), h);

describe("§1 kalem durumu ve kilit", () => {
  it("kalemler okunur; iptal işaretli, sayı nokta ondalık, fiyatsız boş", () => {
    const d = durum();
    expect(d.kilit).toBeNull();
    expect(d.kalemler.map((k) => [k.id, k.miktar, k.birimFiyat, k.iptal])).toEqual([["l1", "100", "3.5", false], ["l2", "40", "", false], ["l3", "10", "3.5", true]]);
    expect(kalemSatirlari(d).map((x) => x.id)).toEqual(["l1", "l2"]);
  });
  it("kısmi sevk · canlı İE bağı · kapalı sipariş kilitler; iptal edilmiş İE bağı kilitlemez", () => {
    expect(durum({ ...DETAY, status: "PARTIAL_SHIPPED" }).kilit).toBe("KISMI_SEVK");
    expect(durum({ ...DETAY, status: "CANCELLED" }).kilit).toBe("KAPALI");
    expect(durum({ ...DETAY, lines: [{ ...L1, workOrderLinks: [{ workOrder: { status: "PLANNED" } }] }] }).kilit).toBe("URETIMDE");
    expect(durum({ ...DETAY, lines: [{ ...L1, workOrderLinks: [{ workOrder: { status: "CANCELLED" } }] }] }).kilit).toBeNull();
  });
});

describe("§2 PATCH dizisi", () => {
  it("⭐ mevcut kalem kayıtlı alanlarıyla AYNEN gider (zorunlu özellik, varyant, tolerans); iptal kalem de gider", () => {
    const d = durum();
    const b = kalemDizisi(d, kalemSatirlari(d));
    if (!b.ok) throw new Error(b.error);
    expect(b.body.degisti).toBe(false);
    expect(b.body.lines).toEqual([
      { id: "l1", itemId: "u1", colorId: "r1", quantity: 100, unit: "MT", width: 1.6, unitPrice: "3.5", customerItemName: "Müşteri adı", customerColorName: null, cutNote: "not", tolerancePct: "2", recipeId: "v1", pieceLengthM: 50, requiredPropertyIds: ["p1", "p2"] },
      expect.objectContaining({ id: "l2", itemId: "u2", colorId: null, quantity: 40, unitPrice: null, requiredPropertyIds: [] }),
      expect.objectContaining({ id: "l3", quantity: 10 }),
    ]);
  });
  it("miktar/fiyat/renk değişir, yeni kalem yalnız ürün+miktar(+renk/fiyat) ile eklenir", () => {
    const d = durum();
    const f = kalemSatirlari(d);
    const b = kalemDizisi(d, [{ ...f[0]!, miktar: "1.250,5", birimFiyat: "", renkId: null }, f[1]!, { urunId: "u9", urunAdi: "Yeni", renkId: "r2", renkAdi: "Kırmızı", miktar: "7", birimFiyat: "2,25" }]);
    if (!b.ok) throw new Error(b.error);
    expect(b.body.degisti).toBe(true);
    expect(b.body.lines[0]).toMatchObject({ id: "l1", quantity: 1250.5, unitPrice: null, colorId: null, requiredPropertyIds: ["p1", "p2"] });
    expect(b.body.lines[2]).toEqual({ itemId: "u9", colorId: "r2", quantity: 7, unitPrice: "2.25" });
  });
  it("mevcut kalem formdan çıkarılamaz; geçersiz miktar/ürün reddedilir", () => {
    const d = durum();
    const f = kalemSatirlari(d);
    expect(kalemDizisi(d, [f[0]!])).toEqual({ ok: false, error: "Kalem formdan çıkarılamaz; kalemi iptal edin" });
    expect(kalemDizisi(d, [{ ...f[0]!, miktar: "0" }, f[1]!])).toEqual({ ok: false, error: "1. kalem: miktar geçersiz" });
    expect(kalemDizisi(d, [...f, { urunId: null, urunAdi: "", renkId: null, renkAdi: "", miktar: "3", birimFiyat: "" }])).toEqual({ ok: false, error: "3. kalem: ürün seçin" });
  });
  it("belirsiz sonrası fark: taze aktif kalemler formla çoklu küme olarak aynıysa fark yok", () => {
    const d = durum();
    const yeni = { urunId: "u9", urunAdi: "", renkId: null, renkAdi: "", miktar: "7", birimFiyat: "" };
    expect(kalemFarkVar(d, kalemSatirlari(d))).toBe(false);
    expect(kalemFarkVar(d, [...kalemSatirlari(d), yeni])).toBe(true);
    const taze = durum({ ...DETAY, lines: [L1, L2, L3, { ...L2, id: "l4", itemId: "u9", quantity: "7" }] });
    expect(kalemFarkVar(taze, [...kalemSatirlari(d), yeni])).toBe(false);
  });
});

describe("§3 ERP yazıcısı", () => {
  it("kalemleriYaz: PATCH lines + expectedUpdatedAt, yanıt kalem durumu", async () => {
    const f = fakeClient(() => DETAY);
    const r = await createErpYazici(f.c).kalemleriYaz("o1", "2026-11-13T09:00:00.000Z", [{ id: "l1" }]);
    expect(f.calls).toEqual([{ m: "PATCH", path: "/orders/o1", body: { lines: [{ id: "l1" }], expectedUpdatedAt: "2026-11-13T09:00:00.000Z" } }]);
    expect(r.kalemler).toHaveLength(3);
  });
  const onizleme = (o: Record<string, unknown> = {}) => ({ orderNumber: "SIP1", itemName: "Kumaş A", requestedQty: 100, shippedQty: 0, remainingQty: 100, affectedWorkOrders: [], blockers: [], canCancel: true, previewToken: "lc1.x", ...o });
  it("kalem iptali: önizleme yeniden okunur, görülen belirteçle gider", async () => {
    const f = fakeClient((m) => (m === "GET" ? onizleme() : {}));
    const y = createErpYazici(f.c);
    const o = await y.kalemIptalOnizleme("o1", "l1");
    await y.kalemIptal("o1", "l1", o);
    expect(f.calls.map((c) => `${c.m} ${c.path}`)).toEqual(["GET /orders/o1/lines/l1/cancel-preview", "GET /orders/o1/lines/l1/cancel-preview", "POST /orders/o1/lines/l1/cancel"]);
    expect(f.calls[2]!.body).toEqual({ expectedPreviewToken: "lc1.x" });
  });
  it("⭐ arada kaleme İE bağlandıysa (eski fabrika, belirteç yok) cancel ÇAĞRILMAZ, 409 CANCEL_PREVIEW_STALE", async () => {
    let n = 0;
    const f = fakeClient((m) => (m === "GET" ? ((n += 1), onizleme({ previewToken: undefined, affectedWorkOrders: n === 1 ? [] : [{ id: "w1", workOrderNumber: "IE-1", status: "PLANNED" }] })) : {}));
    const y = createErpYazici(f.c);
    const o = await y.kalemIptalOnizleme("o1", "l1");
    expect(o.belirtec).toBeNull();
    await expect(y.kalemIptal("o1", "l1", o)).rejects.toMatchObject({ status: 409, code: "CANCEL_PREVIEW_STALE" });
    expect(f.calls.some((c) => c.m === "POST")).toBe(false);
  });
  const sip = (wos: unknown[]) => ({ orderNumber: "SIP1", affectedWorkOrders: wos, activeShipments: [], canCancel: true, previewToken: "cp1.y" });
  const W1 = { id: "w1", workOrderNumber: "IE-7", status: "IN_PROGRESS", producedRollCount: 2, allowedActions: ["UNLINK_ONLY", "CONVERT_TO_STOCK", "CANCEL_WO"], defaultAction: "CONVERT_TO_STOCK", otherOrderNumbers: [] };
  it("üretimdeki sipariş: İE başına seçilen eylem + belirteç gider", async () => {
    const f = fakeClient((m) => (m === "GET" ? sip([W1]) : {}));
    const y = createErpYazici(f.c);
    const o = await y.siparisIptalOnizleme("o1");
    expect(o.isEmirleri[0]).toMatchObject({ izinli: ["UNLINK_ONLY", "CONVERT_TO_STOCK", "CANCEL_WO"], varsayilan: "CONVERT_TO_STOCK" });
    await y.siparisIptal("o1", o.belirtec, [{ isEmriId: "w1", eylem: "CANCEL_WO" }]);
    expect(f.calls.at(-1)).toEqual({ m: "POST", path: "/orders/o1/cancel", body: { workOrderActions: [{ workOrderId: "w1", action: "CANCEL_WO" }], expectedPreviewToken: "cp1.y" } });
  });
  it("⭐ seçilmemiş ya da izinsiz eylemli İE varsa cancel ÇAĞRILMAZ (sunucu varsayılan uygulardı)", async () => {
    const W2 = { ...W1, id: "w2", status: "PLANNED", allowedActions: ["UNLINK_ONLY"], defaultAction: "UNLINK_ONLY" };
    const f = fakeClient((m) => (m === "GET" ? sip([W1, W2]) : {}));
    const y = createErpYazici(f.c);
    await expect(y.siparisIptal("o1", "cp1.y", [{ isEmriId: "w1", eylem: "UNLINK_ONLY" }])).rejects.toMatchObject({ status: 409, code: "CANCEL_PREVIEW_STALE" });
    await expect(y.siparisIptal("o1", "cp1.y", [{ isEmriId: "w1", eylem: "UNLINK_ONLY" }, { isEmriId: "w2", eylem: "CANCEL_WO" }])).rejects.toMatchObject({ code: "CANCEL_PREVIEW_STALE" });
    await expect(y.siparisIptal("o1", "cp1.y")).rejects.toMatchObject({ code: "SIPARIS_URETIMDE" });
    expect(f.calls.some((c) => c.m === "POST")).toBe(false);
    expect(eylemlerTam([{ id: "w2", izinli: ["UNLINK_ONLY"] }], [{ isEmriId: "w2", eylem: "UNLINK_ONLY" }])).toBe(true);
  });
  it("sunucu reddi aynen fırlar", async () => {
    const f = fakeClient(() => { throw new ApiError(409, "CONFLICT", "İş emri açılmış siparişin kalemleri değiştirilemez."); });
    await expect(createErpYazici(f.c).kalemleriYaz("o1", "v", [])).rejects.toMatchObject({ message: "İş emri açılmış siparişin kalemleri değiştirilemez." });
  });
});

describe("§4 yetenek ve bulut", () => {
  it("bulutta kalem işlemleri kapalı, yazıcı ağa gitmez", async () => {
    expect(islemVar("siparis.kalem", ["bulut:siparis:yaz", "bulut:siparis:oku"], BULUT_YETENEK)).toBe(false);
    expect(islemVar("siparis.kalem-iptal", ["bulut:siparis:yaz"], BULUT_YETENEK)).toBe(false);
    const api = {} as never;
    const y = createBulutYazici(api);
    await expect(y.kalemleriOku("o1")).rejects.toBeTruthy();
    await expect(y.kalemIptal("o1", "l1", {} as never)).rejects.toBeTruthy();
  });
  it("ERP: order:write + order:read ve kümeler gerekir", () => {
    const y = erpYetenek(["siparis", "urun"], ["order:write", "order:read"]);
    expect(islemVar("siparis.kalem", [], y)).toBe(true);
    expect(islemVar("siparis.kalem-iptal", [], y)).toBe(true);
    expect(islemVar("siparis.kalem", [], erpYetenek(["siparis"], ["order:write", "order:read"]))).toBe(false);
    expect(islemVar("siparis.kalem", [], erpYetenek(["siparis", "urun"], ["order:read", "mobile:siparis"]))).toBe(false);
  });
});
