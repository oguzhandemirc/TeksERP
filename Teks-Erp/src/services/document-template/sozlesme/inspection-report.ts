// =============================================================================
// INSPECTION_REPORT (Muayene Raporu) veri sözleşmesi — K4P-RAPOR
// =============================================================================
// Kaynak Shipment, müşteriye gider (`hedef: musteri`). Satırlar, kural bandı metni, özet ve
// dipnotlar renderer'ın (`document-render/inspection-report.html.ts`) AYNI yardımcılarından
// dolar — şablon hesap yapmaz. Operatör / istasyon / cihaz İÇ alandır: yalnız
// `internalFields` opt-in'iyle bağlama ve kolon düzenine girer (varsayılan YOK).
// =============================================================================

import type { DocColumnCfg } from "../../document-render/doc-table";
import { docTitle } from "../../document-render/doc-style";
import { docNum } from "../../document-render/fmt-num";
import {
  INSPECTION_REPORT_SIGNATURES,
  INSPECTION_REPORT_TITLE,
  bandsText,
  capText,
  inspectionFootnotes,
  resultText,
  rollColumns,
  ruleColumns,
  unitText,
  type InspectionReportDoc,
} from "../../document-render/inspection-report.html";
import type { PrintedDocSnapshot } from "../../printed-document.service";
import type { ShipmentInspectionRow, ShipmentInspectionRule } from "../../quality-inspection-shipment.service";
import {
  COMPANY_FIELDS,
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
import { headFields } from "./warehouse-common";

type Row = Record<string, unknown>;

const SECTIONS = {
  taxNo: true, customerCode: true, shipmentNo: true, date: true, orderNos: true, summary: true, ruleTable: true, rollDetail: true, footnotes: true,
} as const;

const RULE_TABLE: TableDef = {
  anahtar: "kurallar",
  etiket: "Uygulanan kural",
  kolonlar: [
    { yol: "ad", etiket: "Kural adı", tur: "metin", sinif: "musteri", ornek: "Örnek Tekstil — genel", hiza: "l", kaynakKolon: "name" },
    { yol: "birim", etiket: "Puan birimi", tur: "metin", sinif: "musteri", ornek: "100 m²", hiza: "c", kaynakKolon: "unit" },
    { yol: "tavan", etiket: "Koşu tavanı", tur: "metin", sinif: "musteri", ornek: "Metre başına en çok 4 puan", hiza: "l", kaynakKolon: "cap" },
    { yol: "bantlar", etiket: "Bantlar", tur: "metin", sinif: "musteri", ornek: "≤ 20,00 → A (kabul) · üstü → RET (ret)", hiza: "l", kaynakKolon: "bands" },
  ],
};

const ROLL_TABLE: TableDef = {
  anahtar: "toplar",
  etiket: "Top muayene dökümü",
  kolonlar: [
    { yol: "sira", etiket: "Sıra", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1, hiza: "c", kaynakKolon: "seq" },
    { yol: "barkod", etiket: "Barkod", tur: "metin", sinif: "musteri", ornek: "TR-260607-R0200", hiza: "l", kaynakKolon: "barcode" },
    { yol: "urun", etiket: "Kumaş", tur: "metin", sinif: "musteri", ornek: "Pamuklu Astar", hiza: "l", kaynakKolon: "itemColor" },
    { yol: "renk", etiket: "Renk (kumaşla aynı hücrede)", tur: "metin", sinif: "musteri", ornek: "Bej", hiza: "l" },
    { yol: "en", etiket: "En", tur: "sayi", ondalik: 0, birim: "cm", sinif: "musteri", ornek: 150, hiza: "c", kaynakKolon: "width" },
    { yol: "metre", etiket: "Metre (brüt sevk)", tur: "sayi", ondalik: 2, birim: "m", sinif: "musteri", ornek: 160, hiza: "r", kaynakKolon: "meters", toplam: "metre" },
    { yol: "hata", etiket: "Hata sayısı", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 6, hiza: "r", kaynakKolon: "defects", toplam: "hata" },
    { yol: "puan", etiket: "Puan", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 14, hiza: "r", kaynakKolon: "points", toplam: "puan" },
    { yol: "puan_100", etiket: "Puan / 100 (kural biriminde)", tur: "sayi", ondalik: 2, sinif: "musteri", ornek: 5.83, hiza: "r", kaynakKolon: "score" },
    { yol: "etiket", etiket: "Etiket (müşteri kuralı)", tur: "metin", sinif: "musteri", ornek: "A", hiza: "c", kaynakKolon: "label" },
    { yol: "sonuc", etiket: "Sonuç", tur: "metin", sinif: "musteri", ornek: "GEÇTİ", hiza: "c", kaynakKolon: "result" },
    { yol: "operator", etiket: "Muayene eden", tur: "metin", sinif: "ic", icKod: "muayene_operator", ornek: "Ayşe Yılmaz", hiza: "l", kaynakKolon: "inspector" },
    { yol: "istasyon", etiket: "İstasyon", tur: "metin", sinif: "ic", icKod: "muayene_istasyon", ornek: "Kalite Kontrol 1", hiza: "l", kaynakKolon: "station" },
    { yol: "cihaz", etiket: "Cihaz", tur: "metin", sinif: "ic", icKod: "muayene_cihaz", ornek: "KK1 Tablet", hiza: "l", kaynakKolon: "device" },
  ],
};

const NOTE_TABLE: TableDef = {
  anahtar: "dipnotlar",
  etiket: "Dipnotlar",
  kolonlar: [{ yol: "metin", etiket: "Dipnot", tur: "metin", sinif: "musteri", ornek: "En kaynağı: ürün kartı 1.", hiza: "l" }],
};

const ROOT_FIELDS: FieldDef[] = [
  ...headFields("Sevkiyat no", sampleSeriesCode("shipment", 1), INSPECTION_REPORT_TITLE, "INSPECTION_REPORT"),
  { yol: "belge.siparis_nolari", etiket: "Sipariş no(ları)", tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("order", 1) },
  { yol: "karsi_taraf.ad", etiket: "Müşteri adı", tur: "metin", sinif: "musteri", ornek: "Örnek Tekstil A.Ş." },
  { yol: "karsi_taraf.kod", etiket: "Müşteri kodu", tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("customer", 1) },
  ...COMPANY_FIELDS,
  { yol: "toplamlar.top_adedi", etiket: "Top adedi (sevkiyat)", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 3 },
  { yol: "toplamlar.muayene_edilen", etiket: "Muayene edilen top", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 2 },
  { yol: "toplamlar.muayenesiz", etiket: "Muayenesi olmayan top", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1 },
  { yol: "toplamlar.gecti", etiket: "Geçen top", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1 },
  { yol: "toplamlar.kaldi", etiket: "Kalan top", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1 },
  { yol: "toplamlar.metre", etiket: "Toplam metre (brüt sevk)", tur: "sayi", ondalik: 2, birim: "m", sinif: "musteri", ornek: 318.5 },
  { yol: "toplamlar.hata", etiket: "Toplam hata", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 21 },
  { yol: "toplamlar.puan", etiket: "Toplam puan", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 58 },
  { yol: "toplamlar.ortalama_puan_100m2", etiket: "Ortalama puan / 100 m²", tur: "sayi", ondalik: 2, sinif: "musteri", ornek: 17.81 },
  ...PRINT_FIELDS,
];

export type InspectionReportConfig = BaseDocConfig;

/** İç kolonların renderer anahtarları — opt-in kodu → `columns.toplar.shown`. */
const INTERNAL_COLUMNS = ROLL_TABLE.kolonlar.filter((c) => c.sinif === "ic");

function rollColumnCfg(config: BaseDocConfig, optIn: ReadonlySet<string>): DocColumnCfg {
  return { ...config.columns.toplar, shown: INTERNAL_COLUMNS.filter((c) => c.icKod && optIn.has(c.icKod)).map((c) => c.kaynakKolon as string) };
}

const EMPTY_DOC = { totals: { totalMeters: 0, defectCount: 0, totalPoints: 0 } } as unknown as InspectionReportDoc;

function normalizeWith(raw: unknown, optIn: ReadonlySet<string>): InspectionReportConfig {
  const base = normalizeBase(sanitizeRawConfig(raw), {
    sections: SECTIONS,
    signatureDefaults: INSPECTION_REPORT_SIGNATURES,
    marginMm: 9,
    tables: ["kurallar", "toplar"],
  });
  return {
    ...base,
    kolonlar: {
      kurallar: resolveColumns(RULE_TABLE, ruleColumns() as never, base.columns.kurallar!),
      toplar: resolveColumns(ROLL_TABLE, rollColumns(EMPTY_DOC) as never, rollColumnCfg(base as BaseDocConfig, optIn) as never),
    },
  };
}

export function normalizeInspectionReportConfig(raw: unknown): InspectionReportConfig {
  return normalizeWith(raw, new Set());
}

function ruleValues(r: ShipmentInspectionRule, fmt: (n: number, d: number) => string): Record<string, ContextValue> {
  return { ad: r.name, birim: unitText(r.unit), tavan: capText(r.runningCap), bantlar: bandsText(r, fmt) };
}

function rollValues(r: ShipmentInspectionRow): Record<string, ContextValue> {
  return {
    sira: r.sequence, barkod: r.barcode, urun: r.itemName, renk: r.colorName, en: r.widthCm, metre: r.meters,
    hata: r.defectCount, puan: r.totalPoints, puan_100: r.score, etiket: r.label, sonuc: resultText(r.result),
    operator: r.inspectorName, istasyon: r.stationName, cihaz: r.deviceName,
  };
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  const optIn = new Set(internalFields);
  const config = normalizeWith(rawConfig, optIn);
  const doc = asObject(snapshot?.doc) as unknown as InspectionReportDoc;
  const h = doc.header;
  const t = doc.totals;
  const fmt = (n: number, d: number) => docNum(snapshot).tr(n, d);
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject =>
    fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);

  return {
    belge: root("belge", {
      no: h.shipmentNo,
      tur: "INSPECTION_REPORT",
      baslik: docTitle(config.titleOverride, INSPECTION_REPORT_TITLE),
      tarih: h.date,
      ...docStatus(extras?.baski),
      siparis_nolari: h.orderNos,
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", { ad: h.customerName, kod: h.customerCode }),
    tablolar: {
      antet_ek: letterheadExtraRows(snapshot).map((r) => fillFields(LETTERHEAD_EXTRA_TABLE.kolonlar, r, optIn)),
      kurallar: (doc.rules ?? []).map((r) => fillFields(RULE_TABLE.kolonlar, ruleValues(r, fmt), optIn)),
      toplar: (doc.rows ?? []).map((r) => fillFields(ROLL_TABLE.kolonlar, rollValues(r), optIn)),
      dipnotlar: inspectionFootnotes(doc).map((metin) => fillFields(NOTE_TABLE.kolonlar, { metin }, optIn)),
    },
    toplamlar: root("toplamlar", {
      top_adedi: t.rollCount, muayene_edilen: t.inspectedCount, muayenesiz: t.uninspectedCount, gecti: t.passCount, kaldi: t.failCount,
      metre: t.totalMeters, hata: t.defectCount, puan: t.totalPoints, ortalama_puan_100m2: t.avgPointsPer100M2,
    }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: Object.fromEntries(INTERNAL_COLUMNS.map((c) => [c.icKod as string, optIn.has(c.icKod as string)])),
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("INSPECTION_REPORT") as unknown as InspectionReportDoc;
  const rowsOf = (d: InspectionReportDoc) => d.rows;
  const withRows = (d: InspectionReportDoc, rows: ShipmentInspectionRow[]): InspectionReportDoc => {
    const inspected = rows.filter((r) => r.inspectionId);
    return {
      ...d,
      rows: rows.map((r, i) => ({ ...r, sequence: i + 1 })),
      totals: {
        ...d.totals,
        rollCount: rows.length, inspectedCount: inspected.length, uninspectedCount: rows.length - inspected.length,
        passCount: rows.filter((r) => r.result === "PASS").length, failCount: rows.filter((r) => r.result === "FAIL").length,
        totalMeters: rows.reduce((s, r) => s + r.meters, 0),
        defectCount: inspected.reduce((s, r) => s + (r.defectCount ?? 0), 0),
        totalPoints: inspected.reduce((s, r) => s + (r.totalPoints ?? 0), 0),
      },
    };
  };
  const env = (d: InspectionReportDoc) => sampleEnvelope(d as unknown as Row);
  const [pass, fail, none] = rowsOf(base());

  const single = withRows(base(), [pass!]);
  const multi = withRows(base(), Array.from({ length: 60 }, (_, i) => ({ ...(i % 5 === 0 ? fail! : i % 7 === 0 ? none! : pass!), barcode: `TR-260607-R${String(300 + i).padStart(4, "0")}`, meters: 80 + (i % 7) * 12.25 })));
  const empty: InspectionReportDoc = {
    header: { ...base().header, customerCode: null, orderNos: "" },
    rules: [],
    rows: [{ ...none!, barcode: null, colorName: null }],
    totals: { rollCount: 1, inspectedCount: 0, uninspectedCount: 1, passCount: 0, failCount: 0, noScoreCount: 0, totalMeters: 0, defectCount: 0, totalPoints: 0, unplacedDefectCount: 0, avgPointsPer100M2: null },
    notes: { unplacedRollCount: 0, widthSources: {} },
  };
  const longRule = { ...base().rules[0]!, name: longText("Müşteri spesifikasyonu", 90) };
  const long: InspectionReportDoc = {
    ...withRows(base(), [pass!, { ...fail!, itemName: longText("Süet Kumaş", 120), colorName: "Antrasit & Gri", widthCm: 999.4, label: longText("ET", 16) }, { ...pass!, result: "NO_SCORE", score: null, label: null, widthCm: null, widthSource: "UNKNOWN" }]),
    header: { ...base().header, customerName: longText("Çok Uzun Adlı Müşteri Tekstil"), customerCode: "M-<01>", orderNos: longText("SIP-2026-0107", 80) },
    rules: [longRule, { ...base().rules[0]!, key: "kural-2", name: "Fabrika varsayılanı", scope: "FACTORY", unit: "YD2", runningCap: "NONE" }],
  };

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek raporu (geçen, kalan, muayenesiz top)", snapshot: env(base()) },
    { ad: "tek_kalem", aciklama: "Tek top, geçti", snapshot: env(single) },
    {
      ad: "cok_sayfa",
      aciklama: "60 top — döküm birden çok sayfaya taşar",
      snapshot: env(multi),
      ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Acil" } },
    },
    { ad: "bos_opsiyonel", aciklama: "Kural yok, tek muayenesiz top, opsiyonel alanlar boş", snapshot: env(empty) },
    { ad: "dokumsuz", aciklama: "Top dökümü boş — tablo hiç basılmaz", snapshot: env({ ...base(), rows: [] }) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren adlar; iki kural (yd²); hesaplanamayan top", snapshot: env(long) },
    {
      ad: "iptal",
      aciklama: "İptal edilmiş (VOIDED) ikinci sürüm",
      snapshot: env(base()),
      ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "Yanlış sevkiyat" } },
    },
  ];
}

export const inspectionReportContract: DocumentContract<InspectionReportConfig, never> = {
  docType: "INSPECTION_REPORT",
  hedef: "musteri",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: [LETTERHEAD_EXTRA_TABLE, RULE_TABLE, ROLL_TABLE, NOTE_TABLE],
  ayarSemasi: baseConfigSchema(Object.keys(SECTIONS), [
    ["kurallar", "kurallar"],
    ["toplar", "toplar"],
  ]),
  ayarNormalize: normalizeInspectionReportConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
