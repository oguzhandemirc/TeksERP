// =============================================================================
// BEKÇİ — fatura formunun saf katmanı (taslak düzenleme + para birimi önerisi)
// =============================================================================
// ⭐ SAHA VAKASI SENARYO OLARAK KİLİTLİ: 0 fiyatlı otomatik taslak → düzenle →
//    fiyat gir → PATCH gövdesi fiyatı TAŞIR. Bu zincir kırılırsa kullanıcı
//    faturayı ne onaylayabilir ne düzeltebilir (yalnız silebilir) — yani
//    ekranın kendi açıklamasının ("Taslak serbestçe düzenlenir") yalan olduğu
//    duruma geri dönülür.
// ⭐ 0 FİYATLI SATIR ELENMEZ: düzeltilmek istenen vakanın ta kendisi odur.
// ⭐ VADE GÜNÜ UTC PARÇALARINDAN okunur — yerel çevrim, hiç dokunulmamış bir
//    taslağı kaydetmenin vadeyi bir gün öne çekmesi demekti.
// ⭐ PARA BİRİMİ ÖNERİSİ KAYNAK BELGEYİ EZMEZ (sevkiyat USD ↔ cari kartı TRY).
// =============================================================================
import { describe, it, expect } from "vitest";
import {
  DEFAULT_INVOICE_CURRENCY,
  buildUpdateBody,
  canSubmitInvoiceForm,
  initialAppliedCurrency,
  initialFromDetail,
  isInvoiceEditable,
  payloadLines,
  shouldApplyCurrencySuggestion,
  ymdFromIso,
  type InvoiceFormLine,
} from "./invoiceForm";
import type { InvoiceDetail } from "./service";

const line = (over: Partial<InvoiceFormLine> = {}): InvoiceFormLine => ({
  key: "k1",
  itemId: null,
  description: "Kumaş",
  qty: 10,
  unit: "m",
  unitPrice: 0,
  discountRate: 0,
  vatRate: 20,
  withholdingRate: 0,
  ...over,
});

/** Sevkten otomatik doğan 0 fiyatlı taslağın detay yanıtı (saha vakası). */
const DRAFT: InvoiceDetail = {
  id: "inv-1",
  docNo: "FTR1508260001",
  type: "SALES",
  status: "DRAFT",
  currency: "USD",
  exchangeRate: 34.5,
  issueDate: "2026-08-15T06:00:00.000Z",
  dueDate: "2026-09-14T00:00:00.000Z",
  externalNo: null,
  grandTotal: 0,
  grandTotalTry: 0,
  paidTotal: 0,
  confirmedAt: null,
  cancelledAt: null,
  shipment: { id: "sh-1", shipmentNo: "SVK1508260001" },
  directShipment: null,
  subcontractorReceipt: null,
  returnGroupId: null,
  notes: "Sevkiyattan otomatik oluşturuldu",
  subtotal: 0,
  discountTotal: 0,
  vatTotal: 0,
  withholdingTotal: 0,
  cancelReason: null,
  createdAt: "2026-08-15T06:00:00.000Z",
  updatedAt: "2026-08-15T06:00:00.000Z",
  cari: {
    id: "cari-1",
    kind: "CUSTOMER",
    taxOffice: null,
    customer: { id: "cus-1", code: "MUS1508260001", name: "ARZU TEKSTİL", taxNumber: null },
    subcontractor: null,
  },
  goodsReceipt: null,
  lines: [
    {
      id: "ln-1",
      lineNo: 1,
      description: "PATOS · SİYAH",
      qty: 612.5,
      unit: "m",
      unitPrice: 0,
      discountRate: 0,
      vatRate: 20,
      withholdingRate: 0,
      lineTotal: 0,
      vatAmount: 0,
      item: { id: "itm-1", code: "KMS-1", name: "PATOS" },
    },
  ],
};

