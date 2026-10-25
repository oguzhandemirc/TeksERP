// =============================================================================
// RECONCILIATION_LETTER (Cari Mutabakat Mektubu) veri sözleşmesi
// =============================================================================
// Sistem renderer'ı (`document-render/finance-doc.html.ts`) DEĞİŞMEZ ve yalnız okunur.
// Karşı tarafa gider (`hedef: musteri`), cari `karsi_taraf`. Bakiyeler para birimi bazında
// ayrıdır, TOPLANMAZ (genel toplam alanı yok). Bakiyenin mutlak değeri (snapshot yuvarlama
// damgasıyla) ve BORÇ/ALACAK/KAPALI durumu burada çözülür; şablon hesap yapmaz.
// =============================================================================

import type { DocColSpec } from "../../document-render/doc-model";
import { docTitle } from "../../document-render/doc-style";
import { docNum } from "../../document-render/fmt-num";
import type { PrintedDocSnapshot } from "../../printed-document.service";
import { CREATED_BY_FIELD, NOTES_FIELD, PARTY_FIELDS, dateText, docHeader, moneyText, partyValues } from "./finance-common";
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

const TITLE = "Cari Mutabakat Mektubu";
const SECTIONS = { documentNo: true, date: true, asOf: true, createdBy: true, balanceTable: true, declaration: true } as const;

const BALANCE_TABLE: TableDef = {
  anahtar: "bakiyeler",
  etiket: "Bakiye dökümü (para birimi başına)",
  kolonlar: [
    { yol: "para_birimi", etiket: "Para birimi", tur: "metin", sinif: "musteri", ornek: "TRY", hiza: "c", kaynakKolon: "currency" },
    { yol: "borc", etiket: "Borç", tur: "para", sinif: "musteri", ornek: "184500.00", hiza: "r", kaynakKolon: "debit" },
    { yol: "alacak", etiket: "Alacak", tur: "para", sinif: "musteri", ornek: "121000.00", hiza: "r", kaynakKolon: "credit" },
    { yol: "bakiye", etiket: "Bakiye (işaretli; pozitif = cari bize borçlu)", tur: "para", sinif: "musteri", ornek: "63500.00", hiza: "r" },
    { yol: "bakiye_mutlak", etiket: "Bakiye (mutlak — basılan)", tur: "para", sinif: "musteri", ornek: "63500.00", hiza: "r", kaynakKolon: "balance" },
    { yol: "durum", etiket: "Durum (BORÇ / ALACAK / KAPALI)", tur: "metin", sinif: "musteri", ornek: "BORÇ", hiza: "c", kaynakKolon: "side" },
  ],
};

const TEXT = { t: "text" } as const;
/** Renderer kolonlarının eşi (anahtar/başlık/hiza/genişlik). */
const BALANCE_SPECS: DocColSpec<never>[] = [
  { key: "currency", label: "PARA", align: "c", width: "60px", kind: TEXT, value: () => null },
  { key: "debit", label: "BORÇ", align: "r", width: "110px", kind: TEXT, value: () => null },
  { key: "credit", label: "ALACAK", align: "r", width: "110px", kind: TEXT, value: () => null },
  { key: "balance", label: "BAKİYE", align: "r", width: "110px", kind: TEXT, value: () => null },
  { key: "side", label: "DURUM", align: "c", width: "90px", kind: TEXT, value: () => null },
];

const ROOT_FIELDS: FieldDef[] = [
  ...headFields("Mektup no", "MTB-2026-0001", "CARİ MUTABAKAT MEKTUBU", "RECONCILIATION_LETTER"),
  { yol: "belge.bakiye_tarihi", etiket: "Bakiye (kesit) tarihi", tur: "tarih", sinif: "musteri", ornek: "2026-09-25T08:30:00.000Z" },
  CREATED_BY_FIELD,
  NOTES_FIELD,
  ...PARTY_FIELDS,
  ...COMPANY_FIELDS,
  { yol: "toplamlar.satir_adedi", etiket: "Bakiye satırı (para birimi) adedi", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 3 },
  ...PRINT_FIELDS,
];

/** Bakiye işaretinin insan karşılığı (renderer `balanceSideLabel` eşi). */
function sideLabel(balance: unknown): string {
  const n = Number(balance);
  if (!Number.isFinite(n) || n === 0) return "KAPALI";
  return n > 0 ? "BORÇ" : "ALACAK";
}

export type ReconciliationLetterConfig = BaseDocConfig;

