// =============================================================================
// QUALITY_CERTIFICATE (Kalite Sertifikası) veri sözleşmesi
// =============================================================================
// Sistem renderer'ı (`document-render/quality-certificate.html.ts`) DEĞİŞMEZ ve yalnız okunur.
// Müşteriye gider (`hedef: musteri`); müşteri `karsi_taraf`tır. Kalite dağılımı ve toplamlar
// Shipment'tan donmuş özettir — sözleşme yalnız aktarır, şablon özet hesaplamaz. Renderer'da
// opt-in iç kolon yok → iç alan beyanı yok.
// =============================================================================

import type { DocColSpec } from "../../document-render/doc-model";
import { docTitle } from "../../document-render/doc-style";
import type { PrintedDocSnapshot } from "../../printed-document.service";
import {
  COMPANY_FIELDS,
  LETTERHEAD_EXTRA_TABLE,
  PRINT_FIELDS,
  asNumber,
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
import { longText, sampleDoc, sampleEnvelope, sampleSeriesCode } from "./senaryolar";
import { SAMPLE_GRADE_LABEL, baseConfigSchema, normalizeBase, plainJson, resolveColumns, sanitizeRawConfig, type BaseDocConfig } from "./subcontractor-common";
import type { BuildExtras, ContextObject, ContextValue, DocumentContract, FieldDef, Scenario, TableDef, TemplateContext } from "./tipler";
import { headFields } from "./warehouse-common";

type Row = Record<string, unknown>;

const TITLE = "KALİTE SERTİFİKASI";
const SECTIONS = {
  taxNo: true, customerCode: true, shipmentNo: true, date: true, orderNos: true, gradeSummary: true, rollDetail: true, declaration: true,
} as const;

const GRADE_TABLE: TableDef = {
  anahtar: "kaliteler",
  etiket: "Kalite dağılımı",
  kolonlar: [
    { yol: "kalite", etiket: "Kalite", tur: "metin", sinif: "musteri", ornek: SAMPLE_GRADE_LABEL, hiza: "l", kaynakKolon: "grade" },
    { yol: "top_adedi", etiket: "Top adedi", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 4, hiza: "r", kaynakKolon: "rollCount", toplam: "top_adedi" },
    { yol: "metre", etiket: "Toplam metre", tur: "sayi", ondalik: 2, birim: "m", sinif: "musteri", ornek: 620, hiza: "r", kaynakKolon: "totalMeters", toplam: "metre" },
  ],
};

const ROLL_TABLE: TableDef = {
  anahtar: "toplar",
  etiket: "Top dökümü",
  kolonlar: [
    { yol: "sira", etiket: "Sıra", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1, hiza: "c", kaynakKolon: "seq" },
    { yol: "barkod", etiket: "Barkod", tur: "metin", sinif: "musteri", ornek: "TR-260607-R0200", hiza: "l", kaynakKolon: "barcode" },
    { yol: "urun", etiket: "Ürün", tur: "metin", sinif: "musteri", ornek: "Pamuklu Astar", hiza: "l", kaynakKolon: "itemColor" },
    { yol: "renk", etiket: "Renk (ürünle aynı hücrede)", tur: "metin", sinif: "musteri", ornek: "Bej", hiza: "l" },
    { yol: "en", etiket: "En", tur: "sayi", ondalik: 0, birim: "cm", sinif: "musteri", ornek: 150, hiza: "c", kaynakKolon: "width" },
    { yol: "kalite", etiket: "Kalite", tur: "metin", sinif: "musteri", ornek: SAMPLE_GRADE_LABEL, hiza: "c", kaynakKolon: "grade" },
    { yol: "metre", etiket: "Metre", tur: "sayi", ondalik: 2, birim: "m", sinif: "musteri", ornek: 160, hiza: "r", kaynakKolon: "meters" },
  ],
};

const TEXT = { t: "text" } as const;
/** Renderer kolonlarının eşi (anahtar/başlık/hiza) — kolon düzeni renderer'ın çözücüsünden. */
const GRADE_SPECS: DocColSpec<never>[] = [
  { key: "grade", label: "KALİTE", align: "l", kind: TEXT, value: () => null },
  { key: "rollCount", label: "TOP ADEDİ", align: "r", kind: TEXT, value: () => null, foot: { value: null } },
  { key: "totalMeters", label: "TOPLAM METRE", align: "r", kind: { t: "num", dec: 2 }, value: () => null, foot: { value: null } },
];
const ROLL_SPECS: DocColSpec<never>[] = [
  { key: "seq", label: "#", align: "c", width: "34px", kind: TEXT, value: () => null },
  { key: "barcode", label: "BARKOD", align: "l", cellClass: "mono", kind: TEXT, value: () => null },
  { key: "itemColor", label: "ÜRÜN / RENK", align: "l", kind: TEXT, value: () => null },
  { key: "width", label: "EN", align: "c", width: "60px", kind: { t: "int", suffix: " cm" }, value: () => null },
  { key: "grade", label: "KALİTE", align: "c", width: "70px", kind: TEXT, value: () => null },
  { key: "meters", label: "METRE", align: "r", width: "80px", kind: { t: "num", dec: 2 }, value: () => null },
];

const ROOT_FIELDS: FieldDef[] = [
  ...headFields("Sevkiyat no", sampleSeriesCode("shipment", 1), TITLE, "QUALITY_CERTIFICATE"),
  { yol: "belge.siparis_nolari", etiket: "Sipariş no(ları)", tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("order", 1) },
  { yol: "karsi_taraf.ad", etiket: "Müşteri adı", tur: "metin", sinif: "musteri", ornek: "Örnek Tekstil A.Ş." },
  { yol: "karsi_taraf.kod", etiket: "Müşteri kodu", tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("customer", 1) },
  ...COMPANY_FIELDS,
  { yol: "toplamlar.top_adedi", etiket: "Top adedi (sevkiyat)", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 5 },
  { yol: "toplamlar.metre", etiket: "Toplam metre (brüt sevk)", tur: "sayi", ondalik: 2, birim: "m", sinif: "musteri", ornek: 680 },
  ...PRINT_FIELDS,
];

export type QualityCertificateConfig = BaseDocConfig;

export function normalizeQualityCertificateConfig(raw: unknown): QualityCertificateConfig {
  const base = normalizeBase(sanitizeRawConfig(raw), {
    sections: SECTIONS,
    signatureDefaults: ["Kalite Sorumlusu", "Teslim Alan"],
    marginMm: 9,
    tables: ["gradeSummary", "rollDetail"],
  });
  return {
    ...base,
    kolonlar: {
      kaliteler: resolveColumns(GRADE_TABLE, GRADE_SPECS, base.columns.gradeSummary!),
      toplar: resolveColumns(ROLL_TABLE, ROLL_SPECS, base.columns.rollDetail!),
    },
  };
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  const config = normalizeQualityCertificateConfig(rawConfig);
  const optIn = new Set(internalFields);
  const doc = asObject(snapshot?.doc);
  const h = asObject(doc.header);
  const totals = asObject(doc.totals);
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject =>
    fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);
  const grades = asRows(doc.grades).map((g) =>
    fillFields(GRADE_TABLE.kolonlar, { kalite: asText(g.grade), top_adedi: asNumber(g.rollCount), metre: asNumber(g.totalMeters) }, optIn),
  );
  const rolls = asRows(doc.rolls).map((r) =>
    fillFields(
      ROLL_TABLE.kolonlar,
      {
        sira: asNumber(r.sequence), barkod: asText(r.barcode), urun: asText(r.itemName), renk: asText(r.colorName),
        en: asNumber(r.width), kalite: asText(r.grade), metre: asNumber(r.meters),
      },
      optIn,
    ),
  );

  return {
    belge: root("belge", {
      no: asText(h.shipmentNo),
      tur: "QUALITY_CERTIFICATE",
      baslik: docTitle(config.titleOverride, TITLE),
      tarih: asText(h.date),
      ...docStatus(extras?.baski),
      siparis_nolari: asText(h.orderNos),
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", { ad: asText(h.customerName), kod: asText(h.customerCode) }),
    tablolar: {
      antet_ek: letterheadExtraRows(snapshot).map((r) => fillFields(LETTERHEAD_EXTRA_TABLE.kolonlar, r, optIn)),
      kaliteler: grades,
      toplar: rolls,
    },
    toplamlar: root("toplamlar", { top_adedi: asNumber(totals.rollCount), metre: asNumber(totals.totalMeters) }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("QUALITY_CERTIFICATE");
  const header = (d: Row) => d.header as Row;
  const SECOND = `${SAMPLE_GRADE_LABEL}2`;
  const roll = (i: number, grade = SAMPLE_GRADE_LABEL, width: number | null = 150, meters = 100 + i): Row => ({
    sequence: i, barcode: `TR-260607-R${String(200 + i).padStart(4, "0")}`, itemName: "Pamuklu Astar", colorName: "Bej", width, grade, meters,
  });
  const summarize = (d: Row, rolls: Row[]): Row => {
    const byGrade = new Map<string, { rollCount: number; totalMeters: number }>();
    for (const r of rolls) {
      const g = byGrade.get(String(r.grade)) ?? { rollCount: 0, totalMeters: 0 };
      byGrade.set(String(r.grade), { rollCount: g.rollCount + 1, totalMeters: g.totalMeters + Number(r.meters) });
    }
    const grades = [...byGrade].map(([grade, v]) => ({ grade, ...v }));
    return { ...d, grades, rolls, totals: { rollCount: rolls.length, totalMeters: grades.reduce((s, g) => s + g.totalMeters, 0) } };
  };

  const single = summarize(base(), [roll(1, SAMPLE_GRADE_LABEL, 150, 160.5)]);
  const multi = summarize(base(), Array.from({ length: 60 }, (_, i) => roll(i + 1, i % 4 === 0 ? SECOND : SAMPLE_GRADE_LABEL, i % 3 === 0 ? 149.6 : 150, 80 + (i % 7) * 12.25)));
  const empty: Row = {
    header: { shipmentNo: sampleSeriesCode("shipment", 2), customerName: "Örnek Tekstil A.Ş.", customerCode: null, date: null, orderNos: "" },
    grades: [{ grade: "", rollCount: 1, totalMeters: 0 }],
    rolls: [{ sequence: 1, barcode: null, itemName: "Tül", colorName: null, width: null, grade: "", meters: 0 }],
    totals: { rollCount: 1, totalMeters: 0 },
  };
  const noDetail = { ...base(), rolls: [] };
  const long = summarize(
    { ...base(), header: { ...header(base()), customerName: longText("Çok Uzun Adlı Müşteri Tekstil"), customerCode: "M-<01>", orderNos: longText("SIP-2026-0107", 80) } },
    [roll(1), { ...roll(2, longText("Kalite", 30), 999), itemName: longText("Süet Kumaş", 120), colorName: "Antrasit & Gri" }, roll(3, SECOND, 999.4, 1234.567)],
  );

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek sertifikası (özet top sayısı dökümden büyük)", snapshot: sampleEnvelope(base()) },
    { ad: "tek_kalem", aciklama: "Tek top, tek kalite", snapshot: sampleEnvelope(single) },
    {
      ad: "cok_sayfa",
      aciklama: "60 top, iki kalite — döküm birden çok sayfaya taşar",
      snapshot: sampleEnvelope(multi),
      ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Acil" } },
    },
    { ad: "bos_opsiyonel", aciklama: "Opsiyonel alanların tümü boş/eksik", snapshot: sampleEnvelope(empty) },
    { ad: "dokumsuz", aciklama: "Top dökümü boş — döküm tablosu hiç basılmaz", snapshot: sampleEnvelope(noDetail) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren adlar; 999 cm en sınırı", snapshot: sampleEnvelope(long) },
    {
      ad: "iptal",
      aciklama: "İptal edilmiş (VOIDED) ikinci sürüm",
      snapshot: sampleEnvelope(base()),
      ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "Yanlış sevkiyat" } },
    },
  ];
}

export const qualityCertificateContract: DocumentContract<QualityCertificateConfig, never> = {
  docType: "QUALITY_CERTIFICATE",
  hedef: "musteri",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: [LETTERHEAD_EXTRA_TABLE, GRADE_TABLE, ROLL_TABLE],
  ayarSemasi: baseConfigSchema(Object.keys(SECTIONS), [
    ["gradeSummary", "kaliteler"],
    ["rollDetail", "toplar"],
  ]),
  ayarNormalize: normalizeQualityCertificateConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
