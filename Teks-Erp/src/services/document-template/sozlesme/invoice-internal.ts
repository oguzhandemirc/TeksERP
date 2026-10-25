// =============================================================================
// INVOICE_INTERNAL (Fatura — iç çıktı) veri sözleşmesi
// =============================================================================
// Sistem renderer'ı (`document-render/finance-doc.html.ts`) DEĞİŞMEZ ve yalnız okunur.
// İç belgedir (`hedef: ic`) ama donmuş defter semantiği taşır: ara toplam, KDV, tevkifat ve
// genel toplam snapshot'tan AYNEN gelir, şablon yeniden hesaplamaz. Renderer'da opt-in iç
// kolon yok → iç alan beyanı yok (cari kodu Sistem'de koşulsuz basılır).
// =============================================================================

import type { DocColSpec } from "../../document-render/doc-model";
import { docTitle } from "../../document-render/doc-style";
import type { PrintedDocSnapshot } from "../../printed-document.service";
import {
  CREATED_BY_FIELD,
  NOTES_FIELD,
  PARTY_FIELDS,
  dateText,
  docHeader,
  moneyText,
  partyValues,
  qtyFields,
  qtyPair,
  type AmountInWordsSource,
} from "./finance-common";
import {
  COMPANY_FIELDS,
  LETTERHEAD_EXTRA_TABLE,
  PRINT_FIELDS,
  asObject,
  asRows,
  asText,
  companyRoot,
  docStatus,
  fillFields,
  letterheadExtraRows,
  printRoot,
  rootFields,
} from "./ortak";
import { longText, sampleDoc, sampleEnvelope } from "./senaryolar";
import { baseConfigSchema, normalizeBase, plainJson, resolveColumns, sanitizeRawConfig, type BaseDocConfig } from "./subcontractor-common";
import type { BuildExtras, ContextObject, ContextValue, DocumentContract, FieldDef, Scenario, TableDef, TemplateContext } from "./tipler";
import { headFields } from "./warehouse-common";

type Row = Record<string, unknown>;

const SECTIONS = { documentNo: true, date: true, dueDate: true, externalNo: true, createdBy: true, lineTable: true, totals: true } as const;

const LINE_TABLE: TableDef = {
  anahtar: "kalemler",
  etiket: "Fatura kalemleri",
  kolonlar: [
    { yol: "aciklama", etiket: "Açıklama", tur: "metin", sinif: "musteri", ornek: "Patos Kumaş · Gri", hiza: "l", kaynakKolon: "description" },
    ...qtyFields("miktar", "Miktar", 520, 0).map((f, i) => ({ ...f, hiza: "r" as const, ...(i === 0 ? { kaynakKolon: "qty" } : {}) })),
    { yol: "birim", etiket: "Birim (miktarla aynı hücrede)", tur: "metin", sinif: "musteri", ornek: "m", hiza: "r" },
    { yol: "birim_fiyat", etiket: "Birim fiyat", tur: "para", sinif: "musteri", ornek: "3.4500", hiza: "r", kaynakKolon: "unitPrice" },
    ...qtyFields("iskonto", "İskonto %", 0, 0).map((f, i) => ({ ...f, hiza: "c" as const, ...(i === 0 ? { kaynakKolon: "discountRate" } : {}) })),
    ...qtyFields("kdv_orani", "KDV %", 20, 0).map((f, i) => ({ ...f, hiza: "c" as const, ...(i === 0 ? { kaynakKolon: "vatRate" } : {}) })),
    { yol: "tutar", etiket: "Kalem tutarı (KDV hariç)", tur: "para", sinif: "musteri", ornek: "1794.00", hiza: "r", kaynakKolon: "lineNet", toplam: "ara_toplam" },
    { yol: "kdv_tutari", etiket: "Kalem KDV tutarı", tur: "para", sinif: "musteri", ornek: "358.80", hiza: "r" },
  ],
};

const TEXT = { t: "text" } as const;
/** Renderer kolonlarının eşi (anahtar/başlık/hiza/genişlik). */
const LINE_SPECS: DocColSpec<never>[] = [
  { key: "description", label: "AÇIKLAMA", align: "l", kind: TEXT, value: () => null },
  { key: "qty", label: "MİKTAR", align: "r", width: "80px", kind: TEXT, value: () => null },
  { key: "unitPrice", label: "B.FİYAT", align: "r", width: "90px", kind: TEXT, value: () => null },
  { key: "discountRate", label: "İSK.%", align: "c", width: "55px", kind: TEXT, value: () => null },
  { key: "vatRate", label: "KDV%", align: "c", width: "55px", kind: TEXT, value: () => null },
  { key: "lineNet", label: "TUTAR", align: "r", width: "100px", kind: TEXT, value: () => null, foot: { value: null } },
];

