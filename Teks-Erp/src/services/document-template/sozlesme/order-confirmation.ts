// =============================================================================
// ORDER_CONFIRMATION (Sipariş Teyidi) veri sözleşmesi — Seyitoğlu 3. bölüm L1
// =============================================================================
// Müşteriye gider (`hedef: musteri`). Sevk edilen miktar, reçete, kesim notu, iç not payload'da
// YOKTUR; `ic` sınıflı alan da açılmaz (opt-in listesi boş kalır, teklif emsali). Ürün/renk hücre
// metni, koşul satırları ve genel toplam metni renderer'ın AYNI yardımcılarından — şablon hesap
// yapmaz. Fiyatsız teyit kolon gizlemedir (`columns.kalemler.hidden`), alan silinmez.
// =============================================================================

import { docTitle } from "../../document-render/doc-style";
import { docNum } from "../../document-render/fmt-num";
import { unitText } from "../../document-render/commercial-doc";
import {
  ORDER_CONFIRMATION_SIGNATURES,
  ORDER_CONFIRMATION_TITLE,
  orderConfirmationColumns,
  orderGrandTotalText,
  orderLineColorText,
  orderLineItemText,
  orderTermLines,
  type OrderConfirmationDoc,
  type OrderConfirmationDocLine,
} from "../../document-render/order-confirmation.html";
import type { PrintedDocSnapshot } from "../../printed-document.service";
import {
  COMPANY_FIELDS,
  DOC_STATUS_FIELDS,
  LETTERHEAD_EXTRA_TABLE,
  PRINT_FIELDS,
  asObject,
  companyRoot,
  docStatus,
  fillFields,
  letterheadExtraRows,
  printRoot,
  rootFields,
} from "./ortak";
import { longText, sampleDoc, sampleEnvelope, sampleSeriesCode } from "./senaryolar";
import { baseConfigSchema, normalizeBase, plainJson, resolveColumns, sanitizeRawConfig, type BaseDocConfig } from "./subcontractor-common";
import type { BuildExtras, ContextObject, ContextValue, DocumentContract, FieldDef, Scenario, TableDef, TemplateContext } from "./tipler";

type Row = Record<string, unknown>;

const SECTIONS = {
  taxNo: true, customerCode: true, branch: true, orderNo: true, date: true, terms: true, lineTable: true, grandTotal: true,
} as const;

const LINE_TABLE: TableDef = {
  anahtar: "kalemler",
  etiket: "Sipariş kalemleri",
  kolonlar: [
    { yol: "sira", etiket: "Sıra", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1, hiza: "c", kaynakKolon: "seq" },
    { yol: "urun", etiket: "Ürün (kod — ad, müşteri adıyla)", tur: "metin", sinif: "musteri", ornek: "KM-0101 — Pamuklu Astar (Astar 150)", hiza: "l", kaynakKolon: "description" },
    { yol: "urun_kodu", etiket: "Ürün kodu", tur: "metin", sinif: "musteri", ornek: "KM-0101", hiza: "l" },
    { yol: "urun_adi", etiket: "Ürün adı", tur: "metin", sinif: "musteri", ornek: "Pamuklu Astar", hiza: "l" },
    { yol: "musteri_urun_adi", etiket: "Müşterinin ürün adı", tur: "metin", sinif: "musteri", ornek: "Astar 150", hiza: "l" },
    { yol: "renk", etiket: "Renk (müşteri adıyla)", tur: "metin", sinif: "musteri", ornek: "Antrasit (Füme)", hiza: "l", kaynakKolon: "color" },
    { yol: "renk_adi", etiket: "Renk adı", tur: "metin", sinif: "musteri", ornek: "Antrasit", hiza: "l" },
    { yol: "musteri_renk_adi", etiket: "Müşterinin renk adı", tur: "metin", sinif: "musteri", ornek: "Füme", hiza: "l" },
    { yol: "en", etiket: "En", tur: "sayi", ondalik: 0, birim: "cm", sinif: "musteri", ornek: 150, hiza: "c", kaynakKolon: "width" },
    { yol: "miktar", etiket: "Miktar", tur: "sayi", ondalik: 2, sinif: "musteri", ornek: 1200, hiza: "r", kaynakKolon: "qty", toplam: "miktar" },
    { yol: "birim", etiket: "Birim", tur: "metin", sinif: "musteri", ornek: "m", hiza: "c", kaynakKolon: "unit" },
    { yol: "tolerans", etiket: "Tolerans (%)", tur: "sayi", ondalik: 2, sinif: "musteri", ornek: 5, hiza: "r", kaynakKolon: "tolerance" },
    { yol: "birim_fiyat", etiket: "Birim fiyat (sipariş dövizi; fiyatsız satırda boş)", tur: "sayi", ondalik: 2, sinif: "musteri", ornek: 2.85, hiza: "r", kaynakKolon: "unitPrice" },
    { yol: "tutar", etiket: "Tutar (sipariş dövizi; fiyatsız satırda boş)", tur: "sayi", ondalik: 2, sinif: "musteri", ornek: 3420, hiza: "r", kaynakKolon: "amount", toplam: "tutar" },
  ],
};

