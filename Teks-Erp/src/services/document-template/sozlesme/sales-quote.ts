// =============================================================================
// SALES_QUOTE (Satış Teklifi) veri sözleşmesi — MAL-6
// =============================================================================
// Müşteriye gider (`hedef: musteri`). Maliyet, kâr, önerilen fiyat, fiyat kaynağı ve iç not
// sözleşmede YOKTUR — `ic` sınıflı alan da AÇILMAZ (iç kolon opt-in'i bu türde kapalı;
// bekçi test_teklif_belgesi §4). Koşul satırları ve genel toplam metni renderer'ın AYNI
// yardımcılarından dolar — şablon hesap yapmaz.
// =============================================================================

import { docTitle } from "../../document-render/doc-style";
import { docNum } from "../../document-render/fmt-num";
import { unitText } from "../../document-render/commercial-doc";
import {
  SALES_QUOTE_SIGNATURES,
  SALES_QUOTE_TITLE,
  grandTotalText,
  quoteLineColumns,
  quoteTermLines,
  type SalesQuoteDoc,
  type SalesQuoteDocLine,
} from "../../document-render/sales-quote.html";
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
  taxNo: true, customerCode: true, branch: true, quoteNo: true, date: true, customerReference: true, terms: true, lineTable: true, grandTotal: true, notes: true,
} as const;

const LINE_TABLE: TableDef = {
  anahtar: "kalemler",
  etiket: "Teklif kalemleri",
  kolonlar: [
    { yol: "sira", etiket: "Sıra", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1, hiza: "c", kaynakKolon: "seq" },
    { yol: "tanim", etiket: "Ürün / tanım", tur: "metin", sinif: "musteri", ornek: "Pamuklu Astar", hiza: "l", kaynakKolon: "description" },
    { yol: "urun_kodu", etiket: "Ürün kodu (tanımla aynı hücrede)", tur: "metin", sinif: "musteri", ornek: "KM-0101", hiza: "l" },
    { yol: "renk", etiket: "Renk", tur: "metin", sinif: "musteri", ornek: "Bej", hiza: "l", kaynakKolon: "color" },
    { yol: "en", etiket: "En", tur: "sayi", ondalik: 0, birim: "cm", sinif: "musteri", ornek: 150, hiza: "c", kaynakKolon: "width" },
    { yol: "miktar", etiket: "Miktar", tur: "sayi", ondalik: 2, sinif: "musteri", ornek: 1200, hiza: "r", kaynakKolon: "qty", toplam: "miktar" },
    { yol: "birim", etiket: "Birim", tur: "metin", sinif: "musteri", ornek: "m", hiza: "c", kaynakKolon: "unit" },
    { yol: "birim_fiyat", etiket: "Birim fiyat (teklif dövizi)", tur: "sayi", ondalik: 2, sinif: "musteri", ornek: 2.85, hiza: "r", kaynakKolon: "unitPrice" },
    { yol: "tutar", etiket: "Tutar (teklif dövizi)", tur: "sayi", ondalik: 2, sinif: "musteri", ornek: 3420, hiza: "r", kaynakKolon: "amount", toplam: "tutar" },
  ],
};

const TERM_TABLE: TableDef = {
  anahtar: "kosullar",
  etiket: "Teklif koşulları",
  kolonlar: [
    { yol: "etiket", etiket: "Koşul", tur: "metin", sinif: "musteri", ornek: "Vade", hiza: "l" },
    { yol: "deger", etiket: "Değer", tur: "metin", sinif: "musteri", ornek: "60 gün", hiza: "l" },
  ],
};