describe("initialFromDetail — kayıtlı taslaktan form", () => {
  it("cari / tür / para birimi / satırlar birebir taşınır", () => {
    const init = initialFromDetail(DRAFT);
    expect(init.type).toBe("SALES");
    expect(init.party).toBe("CUSTOMER");
    expect(init.customerId).toBe("cus-1");
    expect(init.subcontractorId).toBeNull();
    expect(init.currency).toBe("USD");
    expect(init.lines).toHaveLength(1);
    expect(init.lines[0]!.description).toBe("PATOS · SİYAH");
    expect(init.lines[0]!.qty).toBe(612.5);
    expect(init.lines[0]!.itemId).toBe("itm-1");
  });

  it("fason faturasında taraf SUBCONTRACTOR çözülür", () => {
    const init = initialFromDetail({
      ...DRAFT,
      cari: {
        id: "cari-2",
        kind: "SUBCONTRACTOR",
        taxOffice: null,
        customer: null,
        subcontractor: { id: "sub-1", code: "FSN-1", name: "BOYAHANE", taxNumber: null },
      },
    });
    expect(init.party).toBe("SUBCONTRACTOR");
    expect(init.subcontractorId).toBe("sub-1");
    expect(init.customerId).toBeNull();
  });

  it("⭐ satır anahtarı DB satırının id'sidir (odak kaybı olmasın)", () => {
    expect(initialFromDetail(DRAFT).lines[0]!.key).toBe("ln-1");
  });

  it("⭐ kayıtlı faturada para birimi KAYNAKTAN sayılır (öneri ezemez)", () => {
    expect(initialFromDetail(DRAFT).currencyFromSource).toBe(true);
  });

  it("vadesiz faturada alan boş kalır — uydurma vade yok", () => {
    expect(initialFromDetail({ ...DRAFT, dueDate: null }).dueDate).toBe("");
  });
});

describe("⭐ ymdFromIso — takvim günü UTC parçalarından", () => {
  it("UTC gece yarısı damgası aynı güne çözülür", () => {
    expect(ymdFromIso("2026-09-14T00:00:00.000Z")).toBe("2026-09-14");
  });

  it("negatif ofsetli makinede de gün GERİ kaymaz", () => {
    // Yerel getiricilerle (getDate) UTC-05:00'te bu 13 Eylül'e düşerdi.
    const v = ymdFromIso("2026-09-14T00:00:00.000Z");
    expect(v.endsWith("-14")).toBe(true);
  });

  it("boş / bozuk değer boş string", () => {
    expect(ymdFromIso(null)).toBe("");
    expect(ymdFromIso("")).toBe("");
    expect(ymdFromIso("saçma")).toBe("");
  });
});

describe("payloadLines — hangi satır gider", () => {
  it("⭐ 0 FİYATLI satır GİDER (düzeltilecek vakanın ta kendisi)", () => {
    expect(payloadLines([line({ unitPrice: 0 })])).toHaveLength(1);
  });

  it("açıklamasız / miktarsız satır elenir (formun boş artığı)", () => {
    expect(payloadLines([line({ description: "   " }), line({ key: "k2", qty: 0 })])).toHaveLength(0);
  });

  it("açıklama kırpılır, kalem bağı korunur", () => {
    const [l] = payloadLines([line({ description: "  Nakliye  ", itemId: "itm-9" })]);
    expect(l!.description).toBe("Nakliye");
    expect(l!.itemId).toBe("itm-9");
  });
});

