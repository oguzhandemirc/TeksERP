import { buildCustomer, buildOrder, toDecimal, trDateToIso } from "../src/lib/forms";
import { buildReportParams, catalogEntries, extraParamNames, requestable } from "../src/lib/reports";

const U = "11111111-1111-4111-8111-111111111111";

describe("form gövdeleri", () => {
  it("TR sayı girişi ondalık diziye çevrilir", () => {
    expect(toDecimal("1.250,5")).toBe("1250.5");
    expect(toDecimal("12")).toBe("12");
    expect(toDecimal("0012.30")).toBe("12.30");
    expect(toDecimal("12,3,4")).toBeNull();
    expect(toDecimal("")).toBeNull();
  });
  it("tarih GG.AA.YYYY → ISO; geçersiz gün reddedilir", () => {
    expect(trDateToIso("29.09.2026")).toBe("2026-09-29");
    expect(trDateToIso("")).toBeUndefined();
    expect(trDateToIso("31.02.2026")).toBeNull();
  });
  it("sipariş: cari, kalem, miktar zorunlu; isteğe bağlı alan boşsa gövdede yok", () => {
    const base = { cariKartId: U, doviz: "TRY", termin: "", aciklama: "", kalemler: [{ urunId: U, renkId: null, miktar: "10,5", birimFiyat: "" }] };
    expect(buildOrder(base)).toEqual({ ok: true, body: { cariKartId: U, doviz: "TRY", kalemler: [{ urunId: U, miktar: "10.5" }] } });
    expect(buildOrder({ ...base, cariKartId: null })).toEqual({ ok: false, error: "Cari seçin" });
    expect(buildOrder({ ...base, kalemler: [] }).ok).toBe(false);
    expect(buildOrder({ ...base, kalemler: [{ urunId: U, renkId: null, miktar: "0", birimFiyat: "" }] }).ok).toBe(false);
    expect(buildOrder({ ...base, termin: "1.1.2027" })).toMatchObject({ ok: true, body: { termin: "2027-01-01" } });
  });
  it("cari: ad ve en az bir rol zorunlu", () => {
    const base = { ad: " Örnek ", musteri: true, tedarikci: false, il: "", vergiNo: "", telefon: "", eposta: "" };
    expect(buildCustomer(base)).toEqual({ ok: true, body: { ad: "Örnek", roller: { musteri: true, tedarikci: false } } });
    expect(buildCustomer({ ...base, musteri: false }).ok).toBe(false);
    expect(buildCustomer({ ...base, vergiNo: "123" }).ok).toBe(false);
  });
});

describe("rapor isteği", () => {
  it("izin: rapor:oku + aile izni; bulutta olmayan ve bilinmeyen aile RED", () => {
    const p = ["bulut:rapor:oku", "bulut:siparis:oku"];
    expect(requestable("sales/order-intake", p)).toBe(true);
    expect(requestable("finance/aging", p)).toBe(false);
    expect(requestable("audit/user-activity", [...p, "bulut:hesap:yonet"])).toBe(false);
    expect(requestable("bilinmeyen/x", p)).toBe(false);
    expect(requestable("sales/order-intake", ["bulut:siparis:oku"])).toBe(false);
  });
  it("aralık dateFrom/dateTo olur; ters aralık reddedilir", () => {
    expect(buildReportParams("01.09.2026", "29.09.2026", { cariId: " x " })).toEqual({ ok: true, params: { dateFrom: "2026-09-01", dateTo: "2026-09-29", cariId: "x" } });
    expect(buildReportParams("", "", {})).toEqual({ ok: true, params: {} });
    expect(buildReportParams("29.09.2026", "01.09.2026", {}).ok).toBe(false);
  });
  it("katalog ve ek parametre adları", () => {
    expect(catalogEntries({ raporlar: [{ anahtar: "a/b", baslik: "B" }, { x: 1 }] })).toHaveLength(1);
    expect(catalogEntries(null)).toEqual([]);
    expect(extraParamNames({ dateFrom: {}, dateTo: {}, cariId: {} })).toEqual(["cariId"]);
    expect(extraParamNames([{ ad: "depo" }, "dateFrom"])).toEqual(["depo"]);
  });
});
