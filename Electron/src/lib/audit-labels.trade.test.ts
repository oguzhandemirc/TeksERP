// =============================================================================
// BEKÇİ — Denetim sözlüklerinin TAMLIĞI (ticaret + fabrika kaçakları)
// =============================================================================
// ⭐ NEDEN VAR: `tableLabel`/`fieldLabel`/`enumValueLabel` bilinmeyeni HAM
//    döndürür. Bu bilinçli bir seçim (yeni tablo sessizce kaybolmasın) ama aynı
//    zamanda bir SESSİZ BOZULMA yoludur: Aktivite akışında "Eda CARI_ACCOUNT
//    kaydını düzenledi", denetim diff'inde "dueDate: 2026-09-01", "Yön: IN".
//    Hiçbir hata çıkmaz; yalnız denetim izi okunamaz olur ve okunamayan iz
//    denetim aracı değildir.
// ⭐ ANAHTAR KÜMELERİ DENETLENİR, sayı değil: aşağıdaki listeler backend'in
//    GERÇEK `AuditService.log({ tableName })` çağrı yerlerinden ve Prisma
//    enum'larından çıkarıldı (2026-08-15 taraması). Yeni bir ticaret tablosu ya
//    da enum değeri eklendiğinde bu liste de büyümeli — büyümezse bekçi kırmızı
//    vermez ama listeyi güncelleyen kişi eksik satırı görür.
// ⭐ İKİ HARİTA AYRI SORULAR SORAR: `WAREHOUSE` tablo olarak "Depo", RollStatus
//    değeri olarak "Depoda". Aynı anahtar iki haritada FARKLI olmak zorunda;
//    "zaten var" diye atlanırsa Aktivite akışı depo kaydını "Depoda" diye anar.
// ⭐ KÖRLÜK ZEMİNİ: haritalar bir refactor'da boşalırsa "ihlal yok" ile "hiçbir
//    şeye bakılmadı" aynı yeşile çıkar — alt sınırlar bunu ayırır.
// =============================================================================
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  TABLE_LABELS,
  FIELD_LABELS,
  ENUM_LABELS,
  tableLabel,
  fieldLabel,
  enumValueLabel,
  formatAuditValue,
} from "./audit-labels";

/** Backend `AuditService.log({ tableName: … })` çağrılarındaki ticaret tabloları. */
const TRADE_TABLES = [
  "INVOICE",
  "PAYMENT",
  "PAYMENT_ALLOCATION",
  "CHEQUE",
  "CHEQUE_DELIVERY_NOTE",
  "CARI_ACCOUNT",
  "CARI_PERIOD_CLOSE",
  "CASH_TRANSACTION",
  "CASH_PERIOD_CLOSE",
  "CASH_BOX",
  "BANK_ACCOUNT",
  "EXCHANGE_RATE",
  "RECONCILIATION_LETTER",
  "GOODS_RECEIPT",
  "PURCHASE_ORDER",
  "ITEM_PRICE",
  "STOCK_COUNT",
  "STOCK_COUNT_LINE",
  "WAREHOUSE",
  "WAREHOUSE_TRANSFER",
  "YARN_MOVEMENT",
] as const;

/** Aynı taramada etiketsiz çıkan fabrika tabloları. */
const FACTORY_TABLES = [
  "BATCH",
  "DIRECT_SHIPMENT",
  "ROLL_QTY_ADJUST",
  "KURSUN_BYPASS_ASSIGNMENT",
] as const;

/** Ticaret kayıtlarının oldData/newData diff'inde görünen alanlar. */
const TRADE_FIELDS = [
  "docNo",
  "dueDate",
  "issueDate",
  "receiptNo",
  "transferNo",
  "countNo",
  "orderNo",
  "balanceKg",
  "qtyKg",
  "cariId",
  "supplierId",
  "warehouseId",
  "exchangeRate",
  "allocatedTotal",
  "vatRate",
  "netAmount",
] as const;

/**
 * Prisma ticaret enum'larının TAM değer kümeleri (schema.prisma, 2026-08-15).
 * Bir enum'a yeni üye eklenirse buraya da eklenir; eksik üye = ham İngilizce.
 */