const ROOT_FIELDS: FieldDef[] = [
  ...headFields("Fatura no", "FTR1408260001", "SATIŞ FATURASI", "INVOICE_INTERNAL"),
  { yol: "belge.fatura_turu", etiket: "Fatura türü kodu (SALES/PURCHASE…)", tur: "metin", sinif: "musteri", ornek: "SALES" },
  { yol: "belge.fatura_turu_etiketi", etiket: "Fatura türü", tur: "metin", sinif: "musteri", ornek: "Satış Faturası" },
  { yol: "belge.vade", etiket: "Vade tarihi", tur: "takvim", sinif: "musteri", ornek: "2026-10-25T08:30:00.000Z" },
  { yol: "belge.dis_belge_no", etiket: "Belge / irsaliye no", tur: "metin", sinif: "musteri", ornek: "IRS-2026-8812" },
  { yol: "belge.para_birimi", etiket: "Para birimi", tur: "metin", sinif: "musteri", ornek: "USD" },
  ...qtyFields("belge.kur", "Döviz kuru", 40.25, 2),
  CREATED_BY_FIELD,
  NOTES_FIELD,
  ...PARTY_FIELDS,
  ...COMPANY_FIELDS,
  { yol: "toplamlar.kalem_adedi", etiket: "Kalem adedi", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 3 },
  { yol: "toplamlar.ara_toplam", etiket: "Ara toplam (KDV hariç)", tur: "para", sinif: "musteri", ornek: "2816.10" },
  { yol: "toplamlar.kdv", etiket: "KDV toplamı", tur: "para", sinif: "musteri", ornek: "563.22" },
  { yol: "toplamlar.tevkifat", etiket: "Tevkifat", tur: "para", sinif: "musteri", ornek: "112.64" },
  { yol: "toplamlar.tevkifat_var", etiket: "Tevkifat var mı (sıfırdan büyük)", tur: "mantiksal", sinif: "musteri", ornek: true },
  { yol: "toplamlar.genel", etiket: "Genel toplam", tur: "para", sinif: "musteri", ornek: "3266.68" },
  { yol: "toplamlar.genel_tl", etiket: "Genel toplamın TL karşılığı", tur: "para", sinif: "musteri", ornek: "131483.87" },
  ...PRINT_FIELDS,
];

/** Tutar yazıyla: genel toplam, belgenin para biriminde. */
export const INVOICE_AMOUNT_IN_WORDS: AmountInWordsSource = { tutar: "toplamlar.genel", paraBirimi: "belge.para_birimi" };

export type InvoiceInternalConfig = BaseDocConfig;

