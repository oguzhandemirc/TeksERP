// =============================================================================
// RETURN_DISPATCH (İade İrsaliyesi) veri sözleşmesi
// =============================================================================
// Sistem renderer'ı (`document-render/return-dispatch.html.ts`) DEĞİŞMEZ ve yalnız okunur.
// İade AYRI belgedir (storno ≠ iade); müşteriye gider (`hedef: musteri`), müşteri `karsi_taraf`.
// Eski tekil snapshot (`line`) ile çok kalemli (`lines`) ayrımı ve toplamlar burada çözülür;
// şablon hesap yapmaz. Renderer'da opt-in iç kolon yok → iç alan beyanı yok. İade dipnotu
// (`shipping.returnFootnote`) snapshot'ta donar; eski/dipnotsuz snapshot'ta alan boştur.
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

const TITLE = "İADE İRSALİYESİ";
const SECTIONS = { taxNo: true, customerCode: true, documentNo: true, date: true, references: true, rollTable: true, reason: true } as const;

const ROLL_TABLE: TableDef = {
  anahtar: "toplar",
  etiket: "İade edilen toplar",
  kolonlar: [
    { yol: "barkod", etiket: "Barkod", tur: "metin", sinif: "musteri", ornek: "TR-260607-R0200", hiza: "l", kaynakKolon: "barcode" },
    { yol: "urun", etiket: "Ürün", tur: "metin", sinif: "musteri", ornek: "Pamuklu Astar", hiza: "l", kaynakKolon: "itemColor" },
    { yol: "renk", etiket: "Renk (ürünle aynı hücrede)", tur: "metin", sinif: "musteri", ornek: "Bej", hiza: "l" },
    { yol: "en", etiket: "En", tur: "sayi", ondalik: 0, birim: "cm", sinif: "musteri", ornek: 150, hiza: "c", kaynakKolon: "width" },
    { yol: "kalite", etiket: "Kalite", tur: "metin", sinif: "musteri", ornek: SAMPLE_GRADE_LABEL, hiza: "c", kaynakKolon: "grade" },
    { yol: "metre", etiket: "Metre", tur: "sayi", ondalik: 2, birim: "m", sinif: "musteri", ornek: 160, hiza: "r", kaynakKolon: "qty", toplam: "metre" },
  ],
};

const TEXT = { t: "text" } as const;
/** Renderer kolonlarının eşi (anahtar/başlık/hiza) — kolon düzeni renderer'ın çözücüsünden. */
const ROLL_SPECS: DocColSpec<never>[] = [
  { key: "barcode", label: "BARKOD", align: "l", cellClass: "mono", kind: TEXT, value: () => null },
  { key: "itemColor", label: "ÜRÜN / RENK", align: "l", kind: TEXT, value: () => null },
  { key: "width", label: "EN", align: "c", width: "60px", kind: { t: "int", suffix: " cm" }, value: () => null },
  { key: "grade", label: "KALİTE", align: "c", width: "70px", kind: TEXT, value: () => null },
  { key: "qty", label: "METRE", align: "r", width: "80px", kind: { t: "num", dec: 2 }, value: () => null, foot: { value: null } },
];

const ROOT_FIELDS: FieldDef[] = [
  ...headFields("İade no", sampleSeriesCode("returnDoc", 1), TITLE, "RETURN_DISPATCH"),
  { yol: "belge.sevkiyat_no", etiket: "Geldiği sevkiyat no", tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("shipment", 1) },
  { yol: "belge.siparis_no", etiket: "Sipariş no", tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("order", 1) },
  { yol: "belge.iade_nedeni", etiket: "İade nedeni", tur: "metin", sinif: "musteri", ornek: "Renk uyumsuzluğu" },
  { yol: "belge.notlar", etiket: "Not", tur: "metin", sinif: "musteri", ornek: "Müşteri partiyle uyumsuz olduğunu bildirdi" },
  { yol: "belge.teslim_alan", etiket: "Teslim alan", tur: "metin", sinif: "musteri", ornek: "Ayşe Kaya" },
  { yol: "belge.iade_dipnotu", etiket: "İade dipnotu (ayardan, ilk basımda donar)", tur: "metin", sinif: "musteri", ornek: "İade, sevk irsaliyesini iptal etmez." },
  { yol: "karsi_taraf.ad", etiket: "Müşteri adı", tur: "metin", sinif: "musteri", ornek: "Örnek Tekstil A.Ş." },
  { yol: "karsi_taraf.kod", etiket: "Müşteri kodu", tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("customer", 1) },
  ...COMPANY_FIELDS,
  { yol: "toplamlar.top_adedi", etiket: "İade edilen top adedi", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1 },
  { yol: "toplamlar.metre", etiket: "İade edilen toplam metre", tur: "sayi", ondalik: 2, birim: "m", sinif: "musteri", ornek: 160 },
  ...PRINT_FIELDS,
];

export type ReturnDispatchConfig = BaseDocConfig;