const TRADE_ENUMS: Record<string, readonly string[]> = {
  InvoiceStatus: ["DRAFT", "CONFIRMED", "CANCELLED"],
  InvoiceType: ["SALES", "PURCHASE", "SALES_RETURN", "PURCHASE_RETURN"],
  PaymentDirection: ["IN", "OUT"],
  PaymentMethod: ["CASH", "BANK_TRANSFER", "CREDIT_CARD", "OTHER"],
  PaymentStatus: ["ACTIVE", "CANCELLED"],
  CashTxnKind: ["EXPENSE", "INCOME", "TRANSFER_OUT", "TRANSFER_IN", "OPENING"],
  ChequeKind: ["RECEIVED", "ISSUED"],
  ChequeStatus: [
    "PORTFOLIO",
    "AT_BANK",
    "ENDORSED",
    "COLLECTED",
    "BOUNCED",
    "RETURNED",
    "ISSUED",
    "PAID",
    "CANCELLED",
  ],
  PurchaseOrderStatus: ["OPEN", "PARTIAL", "CLOSED", "CANCELLED"],
  StockCountStatus: ["DRAFT", "COMPLETED", "CANCELLED"],
  YarnMovementKind: ["IN", "OUT", "ADJUST_IN", "ADJUST_OUT"],
  CariKind: ["CUSTOMER", "SUBCONTRACTOR"],
  GoodsReceiptStatus: ["ACTIVE", "CANCELLED"],
  WarehouseTransferStatus: ["COMPLETED", "CANCELLED"],
  // ⚠️ 2026-08-15'te EKLENDİ ve eklendiği gün bir açık yakaladı: `PriceKind`
  // TRADE_ENUMS'ta yoktu, dolayısıyla `PURCHASE`ın `ITEM_PRICE.kind` bağlamında
  // "Alış Faturası" bastığı ve kardeşi `SALE`ın haritada HİÇ olmadığı
  // görülmüyordu (körlük zemini bu sınıfı yakalayamaz — anahtarı olmayan bir
  // aile hiç sorgulanmaz). Yeni bir enum ailesi eklerken buraya da yaz.
  PriceKind: ["PURCHASE", "SALE"],
};

/**
 * ⚠️ ALAN-KAPSAMLI BAĞLAM — aynı DEĞER iki enum'da ÇELİŞİYORSA.
 * Anahtar `TABLO.alan`; beklenen metin o bağlamda GÖRÜNMESİ gereken etiket.
 * Bunlar `ENUM_LABELS`in global cevabından FARKLI olmak zorundadır — aynıysa
 * override gereksizdir ve iki sözlüğü drift ettirir.
 */
const CONTEXT_LABELS: ReadonlyArray<{ table: string; field: string; value: string; label: string }> = [
  // PriceKind.PURCHASE — bir FİYAT KARTI türü; "fatura" kelimesi buraya girmez.
  // (Kardeşi `SALE` override ALMAZ: yalnız PriceKind'da geçtiği için global
  // "Satış" etiketi zaten doğrudur — aşağıdaki "override farklı olmalı" kuralı.)
  { table: "ITEM_PRICE", field: "kind", value: "PURCHASE", label: "Alış" },
  // ChequeStatus.ISSUED — çekin DURUMU; ChequeKind.ISSUED ise TÜRÜ. İkisi AYNI
  // tabloda yaşar, yani tablo-kapsamlı bir katman yetmez (alan da gerekir).
  { table: "CHEQUE", field: "status", value: "ISSUED", label: "Verildi" },
];

const isTurkishLabel = (v: string) => v.length > 0 && v !== v.toUpperCase();

describe("audit sözlükleri — körlük zemini", () => {
  // Haritalar bir refactor'da boşalırsa aşağıdaki kontroller vakumen geçerdi.
  it("haritalar dolu (alt sınırlar)", () => {
    expect(Object.keys(TABLE_LABELS).length).toBeGreaterThan(80);
    expect(Object.keys(FIELD_LABELS).length).toBeGreaterThan(100);
    expect(Object.keys(ENUM_LABELS).length).toBeGreaterThan(120);
  });
});

describe("TABLE_LABELS — ticaret + kaçak fabrika tabloları", () => {
  it.each([...TRADE_TABLES, ...FACTORY_TABLES])("%s Türkçe etiketli", (t) => {
    const label = TABLE_LABELS[t];
    expect(label, `${t} TABLE_LABELS'te yok — Aktivite akışı ham basar`).toBeTruthy();
    // Ham enum'un kendisi etiket olarak sayılmaz (kopyala-yapıştır kazası).
    expect(isTurkishLabel(label as string)).toBe(true);
    expect(tableLabel(t)).toBe(label);
  });

  it("`WAREHOUSE` iki haritada FARKLI anlam taşır (tablo ≠ RollStatus)", () => {
    expect(TABLE_LABELS.WAREHOUSE).toBe("Depo");
    expect(ENUM_LABELS.WAREHOUSE).toBe("Depoda");
  });
});

describe("FIELD_LABELS — ticaret alanları", () => {
  it.each(TRADE_FIELDS)("%s Türkçe etiketli", (f) => {
    const label = FIELD_LABELS[f];
    expect(label, `${f} FIELD_LABELS'te yok — diff satır başlığı ham kalır`).toBeTruthy();
    expect(fieldLabel(f)).toBe(label);
  });
});