const TERM_TABLE: TableDef = {
  anahtar: "kosullar",
  etiket: "Sipariş koşulları",
  kolonlar: [
    { yol: "etiket", etiket: "Koşul", tur: "metin", sinif: "musteri", ornek: "Termin", hiza: "l" },
    { yol: "deger", etiket: "Değer", tur: "metin", sinif: "musteri", ornek: "15.07.2026", hiza: "l" },
  ],
};

const ROOT_FIELDS: FieldDef[] = [
  { yol: "belge.no", etiket: "Belge no (sipariş no)", tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("order", 1) },
  { yol: "belge.tur", etiket: "Belge türü", tur: "metin", sinif: "musteri", ornek: "ORDER_CONFIRMATION" },
  { yol: "belge.baslik", etiket: "Belge başlığı", tur: "metin", sinif: "musteri", ornek: ORDER_CONFIRMATION_TITLE },
  { yol: "belge.tarih", etiket: "Sipariş tarihi", tur: "tarih", sinif: "musteri", ornek: "2026-09-25T09:15:00.000Z" },
  ...DOC_STATUS_FIELDS,
  { yol: "belge.siparis_no", etiket: "Sipariş no", tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("order", 1) },
  { yol: "belge.termin", etiket: "Termin (yoksa boş)", tur: "takvim", sinif: "musteri", ornek: "2026-10-25T00:00:00.000Z" },
  { yol: "belge.doviz", etiket: "Döviz", tur: "metin", sinif: "musteri", ornek: "EUR" },
  { yol: "karsi_taraf.ad", etiket: "Müşteri adı", tur: "metin", sinif: "musteri", ornek: "Örnek Tekstil A.Ş." },
  { yol: "karsi_taraf.kod", etiket: "Müşteri kodu", tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("customer", 1) },
  { yol: "karsi_taraf.sube", etiket: "Şube", tur: "metin", sinif: "musteri", ornek: "İstanbul Merkez" },
  ...COMPANY_FIELDS,
  { yol: "toplamlar.miktar", etiket: "Toplam miktar", tur: "sayi", ondalik: 2, sinif: "musteri", ornek: 2400 },
  { yol: "toplamlar.tutar", etiket: "Genel toplam (sipariş dövizi; kayıtta yoksa boş)", tur: "sayi", ondalik: 2, sinif: "musteri", ornek: 6700 },
  { yol: "toplamlar.tutar_metni", etiket: "Genel toplam metni (\"6.700,00 EUR\" ya da \"—\")", tur: "metin", sinif: "musteri", ornek: "6.700,00 EUR" },
  ...PRINT_FIELDS,
];

export type OrderConfirmationConfig = BaseDocConfig;

const EMPTY_TOTALS = { quantity: 0, amount: 0 };

export function normalizeOrderConfirmationConfig(raw: unknown): OrderConfirmationConfig {
  const base = normalizeBase(sanitizeRawConfig(raw), { sections: SECTIONS, signatureDefaults: ORDER_CONFIRMATION_SIGNATURES, marginMm: 9, tables: ["kalemler"] });
  return { ...base, kolonlar: { kalemler: resolveColumns(LINE_TABLE, orderConfirmationColumns(EMPTY_TOTALS) as never, base.columns.kalemler!) } };
}

