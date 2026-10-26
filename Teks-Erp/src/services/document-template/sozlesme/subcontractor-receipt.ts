// =============================================================================
// SUBCONTRACTOR_RECEIPT (Fason Kabul Makbuzu) veri sözleşmesi
// =============================================================================
// Sistem renderer'ı (`document-render/fason-receipt.html.ts`) DEĞİŞMEZ ve burada YALNIZ
// OKUNUR. Fasoncu kimliği `karsi_taraf`tır. Belge fasoncuyla mutabakat tutanağıdır (dış
// taraf) ve renderer'da opt-in iç kolon YOK → `hedef: musteri`, iç alan beyanı yok.
// Metre kolonu VERİDEN doğar: `rolls[].qty` taşımayan (eski) snapshot'ta kolon ayardan da düşer.
// =============================================================================

import { TERIM } from "../../../constants/terim";
import type { DocColSpec } from "../../document-render/doc-model";
import { docTitle } from "../../document-render/doc-style";
import type { PrintedDocSnapshot } from "../../printed-document.service";
import {
  COMPANY_FIELDS,
  DOC_STATUS_FIELDS,
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
import {
  baseConfigSchema,
  normalizeBase,
  plainJson,
  resolveColumns,
  sanitizeRawConfig,
  type BaseDocConfig,
} from "./subcontractor-common";
import type { BuildExtras, ContextObject, ContextValue, DocumentContract, FieldDef, Scenario, TableDef, TemplateContext } from "./tipler";

type Row = Record<string, unknown>;

/** Renderer `sectionOn` okuduğu bölümler — hepsi blocklist (anahtar yoksa AÇIK). */
export const RECEIPT_SECTIONS = {
  taxNo: true,
  receiptNo: true,
  date: true,
  notes: true,
  subcontractorInfo: true,
  appliedInfo: true,
  batchInfo: true,
  rollTable: true,
} as const;

const TABLES = ["rollTable"] as const;

export type ReceiptConfig = BaseDocConfig;

const ROOT_FIELDS: FieldDef[] = [
  { yol: "belge.no", etiket: "Makbuz no", tur: "metin", sinif: "musteri", ornek: "SR-2606-000045" },
  { yol: "belge.tur", etiket: "Belge türü", tur: "metin", sinif: "musteri", ornek: "SUBCONTRACTOR_RECEIPT" },
  { yol: "belge.baslik", etiket: "Belge başlığı", tur: "metin", sinif: "musteri", ornek: "FASON KABUL MAKBUZU" },
  { yol: "belge.tarih", etiket: "Kabul tarihi", tur: "tarih", sinif: "musteri", ornek: "2026-09-25T08:30:00.000Z" },
  ...DOC_STATUS_FIELDS,
  { yol: "belge.fason_irsaliye_no", etiket: "Fasoncunun irsaliye no", tur: "metin", sinif: "musteri", ornek: "YB-8842" },
  { yol: "belge.is_emri_no", etiket: `${TERIM.terbiyeIsEmri.tekil} no`, tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("workOrder", 1) },
  { yol: "belge.islem", etiket: "İşlem (istasyon)", tur: "metin", sinif: "musteri", ornek: "Boyahane (Fason)" },
  { yol: "belge.uygulanan_renk", etiket: "Uygulanan renk", tur: "metin", sinif: "musteri", ornek: "Bej" },
  { yol: "belge.notlar", etiket: "Kabul notu", tur: "metin", sinif: "musteri", ornek: "Renk tutmuş" },
  ...COMPANY_FIELDS,
  { yol: "karsi_taraf.ad", etiket: "Fasoncu adı", tur: "metin", sinif: "musteri", ornek: "Yıldız Boyahane" },
  { yol: "karsi_taraf.kod", etiket: "Fasoncu kodu", tur: "metin", sinif: "musteri", ornek: "FB-03" },
  { yol: "toplamlar.top_adedi", etiket: "Kabul edilen top", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 2 },
  { yol: "toplamlar.metre", etiket: "Kabul edilen metre (defter)", tur: "sayi", ondalik: 2, birim: "m", sinif: "musteri", ornek: 320 },
  { yol: "toplamlar.donen_metre", etiket: "Dönen metre (ölçülen)", tur: "sayi", ondalik: 2, birim: "m", sinif: "musteri", ornek: 304.5 },
  ...PRINT_FIELDS,
];

const ROLL_TABLE: TableDef = {
  anahtar: "toplar",
  etiket: "Kabul edilen toplar",
  kolonlar: [
    { yol: "sira", etiket: "Sıra", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1, hiza: "c", kaynakKolon: "seq" },
    { yol: "barkod", etiket: "Barkod", tur: "metin", sinif: "musteri", ornek: "TR-260607-R0301", hiza: "l", kaynakKolon: "barcode" },
    { yol: "urun", etiket: "Ürün", tur: "metin", sinif: "musteri", ornek: "Pamuklu Astar", hiza: "l", kaynakKolon: "itemColor" },
    { yol: "renk", etiket: "Renk (ürünle aynı hücrede)", tur: "metin", sinif: "musteri", ornek: "Bej", hiza: "l" },
    { yol: "en", etiket: "En", tur: "sayi", ondalik: 0, birim: "cm", sinif: "musteri", ornek: 150, hiza: "c", kaynakKolon: "width" },
    { yol: "metre", etiket: "Kabul metre (defter)", tur: "sayi", ondalik: 2, birim: "m", sinif: "musteri", ornek: 160, hiza: "r", kaynakKolon: "qty", toplam: "metre" },
  ],
};

const TABLE_DEFS: TableDef[] = [
  LETTERHEAD_EXTRA_TABLE,
  ROLL_TABLE,
  {
    anahtar: "parti",
    etiket: "Dönen partiler",
    kolonlar: [{ yol: "no", etiket: "Parti no", tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("batchDaily", 1), hiza: "l" }],
  },
  {
    anahtar: "ozellik",
    etiket: "Uygulanan özellikler",
    kolonlar: [{ yol: "ad", etiket: "Özellik", tur: "metin", sinif: "musteri", ornek: "Su İtici", hiza: "l" }],
  },
];

/** Renderer kolonlarının eşi (anahtar/başlık/hiza) — kolon düzeni renderer'ın çözücüsünden. */
const TEXT = { t: "text" } as const;
const ROLL_SPECS: DocColSpec<never>[] = [
  { key: "seq", label: "#", align: "c", width: "34px", kind: { t: "int" }, value: () => null },
  { key: "barcode", label: "BARKOD", align: "l", cellClass: "mono", kind: TEXT, value: () => null },
  { key: "itemColor", label: "ÜRÜN / RENK", align: "l", kind: TEXT, value: () => null },
  { key: "width", label: "EN", align: "c", width: "70px", kind: { t: "int", suffix: " cm" }, value: () => null },
  { key: "qty", label: "METRE", align: "r", width: "80px", kind: { t: "num", dec: 2 }, value: () => null, foot: { value: null } },
];

export function normalizeReceiptConfig(raw: unknown): ReceiptConfig {
  const base = normalizeBase(sanitizeRawConfig(raw), {
    sections: RECEIPT_SECTIONS,
    signatureDefaults: ["Teslim Eden (Fason)", "Teslim Alan"],
    marginMm: 9,
    tables: TABLES,
  });
  return { ...base, kolonlar: { toplar: resolveColumns(ROLL_TABLE, ROLL_SPECS, base.columns.rollTable!) } };
}

function buildContext(
  snapshot: PrintedDocSnapshot,
  rawConfig: unknown,
  internalFields: readonly string[],
  extras?: BuildExtras<never>,
): TemplateContext {
  const config = normalizeReceiptConfig(rawConfig);
  const optIn = new Set(internalFields);
  const doc = asObject(snapshot?.doc);
  const sub = asObject(doc.subcontractor);
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject =>
    fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);
  const rows = (t: TableDef, values: Record<string, ContextValue | undefined>[]): ContextObject[] =>
    values.map((r) => fillFields(t.kolonlar, r, optIn));
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  // Renderer'ın aynası: `qty` anahtarı hiçbir satırda yoksa (eski snapshot) metre kolonu yok.
  const rollRows = asRows(doc.rolls);
  const hasQty = rollRows.some((r) => r.qty !== undefined);
  const kolonlar = hasQty ? config.kolonlar : { ...config.kolonlar, toplar: (config.kolonlar.toplar ?? []).filter((k) => k.kaynak !== "qty") };

  return {
    belge: root("belge", {
      no: asText(doc.receiptNo),
      tur: "SUBCONTRACTOR_RECEIPT",
      baslik: docTitle(config.titleOverride, "FASON KABUL MAKBUZU"),
      tarih: asText(doc.receivedAt),
      ...docStatus(extras?.baski),
      fason_irsaliye_no: asText(doc.manifestNo),
      is_emri_no: asText(asObject(doc.workOrder).workOrderNumber),
      islem: asText(doc.stationName),
      uygulanan_renk: asText(doc.appliedColor),
      notlar: asText(doc.notes),
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", { ad: asText(sub.name), kod: asText(sub.code) }),
    tablolar: {
      antet_ek: rows(LETTERHEAD_EXTRA_TABLE, letterheadExtraRows(snapshot)),
      toplar: rows(
        ROLL_TABLE,
        rollRows.map((r) => ({
          sira: asNumber(r.sequence),
          barkod: asText(r.barcode),
          urun: asText(r.itemName),
          renk: asText(r.colorName),
          en: asNumber(r.width),
          metre: asNumber(r.qty),
        })),
      ),
      parti: rows(TABLE_DEFS[2]!, strings(doc.batchNumbers).map((no) => ({ no }))),
      ozellik: rows(TABLE_DEFS[3]!, strings(doc.appliedProperties).map((ad) => ({ ad }))),
    },
    toplamlar: root("toplamlar", {
      top_adedi: asNumber(asObject(doc.totals).rollCount),
      metre: asNumber(asObject(doc.totals).qty),
      // Ölçülen (fiziksel) dönen metre — defter `metre`den ayrı; eski snapshot'ta yok → nil.
      donen_metre: asNumber(asObject(doc.totals).returnedQty),
    }),
    ayar: plainJson({ ...config, kolonlar }) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("SUBCONTRACTOR_RECEIPT");
  const roll = (i: number, width: number | null = 150, qty: number | null = 100 + i): Row => ({
    sequence: i, barcode: `TR-260607-R${String(300 + i).padStart(4, "0")}`, itemName: "Pamuklu Astar", colorName: "Bej", width, qty,
  });
  const qtySum = (rs: Row[]): number => Math.round(rs.reduce((s, r) => s + (typeof r.qty === "number" ? r.qty : 0), 0) * 1000) / 1000;

  const single = base();
  single.rolls = [roll(1)];
  // Çekmeli dönüş: defter 101, ölçülen 98,5.
  single.totals = { rollCount: 1, qty: qtySum(single.rolls as Row[]), returnedQty: 98.5 };
  single.batchNumbers = [sampleSeriesCode("batchDaily", 1)];

  const multi = base();
  multi.rolls = Array.from({ length: 60 }, (_, i) => roll(i + 1, i % 3 === 0 ? 149.6 : 150, 80 + (i % 7) * 12.25));
  multi.totals = { rollCount: 60, qty: qtySum(multi.rolls as Row[]) };

  // Eski donmuş makbuzun şekli: parti yok, opsiyonel alanlar boş, top eni/barkodu yok.
  const empty: Row = {
    receiptNo: "SR-2606-000046", manifestNo: null, receivedAt: null, notes: null,
    subcontractor: { name: "Boş Alanlı Fasoncu", code: null }, workOrder: { workOrderNumber: sampleSeriesCode("workOrder", 2) },
    stationName: "Zımpara (Fason)", appliedColor: null, appliedProperties: [],
    rolls: [{ sequence: 1, barcode: null, itemName: "Pamuklu Astar", colorName: null, width: null }],
    totals: { rollCount: 1 },
  };

  const long = base();
  long.subcontractor = { name: longText("Çok Uzun Unvanlı Boyahane Apre Terbiye Sanayi"), code: "FB-<03>" };
  long.notes = longText("Renk tutmuş, apre uygulanmış; iki top kenar kırık");
  long.appliedProperties = ["Yanmazlık Apresi", longText("Su İtici", 80)];
  // Dördüncü satır eski defter satırı (receivedQty NULL) → hücre "—", toplam yalnız bilinenler.
  long.rolls = [...(long.rolls as Row[]), { ...roll(3, 999, 1234.567), itemName: longText("Süet Kumaş", 120) }, roll(4, 999.4, null)];
  long.totals = { rollCount: 4, qty: qtySum(long.rolls as Row[]) };

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek makbuzu", snapshot: sampleEnvelope(base()) },
    { ad: "tek_kalem", aciklama: "Tek top, tek parti", snapshot: sampleEnvelope(single) },
    {
      ad: "cok_sayfa",
      aciklama: "60 top — liste birden çok sayfaya taşar",
      snapshot: sampleEnvelope(multi),
      ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Acil" } },
    },
    { ad: "bos_opsiyonel", aciklama: "Opsiyonel alanların tümü boş/eksik", snapshot: sampleEnvelope(empty) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren adlar; 999 cm en sınırı", snapshot: sampleEnvelope(long) },
    {
      ad: "iptal",
      aciklama: "İptal edilmiş (VOIDED) ikinci sürüm",
      snapshot: sampleEnvelope(base()),
      ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "Yanlış fasoncu" } },
    },
  ];
}

export const subcontractorReceiptContract: DocumentContract<ReceiptConfig, never> = {
  docType: "SUBCONTRACTOR_RECEIPT",
  hedef: "musteri",
  contractVersion: 3, // 2: toplar[].metre + toplamlar.metre (kabul defteri metresi) · 3: toplamlar.donen_metre (ölçülen)
  kokler: ROOT_FIELDS,
  tablolar: TABLE_DEFS,
  ayarSemasi: baseConfigSchema(Object.keys(RECEIPT_SECTIONS), [["rollTable", "toplar"]]),
  ayarNormalize: normalizeReceiptConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