export function normalizeReturnDispatchConfig(raw: unknown): ReturnDispatchConfig {
  const base = normalizeBase(sanitizeRawConfig(raw), {
    sections: SECTIONS,
    signatureDefaults: ["Teslim Eden (Müşteri)", "Teslim Alan"],
    marginMm: 9,
    tables: ["rollTable"],
  });
  return { ...base, kolonlar: { toplar: resolveColumns(ROLL_TABLE, ROLL_SPECS, base.columns.rollTable!) } };
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  const config = normalizeReturnDispatchConfig(rawConfig);
  const optIn = new Set(internalFields);
  const doc = asObject(snapshot?.doc);
  const h = asObject(doc.header);
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject =>
    fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);
  // Çok kalemli iade `lines`; eski/tekil snapshot `[line]` (renderer'la aynı seçim).
  const multi = asRows(doc.lines);
  const lines = multi.length ? multi : [asObject(doc.line)];
  const rows = lines.map((l) =>
    fillFields(
      ROLL_TABLE.kolonlar,
      { barkod: asText(l.barcode), urun: asText(l.itemName), renk: asText(l.colorName), en: asNumber(l.width), kalite: asText(l.grade), metre: asNumber(l.qty) },
      optIn,
    ),
  );

  return {
    belge: root("belge", {
      no: asText(h.documentNo),
      tur: "RETURN_DISPATCH",
      baslik: docTitle(config.titleOverride, TITLE),
      tarih: asText(h.date),
      ...docStatus(extras?.baski),
      sevkiyat_no: asText(h.fromShipmentNo),
      siparis_no: asText(h.orderNo),
      iade_nedeni: asText(doc.reason),
      notlar: asText(doc.note),
      teslim_alan: asText(doc.receivedBy),
      iade_dipnotu: asText(doc.footnote),
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", { ad: asText(h.customerName), kod: asText(h.customerCode) }),
    tablolar: { antet_ek: letterheadExtraRows(snapshot).map((r) => fillFields(LETTERHEAD_EXTRA_TABLE.kolonlar, r, optIn)), toplar: rows },
    toplamlar: root("toplamlar", { top_adedi: lines.length, metre: lines.reduce((s, l) => s + (Number(l.qty) || 0), 0) }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("RETURN_DISPATCH");
  const header = (d: Row) => d.header as Row;
  const line = (i: number, width: number | null = 150, qty = 100 + i): Row => ({
    barcode: `TR-260607-R${String(200 + i).padStart(4, "0")}`, itemName: "Pamuklu Astar", colorName: "Bej", width, qty, grade: SAMPLE_GRADE_LABEL,
  });

  const multi = base();
  multi.lines = Array.from({ length: 60 }, (_, i) => line(i + 1, i % 3 === 0 ? 149.6 : 150, 80 + (i % 7) * 12.25));
  const twoLines = base();
  twoLines.lines = [line(1), line(2, 140, 60.5)];
  const empty: Row = {
    header: { documentNo: sampleSeriesCode("returnDoc", 2), customerName: "Örnek Tekstil A.Ş.", customerCode: null, date: null, fromShipmentNo: null, orderNo: null },
    line: { barcode: null, itemName: "Tül", colorName: null, width: null, qty: 0, grade: "" },
    reason: null,
    note: null,
    receivedBy: "Ayşe Kaya",
  };
  const onlyNote = { ...base(), reason: null, receivedBy: null, header: { ...header(base()), orderNo: null } };
  const long = base();
  long.header = { ...header(long), customerName: longText("Çok Uzun Adlı Müşteri Tekstil"), customerCode: "M-<01>", fromShipmentNo: "SVK-<42>" };
  long.reason = longText("Renk uyumsuzluğu");
  long.note = longText("Müşteri partiyle uyumsuz olduğunu bildirdi", 120);
  long.lines = [line(1), { ...line(2, 999), itemName: longText("Süet Kumaş", 120), colorName: "Antrasit & Gri" }, line(3, 999.4, 1234.567)];

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek iadesi (eski tekil snapshot biçimi)", snapshot: sampleEnvelope(base()) },
    { ad: "tek_kalem", aciklama: "Tek top — toplam satırı yok", snapshot: sampleEnvelope(base()) },
    { ad: "iki_kalem", aciklama: "İki top — toplam satırı ve çoğul başlık", snapshot: sampleEnvelope(twoLines) },
    {
      ad: "cok_sayfa",
      aciklama: "60 top çuval iadesi — liste birden çok sayfaya taşar",
      snapshot: sampleEnvelope(multi),
      ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Acil" } },
    },
    { ad: "bos_opsiyonel", aciklama: "Opsiyonel alanların tümü boş/eksik; neden/not yokken teslim alan basılmaz", snapshot: sampleEnvelope(empty) },
    { ad: "yalniz_not", aciklama: "Nedensiz, yalnız notlu iade; tek referans", snapshot: sampleEnvelope(onlyNote) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren adlar; 999 cm en sınırı", snapshot: sampleEnvelope(long) },
    { ad: "dipnotlu", aciklama: "Ayardan donmuş iade dipnotu (kaçış gerektiren metin)", snapshot: sampleEnvelope({ ...base(), footnote: "İade <sevk> irsaliyesini iptal etmez & brüt sevk değişmez." }) },
    {
      ad: "iptal",
      aciklama: "İptal edilmiş (VOIDED) ikinci sürüm",
      snapshot: sampleEnvelope(base()),
      ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "İade geri alındı" } },
    },
  ];
}

export const returnDispatchContract: DocumentContract<ReturnDispatchConfig, never> = {
  docType: "RETURN_DISPATCH",
  hedef: "musteri",
  contractVersion: 2, // 2: belge.iade_dipnotu (ayardan donan iade dipnotu)
  kokler: ROOT_FIELDS,
  tablolar: [LETTERHEAD_EXTRA_TABLE, ROLL_TABLE],
  ayarSemasi: baseConfigSchema(Object.keys(SECTIONS), [["rollTable", "toplar"]]),
  ayarNormalize: normalizeReturnDispatchConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