export function normalizeInvoiceInternalConfig(raw: unknown): InvoiceInternalConfig {
  const base = normalizeBase(sanitizeRawConfig(raw), {
    sections: SECTIONS,
    signatureDefaults: ["Düzenleyen", "Teslim Alan"],
    marginMm: 9,
    tables: ["lineTable"],
  });
  return { ...base, kolonlar: { kalemler: resolveColumns(LINE_TABLE, LINE_SPECS, base.columns.lineTable!) } };
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  const config = normalizeInvoiceInternalConfig(rawConfig);
  const optIn = new Set(internalFields);
  const doc = asObject(snapshot?.doc);
  const h = docHeader(doc);
  const totals = asObject(doc.totals);
  const lines = asRows(doc.lines);
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject =>
    fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);
  const rows = lines.map((l) =>
    fillFields(
      LINE_TABLE.kolonlar,
      {
        aciklama: asText(l.description),
        ...qtyPair("miktar", l.qty),
        birim: asText(l.unit),
        birim_fiyat: moneyText(l.unitPrice),
        ...qtyPair("iskonto", l.discountRate),
        ...qtyPair("kdv_orani", l.vatRate),
        tutar: moneyText(l.lineNet),
        kdv_tutari: moneyText(l.lineVat),
      },
      optIn,
    ),
  );
  const withholding = Number(totals.withholding);

  return {
    belge: root("belge", {
      no: asText(h.documentNo),
      tur: "INVOICE_INTERNAL",
      baslik: docTitle(config.titleOverride, asText(h.typeLabel) ?? ""),
      tarih: dateText(h.date),
      ...docStatus(extras?.baski),
      fatura_turu: asText(h.type),
      fatura_turu_etiketi: asText(h.typeLabel),
      vade: dateText(h.dueDate),
      dis_belge_no: asText(h.externalNo),
      para_birimi: asText(h.currency),
      ...qtyPair("kur", h.exchangeRate),
      duzenleyen: asText(h.createdBy),
      notlar: asText(doc.notes),
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", partyValues(h)),
    tablolar: { antet_ek: letterheadExtraRows(snapshot).map((r) => fillFields(LETTERHEAD_EXTRA_TABLE.kolonlar, r, optIn)), kalemler: rows },
    toplamlar: root("toplamlar", {
      kalem_adedi: lines.length,
      ara_toplam: moneyText(totals.net),
      kdv: moneyText(totals.vat),
      tevkifat: moneyText(totals.withholding),
      tevkifat_var: Number.isFinite(withholding) && withholding > 0,
      genel: moneyText(totals.grand),
      genel_tl: moneyText(totals.grandTry),
    }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("INVOICE_INTERNAL");
  const header = (d: Row) => d.header as Row;
  const line = (i: number): Row => ({
    description: `Patos Kumaş · Renk ${i}`, qty: String(100 + i * 7.25), unit: "m", unitPrice: "3.4500",
    discountRate: i % 4 === 0 ? "2.5" : "0", vatRate: i % 5 === 0 ? "10" : "20", lineNet: (345 + i * 25.01).toFixed(2), lineVat: "69.00",
  });

  const tryOne = base();
  tryOne.header = { ...header(tryOne), currency: "TRY", exchangeRate: null, externalNo: null };
  tryOne.lines = [{ description: "Saten Kumaş · Ekru", qty: "180.5", unit: "m", unitPrice: "5.1000", discountRate: "5", vatRate: "20", lineNet: "874.48", lineVat: "174.90" }];
  tryOne.totals = { net: "874.48", vat: "174.90", withholding: "0.00", grand: "1049.38", grandTry: null };

  const many = base();
  many.lines = Array.from({ length: 55 }, (_, i) => line(i + 1));
  many.totals = { net: "56012.34", vat: "11202.47", withholding: "0", grand: "67214.81", grandTry: "2705396.10" };
  many.notes = "Dönem sonu toplu fatura";

  const empty: Row = {
    header: {
      documentNo: "FTR1408260002", date: null, dueDate: null, type: "PURCHASE", typeLabel: "Alış Faturası",
      partyName: "Tedarikçi A.Ş.", partyCode: null, partyTaxInfo: null, currency: "EUR", exchangeRate: null, externalNo: null, createdBy: null,
    },
    lines: [{ description: "Numune", qty: null, unit: null, unitPrice: null, discountRate: null, vatRate: null, lineNet: null, lineVat: null }],
    totals: { net: "0.00", vat: "0.00", withholding: null, grand: "0.00", grandTry: null },
    notes: null,
  };

  const noLines = base();
  noLines.lines = [];
  noLines.totals = { net: "0.00", vat: "0.00", withholding: "0.00", grand: "0.00", grandTry: "0.00" };

  const long = base();
  long.header = { ...header(long), partyName: longText("Çok Uzun Adlı Cari Tekstil"), partyCode: "CR-<01>", partyTaxInfo: longText("Merkez V.D.", 80), externalNo: "IRS-<&>", typeLabel: "Satış Faturası" };
  long.lines = [
    { description: longText("Süet Kumaş · Antrasit & Gri", 160), qty: "1234.567", unit: "m<2>", unitPrice: "1234567.8912", discountRate: "12.345", vatRate: "1", lineNet: "1234567890.12", lineVat: "12345678.90" },
    { description: "Kısa", qty: "0.3", unit: "kg", unitPrice: "-15.5", discountRate: "0", vatRate: "0", lineNet: "-4.65", lineVat: "0" },
  ];
  long.totals = { net: "1234567885.47", vat: "12345678.90", withholding: "1000000.00", grand: "1245913564.37", grandTry: "50148020966.89" };
  long.notes = longText("Fatura notu", 120);

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek faturası (USD, tevkifatlı, TL karşılığı)", snapshot: sampleEnvelope(base()) },
    { ad: "tek_kalem", aciklama: "Tek kalem TL fatura — tevkifat sıfır (satır basılmaz), TL karşılığı yok", snapshot: sampleEnvelope(tryOne) },
    {
      ad: "cok_sayfa",
      aciklama: "55 kalem — liste birden çok sayfaya taşar",
      snapshot: sampleEnvelope(many),
      ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Muhasebe kopyası" } },
    },
    { ad: "bos_opsiyonel", aciklama: "Opsiyonel alanlar boş: tarihsiz, kodsuz, tutarsız kalem (— basılır)", snapshot: sampleEnvelope(empty) },
    { ad: "kalemsiz", aciklama: "Kalemi olmayan taslak dökümü — boş tablo + sıfır toplam", snapshot: sampleEnvelope(noLines) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren metin; büyük, negatif ve kesirli sayılar", snapshot: sampleEnvelope(long) },
    {
      ad: "iptal",
      aciklama: "İptal edilmiş (VOIDED) ikinci sürüm",
      snapshot: sampleEnvelope(base()),
      ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "Fatura iptal edildi" } },
    },
  ];
}

export const invoiceInternalContract: DocumentContract<InvoiceInternalConfig, never> = {
  docType: "INVOICE_INTERNAL",
  hedef: "ic",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: [LETTERHEAD_EXTRA_TABLE, LINE_TABLE],
  ayarSemasi: baseConfigSchema(Object.keys(SECTIONS), [["lineTable", "kalemler"]]),
  ayarNormalize: normalizeInvoiceInternalConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