function lineValues(r: OrderConfirmationDocLine): Record<string, ContextValue> {
  return {
    sira: r.lineNo, urun: orderLineItemText(r), urun_kodu: r.itemCode, urun_adi: r.itemName, musteri_urun_adi: r.customerItemName,
    renk: orderLineColorText(r), renk_adi: r.colorName, musteri_renk_adi: r.customerColorName, en: r.widthCm,
    miktar: r.quantity, birim: unitText(r.unit), tolerans: r.tolerancePct, birim_fiyat: r.unitPrice, tutar: r.lineTotal,
  };
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  // İç alan yok: opt-in listesi gelse de hiçbir alan açılmaz (kayit `unknownInternalFields` reddeder).
  const optIn = new Set(internalFields);
  const config = normalizeOrderConfirmationConfig(rawConfig);
  const doc = asObject(snapshot?.doc) as unknown as OrderConfirmationDoc;
  const h = doc.header;
  const fmt = (n: number | null | undefined, d: number) => docNum(snapshot).tr(n, d);
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject => fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);

  return {
    belge: root("belge", {
      no: h.documentNo, tur: "ORDER_CONFIRMATION", baslik: docTitle(config.titleOverride, ORDER_CONFIRMATION_TITLE), tarih: h.orderDate,
      ...docStatus(extras?.baski),
      siparis_no: h.orderNumber, termin: h.deadline, doviz: h.currency,
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", { ad: h.customerName, kod: h.customerCode, sube: h.branchName }),
    tablolar: {
      antet_ek: letterheadExtraRows(snapshot).map((r) => fillFields(LETTERHEAD_EXTRA_TABLE.kolonlar, r, optIn)),
      kalemler: (doc.lines ?? []).map((r) => fillFields(LINE_TABLE.kolonlar, lineValues(r), optIn)),
      kosullar: orderTermLines(doc).map(([etiket, deger]) => fillFields(TERM_TABLE.kolonlar, { etiket, deger }, optIn)),
    },
    toplamlar: root("toplamlar", { miktar: doc.totals.quantity, tutar: doc.totals.amount, tutar_metni: orderGrandTotalText(doc, fmt) }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("ORDER_CONFIRMATION") as unknown as OrderConfirmationDoc;
  const env = (d: OrderConfirmationDoc) => sampleEnvelope(d as unknown as Row);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const withLines = (d: OrderConfirmationDoc, lines: OrderConfirmationDocLine[]): OrderConfirmationDoc => {
    const priced = lines.filter((l) => l.lineTotal != null);
    return {
      ...d,
      lines: lines.map((l, i) => ({ ...l, lineNo: i + 1 })),
      totals: { quantity: lines.reduce((s, l) => s + l.quantity, 0), amount: priced.length ? r2(priced.reduce((s, l) => s + l.lineTotal!, 0)) : null },
    };
  };
  const [first, second, unpriced] = base().lines;
  const bareHeader = { ...base().header, deadline: null, customerCode: null, branchName: null };
  const single = withLines({ ...base(), header: { ...base().header, currency: "TRY" } }, [{ ...first!, unitPrice: 92.5, lineTotal: 111000 }]);
  const multi = withLines(base(), Array.from({ length: 45 }, (_, i) => ({ ...(i % 3 === 0 ? second! : first!), quantity: 100 + i * 10, unitPrice: 2.85, lineTotal: r2((100 + i * 10) * 2.85) })));
  // Fiyatsız teyit: hiçbir satırda fiyat yok, kayıtta toplam yok → tutar/genel toplam "—".
  const unpricedOnly = withLines(base(), [{ ...first!, unitPrice: null, lineTotal: null }, unpriced!]);
  const empty: OrderConfirmationDoc = {
    ...base(),
    header: bareHeader,
    lines: [{ ...unpriced!, lineNo: 1, colorName: null, customerColorName: null, widthCm: null, tolerancePct: null }],
    totals: { quantity: 400, amount: null },
  };
  const long: OrderConfirmationDoc = {
    ...withLines(base(), [first!, { ...second!, itemName: longText("Özel jakar desen <&> numune", 200), customerItemName: longText("Müşteri adı <i>", 120), colorName: "Antrasit & Gri", customerColorName: "Füme \"koyu\"", widthCm: 999.4 }]),
    header: { ...base().header, customerName: longText("Çok Uzun Adlı Müşteri Tekstil"), customerCode: "M-<01>", branchName: longText("Şube", 80) },
  };

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek teyidi (EUR, termin, müşteri adları, fiyatsız bir satır)", snapshot: env(base()) },
    { ad: "tek_kalem", aciklama: "Tek kalem, TRY", snapshot: env(single) },
    { ad: "fiyatsiz", aciklama: "Fiyatsız teyit: satırlarda fiyat yok, genel toplam yok", snapshot: env(unpricedOnly) },
    { ad: "cok_sayfa", aciklama: "45 kalem — tablo birden çok sayfaya taşar", snapshot: env(multi), ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Acil" } } },
    { ad: "bos_opsiyonel", aciklama: "Kodsuz/şubesiz müşteri, terminsiz, renksiz/ensiz/toleranssız fiyatsız kalem", snapshot: env(empty) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren adlar", snapshot: env(long) },
    { ad: "iptal", aciklama: "İptal edilmiş siparişin (VOIDED) teyidi", snapshot: env(base()), ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "Müşteri vazgeçti" } } },
  ];
}

export const orderConfirmationContract: DocumentContract<OrderConfirmationConfig, never> = {
  docType: "ORDER_CONFIRMATION",
  hedef: "musteri",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: [LETTERHEAD_EXTRA_TABLE, LINE_TABLE, TERM_TABLE],
  ayarSemasi: baseConfigSchema(Object.keys(SECTIONS), [["kalemler", "kalemler"]]),
  ayarNormalize: normalizeOrderConfirmationConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