export function normalizeReconciliationLetterConfig(raw: unknown): ReconciliationLetterConfig {
  const base = normalizeBase(sanitizeRawConfig(raw), {
    sections: SECTIONS,
    signatureDefaults: ["Düzenleyen", "Mutabıkız — Kaşe / İmza"],
    marginMm: 9,
    tables: ["balanceTable"],
  });
  return { ...base, kolonlar: { bakiyeler: resolveColumns(BALANCE_TABLE, BALANCE_SPECS, base.columns.balanceTable!) } };
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  const config = normalizeReconciliationLetterConfig(rawConfig);
  const optIn = new Set(internalFields);
  const doc = asObject(snapshot?.doc);
  const h = docHeader(doc);
  const num = docNum(snapshot ?? {});
  const balances = asRows(doc.balances);
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject =>
    fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);
  const rows = balances.map((b) => {
    const n = Number(b.balance);
    return fillFields(
      BALANCE_TABLE.kolonlar,
      {
        para_birimi: asText(b.currency),
        borc: moneyText(b.debit),
        alacak: moneyText(b.credit),
        bakiye: moneyText(b.balance),
        // Renderer `Number(v)` ile okur: null/"" sıfır sayılır ("0,00"), yalnız sayı olmayan "—"/ham kalır.
        bakiye_mutlak: Number.isFinite(n) ? num.absDec2(n) : moneyText(b.balance),
        durum: sideLabel(b.balance),
      },
      optIn,
    );
  });

  return {
    belge: root("belge", {
      no: asText(h.documentNo),
      tur: "RECONCILIATION_LETTER",
      baslik: docTitle(config.titleOverride, TITLE),
      tarih: dateText(h.date),
      ...docStatus(extras?.baski),
      bakiye_tarihi: dateText(h.asOf),
      duzenleyen: asText(h.createdBy),
      notlar: asText(doc.notes),
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", partyValues(h)),
    tablolar: { antet_ek: letterheadExtraRows(snapshot).map((r) => fillFields(LETTERHEAD_EXTRA_TABLE.kolonlar, r, optIn)), bakiyeler: rows },
    toplamlar: root("toplamlar", { satir_adedi: balances.length }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("RECONCILIATION_LETTER");
  const header = (d: Row) => d.header as Row;

  const single = base();
  single.balances = [{ currency: "TRY", debit: "1000", credit: "1000.005", balance: "-0.005" }];
  single.notes = "Ekstre ektedir.";

  const many = base();
  many.balances = ["TRY", "USD", "EUR", "GBP", "CHF", "JPY", "RUB", "SAR", "AED", "CNY"].flatMap((c, i) =>
    Array.from({ length: 5 }, (_, k) => ({ currency: c, debit: (1000 * (i + 1) + k * 12.5).toFixed(2), credit: (900 * (i + 1)).toFixed(2), balance: (100 * (i + 1) + k * 12.5 - (k % 2) * 2500).toFixed(2) })),
  );

  const empty: Row = {
    header: { documentNo: "MTB-2026-0002", date: null, asOf: null, partyName: "Örnek Tekstil Ltd. Şti.", partyCode: null, partyTaxInfo: null, createdBy: null },
    balances: [],
    notes: null,
  };
  const nullAmounts = base();
  nullAmounts.balances = [{ currency: "TRY", debit: null, credit: "", balance: null }];

  const long = base();
  long.header = { ...header(long), partyName: longText("Çok Uzun Adlı Cari Tekstil"), partyCode: "CR-<01>", partyTaxInfo: longText("V.D. & No", 80), createdBy: "Ali <Veli>" };
  long.balances = [{ currency: "TRY", debit: "123456789012.34", credit: "0.01", balance: "123456789012.33" }];
  long.notes = longText("Mutabakat notu", 160);

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek mektubu (üç para birimi, biri kapalı)", snapshot: sampleEnvelope(base()) },
    { ad: "tek_kalem", aciklama: "Tek para birimi, yarım kuruşluk negatif bakiye (yuvarlama damgası)", snapshot: sampleEnvelope(single) },
    {
      ad: "cok_sayfa",
      aciklama: "50 bakiye satırı — liste birden çok sayfaya taşar",
      snapshot: sampleEnvelope(many),
      ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Gönderildi" } },
    },
    { ad: "bos_opsiyonel", aciklama: "Hareketsiz cari: bakiye yok (açık ifade kutusu), tarihsiz, kodsuz", snapshot: sampleEnvelope(empty) },
    { ad: "tutarsiz_satir", aciklama: "Boş tutarlı bakiye satırı (— basılır, durum KAPALI)", snapshot: sampleEnvelope(nullAmounts) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren metin; büyük tutar", snapshot: sampleEnvelope(long) },
    {
      ad: "iptal",
      aciklama: "İptal edilmiş (VOIDED) ikinci sürüm",
      snapshot: sampleEnvelope(base()),
      ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "Kesit tarihi hatalı" } },
    },
  ];
}

export const reconciliationLetterContract: DocumentContract<ReconciliationLetterConfig, never> = {
  docType: "RECONCILIATION_LETTER",
  hedef: "musteri",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: [LETTERHEAD_EXTRA_TABLE, BALANCE_TABLE],
  ayarSemasi: baseConfigSchema(Object.keys(SECTIONS), [["balanceTable", "bakiyeler"]]),
  ayarNormalize: normalizeReconciliationLetterConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