const ROOT_FIELDS: FieldDef[] = [
  { yol: "belge.no", etiket: "Teklif no (revizyonlu)", tur: "metin", sinif: "musteri", ornek: `${sampleSeriesCode("salesQuote", 1)}/R1` },
  { yol: "belge.tur", etiket: "Belge türü", tur: "metin", sinif: "musteri", ornek: "SALES_QUOTE" },
  { yol: "belge.baslik", etiket: "Belge başlığı", tur: "metin", sinif: "musteri", ornek: SALES_QUOTE_TITLE },
  { yol: "belge.tarih", etiket: "Teklif tarihi", tur: "takvim", sinif: "musteri", ornek: "2026-09-25T00:00:00.000Z" },
  ...DOC_STATUS_FIELDS,
  { yol: "belge.revizyon", etiket: "Revizyon no", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1 },
  { yol: "belge.gecerlilik", etiket: "Geçerlilik (son gün)", tur: "takvim", sinif: "musteri", ornek: "2026-10-25T00:00:00.000Z" },
  { yol: "belge.doviz", etiket: "Döviz", tur: "metin", sinif: "musteri", ornek: "USD" },
  { yol: "belge.kur", etiket: "Kur (1 döviz = ? TRY; TRY teklifte boş)", tur: "sayi", ondalik: 4, sinif: "musteri", ornek: 32.4512 },
  { yol: "belge.vade_gun", etiket: "Vade (gün)", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 60 },
  { yol: "belge.referans", etiket: "Müşteri referansı", tur: "metin", sinif: "musteri", ornek: "PO-7781" },
  { yol: "belge.not", etiket: "Müşteri notu", tur: "metin", sinif: "musteri", ornek: "Fiyatlara KDV dahil değildir." },
  { yol: "karsi_taraf.ad", etiket: "Müşteri adı", tur: "metin", sinif: "musteri", ornek: "Örnek Tekstil A.Ş." },
  { yol: "karsi_taraf.kod", etiket: "Müşteri kodu", tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("customer", 1) },
  { yol: "karsi_taraf.sube", etiket: "Şube", tur: "metin", sinif: "musteri", ornek: "İstanbul Merkez" },
  ...COMPANY_FIELDS,
  { yol: "toplamlar.miktar", etiket: "Toplam miktar", tur: "sayi", ondalik: 2, sinif: "musteri", ornek: 2050 },
  { yol: "toplamlar.tutar", etiket: "Genel toplam (teklif dövizi)", tur: "sayi", ondalik: 2, sinif: "musteri", ornek: 7037.5 },
  { yol: "toplamlar.tutar_metni", etiket: "Genel toplam metni (\"7.037,50 USD\")", tur: "metin", sinif: "musteri", ornek: "7.037,50 USD" },
  ...PRINT_FIELDS,
];

export type SalesQuoteConfig = BaseDocConfig;

const EMPTY_TOTALS = { quantity: 0, amount: 0 };

export function normalizeSalesQuoteConfig(raw: unknown): SalesQuoteConfig {
  const base = normalizeBase(sanitizeRawConfig(raw), { sections: SECTIONS, signatureDefaults: SALES_QUOTE_SIGNATURES, marginMm: 9, tables: ["kalemler"] });
  return { ...base, kolonlar: { kalemler: resolveColumns(LINE_TABLE, quoteLineColumns(EMPTY_TOTALS) as never, base.columns.kalemler!) } };
}