describe("buildUpdateBody — PATCH gövdesi", () => {
  it("⭐ SAHA SENARYOSU: 0 fiyatlı taslağa fiyat girilir ve gövdeye YANSIR", () => {
    const init = initialFromDetail(DRAFT);
    expect(init.lines[0]!.unitPrice).toBe(0);

    // Kullanıcı fiyatı yazar (formun tek yaptığı bu).
    const edited = init.lines.map((l) => ({ ...l, unitPrice: 4.25 }));
    const body = buildUpdateBody({ lines: edited, dueDate: init.dueDate, externalNo: "", notes: init.notes });

    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]!.unitPrice).toBe(4.25);
    expect(body.lines[0]!.qty).toBe(612.5);
    // Onayın reddettiği koşul (0 fiyat) artık ortadan kalktı.
    expect(body.lines.every((l) => Number(l.unitPrice) > 0)).toBe(true);
  });

  it("⭐ boş metin null gider ('' değil — 'temizle' ile 'boş ama dolu' ayrı)", () => {
    const body = buildUpdateBody({ lines: [line()], dueDate: "", externalNo: "   ", notes: "" });
    expect(body.dueDate).toBeNull();
    expect(body.externalNo).toBeNull();
    expect(body.notes).toBeNull();
  });

  it("dolu alanlar aynen gider", () => {
    const body = buildUpdateBody({
      lines: [line()],
      dueDate: "2026-09-14",
      externalNo: " A-12 ",
      notes: " kontrol edildi ",
    });
    expect(body.dueDate).toBe("2026-09-14");
    expect(body.externalNo).toBe("A-12");
    expect(body.notes).toBe("kontrol edildi");
  });

  it("⭐ gövde YALNIZ backend'in kabul ettiği anahtarları taşır (.strict())", () => {
    const body = buildUpdateBody({ lines: [line()], dueDate: "", externalNo: "", notes: "" });
    expect(Object.keys(body).sort()).toEqual(["dueDate", "externalNo", "lines", "notes"]);
  });
});

describe("canSubmitInvoiceForm", () => {
  it("cari seçilmeden kaydedilemez", () => {
    expect(
      canSubmitInvoiceForm({ party: "CUSTOMER", customerId: null, subcontractorId: "s", lines: [line()] }),
    ).toBe(false);
  });

  it("gönderilecek satır kalmayınca kaydedilemez", () => {
    expect(
      canSubmitInvoiceForm({ party: "CUSTOMER", customerId: "c", subcontractorId: null, lines: [line({ qty: 0 })] }),
    ).toBe(false);
  });

  it("⭐ 0 fiyatlı tek satırla kaydedilebilir (taslak ara durumu meşru)", () => {
    expect(
      canSubmitInvoiceForm({ party: "CUSTOMER", customerId: "c", subcontractorId: null, lines: [line()] }),
    ).toBe(true);
  });
});

describe("isInvoiceEditable", () => {
  it("⭐ yalnız TASLAK — onaylı fatura storno ile düzeltilir", () => {
    expect(isInvoiceEditable("DRAFT")).toBe(true);
    expect(isInvoiceEditable("CONFIRMED")).toBe(false);
    expect(isInvoiceEditable("CANCELLED")).toBe(false);
  });
});

describe("para birimi önerisi (②)", () => {
  it("dokunulmamış alana cari kartının para birimi yazılır", () => {
    const lastApplied = initialAppliedCurrency({ currency: DEFAULT_INVOICE_CURRENCY, currencyFromSource: false });
    expect(lastApplied).toBe("TRY");
    expect(shouldApplyCurrencySuggestion({ current: "TRY", lastApplied, resolved: "USD" })).toBe(true);
  });

  it("⭐ kullanıcının SEÇTİĞİ para birimi ezilmez", () => {
    expect(shouldApplyCurrencySuggestion({ current: "EUR", lastApplied: "TRY", resolved: "USD" })).toBe(false);
  });

  it("cari değişince BİZİM yazdığımız değer tazelenir", () => {
    expect(shouldApplyCurrencySuggestion({ current: "USD", lastApplied: "USD", resolved: "EUR" })).toBe(true);
  });

  it("⭐ KAYNAK BELGE dayattıysa öneri HİÇ yazmaz (USD sevkiyat ↔ TRY cari kartı)", () => {
    const lastApplied = initialAppliedCurrency({ currency: "USD", currencyFromSource: true });
    expect(lastApplied).toBeNull();
    expect(shouldApplyCurrencySuggestion({ current: "USD", lastApplied, resolved: "TRY" })).toBe(false);
  });

  it("cari kartı para birimi çözülemezse alana dokunulmaz", () => {
    expect(shouldApplyCurrencySuggestion({ current: "TRY", lastApplied: "TRY", resolved: null })).toBe(false);
  });
});