describe("ENUM_LABELS — ticaret enum'larının TAM değer kümeleri", () => {
  for (const [enumName, values] of Object.entries(TRADE_ENUMS)) {
    it(`${enumName}: tüm üyeler etiketli`, () => {
      const missing = values.filter((v) => !ENUM_LABELS[v]);
      expect(missing, `${enumName} eksik: ${missing.join(", ")}`).toEqual([]);
      for (const v of values) expect(enumValueLabel(v)).toBe(ENUM_LABELS[v]);
    });
  }

  it("⭐ PriceKind ham İngilizce KALMAZ (ITEM_PRICE denetim diff'i)", () => {
    // Kardeş değer `SALE` haritada hiç yoktu → aynı alanın iki değeri, biri
    // yanlış Türkçe ("Alış Faturası"), diğeri ham İngilizce ("SALE").
    expect(enumValueLabel("SALE")).not.toBe("SALE");
  });

  it("IN/OUT artık bağlamsız ham değer DEĞİL (denetimdeki en kötü satır)", () => {
    expect(ENUM_LABELS.IN).toBe("Giriş");
    expect(ENUM_LABELS.OUT).toBe("Çıkış");
    // `formatAuditValue` da aynı sözlükten geçmeli — AuditDataBlock onu çağırıyor.
    expect(formatAuditValue("IN")).toBe("Giriş");
    expect(formatAuditValue("OUT")).toBe("Çıkış");
  });

  it("iki enum'un PAYLAŞTIĞI değerler tek etikette birleşir (çelişki yok)", () => {
    // IN/OUT: PaymentDirection ∩ YarnMovementKind → yön-nötr etiket şart.
    for (const shared of ["IN", "OUT", "ISSUED", "DRAFT", "CANCELLED", "COMPLETED", "ACTIVE"]) {
      expect(ENUM_LABELS[shared], `${shared} etiketsiz`).toBeTruthy();
    }
  });

  it("bilinmeyen değer HAM döner (sözleşme korunur — sessizce boş basmaz)", () => {
    expect(enumValueLabel("YENI_BIR_DEGER")).toBe("YENI_BIR_DEGER");
    expect(tableLabel("YENI_TABLO")).toBe("YENI_TABLO");
    expect(fieldLabel("yeniAlan")).toBe("yeniAlan");
  });
});

// =============================================================================
// ⭐⭐ ALAN-KAPSAMLI KATMAN — GERÇEK ÇELİŞKİLER
// =============================================================================
// Dosyanın kendi uyarısı ("iki değer farklı enum'larda ÇELİŞİRSE alan-kapsamlı
// ikinci katman gerekir") 2026-08-15'te GERÇEKLEŞTİ. Değer-kapsamlı harita tek
// başına şunu üretiyordu:
//   • bir ALIŞ FİYATI değişikliğinin diff'i → "Tür: Alış Faturası" (fiyat
//     kaydı fatura değildir)
//   • aynı ekranda bir SATIŞ fiyatı → "Tür: SALE" (ham İngilizce)
//   • çekin DURUMU → "Verdiğimiz (kendi çekimiz)" (çek ekranı "Verildi" diyor)
describe("alan-kapsamlı enum bağlamı (TABLO.alan)", () => {
  it.each(CONTEXT_LABELS)(
    "$table.$field → $value = $label",
    ({ table, field, value, label }) => {
      expect(enumValueLabel(value, { tableName: table, field })).toBe(label);
      // AuditDataBlock `formatAuditValue` çağırıyor — o da bağlamı taşımalı.
      expect(formatAuditValue(value, { tableName: table, field })).toBe(label);
    },
  );

  it("⭐ override GERÇEKTEN farklı bir cevap veriyor (gereksiz katman değil)", () => {
    for (const { table, field, value } of CONTEXT_LABELS) {
      expect(
        enumValueLabel(value, { tableName: table, field }),
        `${table}.${field}.${value} override'ı global etiketle AYNI — ya siliniyor ya global düzeltiliyor`,
      ).not.toBe(ENUM_LABELS[value]);
    }
  });

  it("bağlam YOKSA global sözlük kullanılır (mevcut çağrı yerleri bozulmaz)", () => {
    expect(enumValueLabel("PURCHASE")).toBe(ENUM_LABELS.PURCHASE);
    expect(formatAuditValue("PURCHASE")).toBe(ENUM_LABELS.PURCHASE);
    // Bağlam var ama override YOK → yine global.
    expect(enumValueLabel("PURCHASE", { tableName: "INVOICE", field: "type" })).toBe(
      ENUM_LABELS.PURCHASE,
    );
  });

  it("⚠️ CHEQUE.kind override ALMAZ — global etiket orada zaten doğru", () => {
    expect(enumValueLabel("ISSUED", { tableName: "CHEQUE", field: "kind" })).toBe(
      "Verdiğimiz (kendi çekimiz)",
    );
  });

  // ⚠️ KABLO DA KİLİTLENİR: katman doğru olsa bile `tableName` ekrandan
  // geçirilmezse override HİÇ devreye girmez ve hata sessizce geri gelir
  // (`tableName` opsiyonel olduğu için derleme de uyarmaz).
  it("⭐ Aktivite detayı `tableName` bağlamını AuditDataBlock'a geçiriyor", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../pages/System/Activity/ActivityDetailSheet.tsx"),
      "utf8",
    );
    expect(src.length).toBeGreaterThan(1000); // körlük zemini
    const blocks = src.match(/<AuditDataBlock[\s\S]*?\/>/g) ?? [];
    expect(blocks.length).toBe(2); // Önceki Değer + Yeni Değer
    for (const b of blocks) expect(b).toContain("tableName=");
  });
});