function lineValues(r: SalesQuoteDocLine): Record<string, ContextValue> {
  return {
    sira: r.lineNo, tanim: r.description, urun_kodu: r.itemCode, renk: r.colorName, en: r.widthCm,
    miktar: r.quantity, birim: unitText(r.unit), birim_fiyat: r.unitPrice, tutar: r.lineTotal,
  };
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  // İç alan yok: opt-in listesi gelse de hiçbir alan açılmaz (kayit `unknownInternalFields` reddeder).
  const optIn = new Set(internalFields);
  const config = normalizeSalesQuoteConfig(rawConfig);
  const doc = asObject(snapshot?.doc) as unknown as SalesQuoteDoc;
  const h = doc.header;
  const fmt = (n: number | null | undefined, d: number) => docNum(snapshot).tr(n, d);
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject => fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);

  return {
    belge: root("belge", {
      no: h.documentNo, tur: "SALES_QUOTE", baslik: docTitle(config.titleOverride, SALES_QUOTE_TITLE), tarih: h.quoteDate,
      ...docStatus(extras?.baski),
      revizyon: h.revisionNo, gecerlilik: h.validUntilDate, doviz: h.currency, kur: h.fxRate, vade_gun: h.paymentTermDays,
      referans: h.customerReference, not: doc.notes,
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", { ad: h.customerName, kod: h.customerCode, sube: h.branchName }),
    tablolar: {
      antet_ek: letterheadExtraRows(snapshot).map((r) => fillFields(LETTERHEAD_EXTRA_TABLE.kolonlar, r, optIn)),
      kalemler: (doc.lines ?? []).map((r) => fillFields(LINE_TABLE.kolonlar, lineValues(r), optIn)),
      kosullar: quoteTermLines(doc, fmt).map(([etiket, deger]) => fillFields(TERM_TABLE.kolonlar, { etiket, deger }, optIn)),
    },
    toplamlar: root("toplamlar", { miktar: doc.totals.quantity, tutar: doc.totals.amount, tutar_metni: grandTotalText(doc, fmt) }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("SALES_QUOTE") as unknown as SalesQuoteDoc;
  const env = (d: SalesQuoteDoc) => sampleEnvelope(d as unknown as Row);
  const withLines = (d: SalesQuoteDoc, lines: SalesQuoteDocLine[]): SalesQuoteDoc => ({
    ...d,
    lines: lines.map((l, i) => ({ ...l, lineNo: i + 1 })),
    totals: { quantity: lines.reduce((s, l) => s + l.quantity, 0), amount: Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100 },
  });
  const [first, second, adHoc] = base().lines;
  const tryHeader = { ...base().header, currency: "TRY", fxRate: null, paymentTermDays: null, customerReference: null, branchName: null };
  const single = withLines({ ...base(), header: tryHeader }, [{ ...first!, unitPrice: 92.5, lineTotal: 111000 }]);
  const multi = withLines(base(), Array.from({ length: 45 }, (_, i) => ({ ...(i % 3 === 0 ? second! : first!), quantity: 100 + i * 10, lineTotal: Math.round((100 + i * 10) * 2.85 * 100) / 100, unitPrice: 2.85 })));
  const empty: SalesQuoteDoc = { ...base(), header: { ...tryHeader, customerCode: null }, lines: [{ ...adHoc!, colorName: null }], totals: { quantity: 50, amount: 337.5 }, notes: null };
  const long: SalesQuoteDoc = {
    ...withLines(base(), [first!, { ...adHoc!, description: longText("Özel jakar desen <&> numune", 200), colorName: "Antrasit & Gri", widthCm: 999.4 }]),
    header: { ...base().header, customerName: longText("Çok Uzun Adlı Müşteri Tekstil"), customerCode: "M-<01>", customerReference: longText("REF", 100), branchName: longText("Şube", 80) },
    notes: longText("Uzun müşteri notu <b>kaçış</b>", 1000),
  };

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek teklifi (USD, kur, vade, ürünsüz kalem)", snapshot: env(base()) },
    { ad: "tek_kalem", aciklama: "Tek kalem, TRY (kur ve vade satırı yok)", snapshot: env(single) },
    { ad: "cok_kalem_doviz", aciklama: "Çok kalem USD + kur", snapshot: env(withLines(base(), [first!, second!, adHoc!])) },
    { ad: "cok_sayfa", aciklama: "45 kalem — tablo birden çok sayfaya taşar", snapshot: env(multi), ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Acil" } } },
    { ad: "bos_opsiyonel", aciklama: "Kodsuz müşteri, notsuz, tek ürünsüz kalem", snapshot: env(empty) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren adlar ve not", snapshot: env(long) },
    { ad: "iptal", aciklama: "İptal edilmiş (VOIDED) teklif belgesi", snapshot: env(base()), ek: { baski: { surum: 1, durum: "VOIDED", iptalNedeni: "Müşteri vazgeçti" } } },
  ];
}

export const salesQuoteContract: DocumentContract<SalesQuoteConfig, never> = {
  docType: "SALES_QUOTE",
  hedef: "musteri",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: [LETTERHEAD_EXTRA_TABLE, LINE_TABLE, TERM_TABLE],
  ayarSemasi: baseConfigSchema(Object.keys(SECTIONS), [["kalemler", "kalemler"]]),
  ayarNormalize: normalizeSalesQuoteConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
