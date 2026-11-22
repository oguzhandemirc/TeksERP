// =============================================================================
// BEAM_BODY_STATEMENT (Gövde Mutabakatı) veri sözleşmesi — devere S6 tasarımcı eşleniği
// =============================================================================
// Devereciye gider (`hedef: musteri`); devereci `karsi_taraf`. Fiyat/ücret payload'da YOKTUR. Tek iç
// alan gövde notudur: Sistem'de `sections.internalNotes === true` ile açılır, tasarımcıda tek kapı
// `internalFields` (`govde_notu`; kopyada `sistemIcAlanlari` taşır). Özet satırları, tarih/yön
// metinleri renderer'ın AYNI yardımcılarından — şablon hesap yapmaz.
// =============================================================================

import { docTitle } from "../../document-render/doc-style";
import {
  BEAM_BODY_STATEMENT_DIRECTION_LABELS,
  BEAM_BODY_STATEMENT_SIGNATURES,
  BEAM_BODY_STATEMENT_TITLE,
  beamBodyStatementBodyColumns,
  beamBodyStatementMoveColumns,
  beamBodyStatementSummary,
  type BeamBodyStatementBody,
  type BeamBodyStatementDoc,
  type BeamBodyStatementMove,
} from "../../document-render/beam-body-statement.html";
import { fmtDate } from "../../document-render/fmt-date";
import type { PrintedDocSnapshot } from "../../printed-document.service";
import {
  COMPANY_FIELDS,
  DOC_STATUS_FIELDS,
  LETTERHEAD_EXTRA_TABLE,
  PRINT_FIELDS,
  asObject,
  asRows,
  companyRoot,
  docStatus,
  fillFields,
  letterheadExtraRows,
  printRoot,
  rootFields,
} from "./ortak";
import { longText, sampleDoc, sampleEnvelope } from "./senaryolar";
import { baseConfigSchema, normalizeBase, plainJson, resolveColumns, sanitizeRawConfig, type BaseDocConfig, type ColumnConfig } from "./subcontractor-common";
import type { BuildExtras, ContextObject, ContextValue, DocumentContract, FieldDef, Scenario, TableDef, TemplateContext } from "./tipler";

type Row = Record<string, unknown>;

/** `internalNotes` burada YOK: iç kolonun tasarımcıdaki tek kapısı `internalFields`. */
const SECTIONS = { taxNo: true, subcontractorCode: true, date: true, summary: true, bodyTable: true, moveTable: true } as const;

/** Gövde notu opt-in kodu (Sistem: `sections.internalNotes`). */
export const BODY_NOTE_CODE = "govde_notu";

const BODY_TABLE: TableDef = {
  anahtar: "govdeler",
  etiket: "Deverecideki gövdeler",
  kolonlar: [
    { yol: "sira", etiket: "Sıra", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1, hiza: "c", kaynakKolon: "seq" },
    { yol: "govde_no", etiket: "Gövde no", tur: "metin", sinif: "musteri", ornek: "G-27", hiza: "l", kaynakKolon: "bodyNo" },
    { yol: "durum", etiket: "Durum (Boş · Dolu — levent no)", tur: "metin", sinif: "musteri", ornek: "Boş", hiza: "l", kaynakKolon: "state" },
    { yol: "sahibi", etiket: "Sahibi (bizim gövdede \"Bizim\")", tur: "metin", sinif: "musteri", ornek: "Bizim", hiza: "l", kaynakKolon: "owner" },
    { yol: "tarih", etiket: "Bu duruma girdiği an", tur: "tarih", sinif: "musteri", ornek: "2026-05-20T08:00:00.000Z", hiza: "c", kaynakKolon: "since" },
    { yol: "gun", etiket: "Bu durumda gün", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 18, hiza: "r", kaynakKolon: "age" },
    { yol: "notlar", etiket: "Gövde notu (iç)", tur: "metin", sinif: "ic", icKod: BODY_NOTE_CODE, ornek: "Flanş çizik", hiza: "l", kaynakKolon: "notes" },
  ],
};

const MOVE_TABLE: TableDef = {
  anahtar: "hareketler",
  etiket: "Dönem hareketleri",
  kolonlar: [
    { yol: "sira", etiket: "Sıra", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1, hiza: "c", kaynakKolon: "seq" },
    { yol: "tarih", etiket: "Tarih", tur: "tarih", sinif: "musteri", ornek: "2026-05-20T08:00:00.000Z", hiza: "c", kaynakKolon: "date" },
    { yol: "govde_no", etiket: "Gövde no", tur: "metin", sinif: "musteri", ornek: "G-27", hiza: "l", kaynakKolon: "bodyNo" },
    { yol: "yon", etiket: "Yön (Size gönderildi · Bize döndü)", tur: "metin", sinif: "musteri", ornek: "Size gönderildi", hiza: "l", kaynakKolon: "direction" },
    { yol: "yon_kodu", etiket: "Yön kodu (SENT · RETURNED)", tur: "metin", sinif: "musteri", ornek: "SENT", hiza: "l" },
    { yol: "hareket", etiket: "Hareket", tur: "metin", sinif: "musteri", ornek: "Boş gönderildi", hiza: "l", kaynakKolon: "kind" },
    { yol: "belge_no", etiket: "Belge no (yoksa boş)", tur: "metin", sinif: "musteri", ornek: "FS-0041", hiza: "l", kaynakKolon: "document" },
  ],
};

const SUMMARY_TABLE: TableDef = {
  anahtar: "ozet",
  etiket: "Özet satırları",
  kolonlar: [
    { yol: "etiket", etiket: "Özet", tur: "metin", sinif: "musteri", ornek: "Sizdeki gövde", hiza: "l" },
    { yol: "deger", etiket: "Değer", tur: "metin", sinif: "musteri", ornek: "3", hiza: "r" },
  ],
};

const ROOT_FIELDS: FieldDef[] = [
  { yol: "belge.no", etiket: "Belge no", tur: "metin", sinif: "musteri", ornek: "DEV-01" },
  { yol: "belge.tur", etiket: "Belge türü", tur: "metin", sinif: "musteri", ornek: "BEAM_BODY_STATEMENT" },
  { yol: "belge.baslik", etiket: "Belge başlığı", tur: "metin", sinif: "musteri", ornek: BEAM_BODY_STATEMENT_TITLE },
  { yol: "belge.tarih", etiket: "Mutabakat tarihi", tur: "tarih", sinif: "musteri", ornek: "2026-06-07T00:00:00.000Z" },
  ...DOC_STATUS_FIELDS,
  { yol: "belge.donem_baslangic", etiket: "Hareket döneminin ilk günü", tur: "tarih", sinif: "musteri", ornek: "2026-05-09T00:00:00.000Z" },
  { yol: "belge.donem_gun", etiket: "Hareket dönemi (gün)", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 30 },
  { yol: "belge.donem_metni", etiket: "Dönem metni (\"09.05.2026 – 07.06.2026\")", tur: "metin", sinif: "musteri", ornek: "09.05.2026 – 07.06.2026" },
  { yol: "karsi_taraf.ad", etiket: "Devereci adı", tur: "metin", sinif: "musteri", ornek: "Örnek Devere Ltd." },
  { yol: "karsi_taraf.kod", etiket: "Devereci kodu", tur: "metin", sinif: "musteri", ornek: "DEV-01" },
  ...COMPANY_FIELDS,
  { yol: "toplamlar.govde", etiket: "Sizdeki gövde", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 3 },
  { yol: "toplamlar.bizim", etiket: "Bizim gövde", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 2 },
  { yol: "toplamlar.baska", etiket: "Başka firmanın gövdesi", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1 },
  { yol: "toplamlar.dolu", etiket: "Dolu gövde", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1 },
  { yol: "toplamlar.gonderilen", etiket: "Dönemde gönderilen", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 2 },
  { yol: "toplamlar.donen", etiket: "Dönemde dönen", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1 },
  ...PRINT_FIELDS,
];

export type BeamBodyStatementConfig = BaseDocConfig;

/** Not kolonu yalnız opt-in'de; kayıtlı `columns.govdeler` değişmez (dondurulan ayar opt-in'den bağımsız). */
function bodyColumnCfg(c: ColumnConfig, optIn: ReadonlySet<string>): ColumnConfig {
  return optIn.has(BODY_NOTE_CODE) ? c : { ...c, hidden: [...c.hidden, "notes"] };
}

function normalizeWith(raw: unknown, optIn: ReadonlySet<string>): BeamBodyStatementConfig {
  const base = normalizeBase(sanitizeRawConfig(raw), {
    sections: SECTIONS,
    signatureDefaults: BEAM_BODY_STATEMENT_SIGNATURES,
    marginMm: 9,
    tables: ["govdeler", "hareketler"],
  });
  return {
    ...base,
    kolonlar: {
      govdeler: resolveColumns(BODY_TABLE, beamBodyStatementBodyColumns() as never, bodyColumnCfg(base.columns.govdeler!, optIn)),
      hareketler: resolveColumns(MOVE_TABLE, beamBodyStatementMoveColumns() as never, base.columns.hareketler!),
    },
  };
}

export function normalizeBeamBodyStatementConfig(raw: unknown): BeamBodyStatementConfig {
  return normalizeWith(raw, new Set());
}

/** Sistem ayarındaki iç kolon anahtarı → `internalFields` (kopya ve eşitlik bekçisi aynı yoldan). */
function systemInternalFields(raw: unknown): string[] {
  const sections = asObject(asObject(raw).sections);
  return sections.internalNotes === true ? [BODY_NOTE_CODE] : [];
}

const periodText = (h: BeamBodyStatementDoc["header"]): string => `${fmtDate(h.periodFrom)} – ${fmtDate(h.asOf)}`;

function bodyValues(r: BeamBodyStatementBody): Record<string, ContextValue> {
  return { sira: r.seq, govde_no: r.bodyNo, durum: r.stateText, sahibi: r.ownerText, tarih: r.sinceAt, gun: r.ageDays, notlar: r.notes };
}

function moveValues(r: BeamBodyStatementMove): Record<string, ContextValue> {
  return {
    sira: r.seq, tarih: r.at, govde_no: r.bodyNo, yon: BEAM_BODY_STATEMENT_DIRECTION_LABELS[r.direction] ?? r.direction,
    yon_kodu: r.direction, hareket: r.kindLabel, belge_no: r.documentNo,
  };
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  const optIn = new Set(internalFields);
  const config = normalizeWith(rawConfig, optIn);
  const doc = asObject(snapshot?.doc) as unknown as BeamBodyStatementDoc;
  const h = doc.header;
  const t = doc.totals;
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject => fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);

  return {
    belge: root("belge", {
      no: h.documentNo, tur: "BEAM_BODY_STATEMENT", baslik: docTitle(config.titleOverride, BEAM_BODY_STATEMENT_TITLE), tarih: h.asOf,
      ...docStatus(extras?.baski),
      donem_baslangic: h.periodFrom, donem_gun: h.periodDays, donem_metni: periodText(h),
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", { ad: h.subcontractorName, kod: h.subcontractorCode }),
    tablolar: {
      antet_ek: letterheadExtraRows(snapshot).map((r) => fillFields(LETTERHEAD_EXTRA_TABLE.kolonlar, r, optIn)),
      govdeler: asRows<BeamBodyStatementBody>(doc.bodies).map((r) => fillFields(BODY_TABLE.kolonlar, bodyValues(r), optIn)),
      hareketler: asRows<BeamBodyStatementMove>(doc.moves).map((r) => fillFields(MOVE_TABLE.kolonlar, moveValues(r), optIn)),
      ozet: beamBodyStatementSummary(doc).map(([etiket, deger]) => fillFields(SUMMARY_TABLE.kolonlar, { etiket, deger }, optIn)),
    },
    toplamlar: root("toplamlar", { govde: t.bodies, bizim: t.ours, baska: t.others, dolu: t.full, gonderilen: t.sent, donen: t.returned }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: { [BODY_NOTE_CODE]: optIn.has(BODY_NOTE_CODE) },
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("BEAM_BODY_STATEMENT") as unknown as BeamBodyStatementDoc;
  const env = (d: BeamBodyStatementDoc) => sampleEnvelope(d as unknown as Row);
  const withRows = (d: BeamBodyStatementDoc, bodies: BeamBodyStatementBody[], moves: BeamBodyStatementMove[]): BeamBodyStatementDoc => ({
    ...d,
    bodies: bodies.map((b, i) => ({ ...b, seq: i + 1 })),
    moves: moves.map((m, i) => ({ ...m, seq: i + 1 })),
    totals: {
      bodies: bodies.length, ours: bodies.filter((b) => b.ownerText === "Bizim").length, others: bodies.filter((b) => b.ownerText !== "Bizim").length,
      full: bodies.filter((b) => b.stateText.startsWith("Dolu")).length,
      sent: moves.filter((m) => m.direction === "SENT").length, returned: moves.filter((m) => m.direction === "RETURNED").length,
    },
  });
  const sample = base();
  const [first, second] = sample.bodies;
  const [move] = sample.moves;
  const single = withRows(base(), [first!], [move!]);
  const many = withRows(
    base(),
    Array.from({ length: 48 }, (_, i) => ({ ...(i % 4 === 0 ? second! : first!), bodyNo: `G-${100 + i}`, ageDays: i, notes: i % 5 === 0 ? `Not ${i}` : null })),
    Array.from({ length: 30 }, (_, i) => ({ ...move!, bodyNo: `G-${100 + i}`, direction: i % 3 === 0 ? ("RETURNED" as const) : ("SENT" as const), documentNo: i % 7 === 0 ? null : move!.documentNo })),
  );
  const empty = withRows({ ...base(), header: { ...base().header, subcontractorCode: "" } }, [], []);
  const long = withRows(
    { ...base(), header: { ...base().header, subcontractorName: longText("Çok Uzun Adlı Devere Tekstil"), subcontractorCode: "D-<01>" } },
    [{ ...first!, bodyNo: "G-<&>", stateText: longText("Dolu — LV", 80), ownerText: longText("Başka Firma \"A\"", 90), notes: longText("İç not <b>", 120) }],
    [{ ...move!, kindLabel: longText("Hareket & açıklama", 60), documentNo: "IRS-<9>" }],
  );

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek mutabakatı (üç gövde, biri başka firmanın; üç hareket)", snapshot: env(base()) },
    { ad: "tek_kalem", aciklama: "Tek gövde, tek hareket", snapshot: env(single) },
    {
      ad: "cok_sayfa",
      aciklama: "48 gövde + 30 hareket — tablolar birden çok sayfaya taşar",
      snapshot: env(many),
      ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-06-07T09:00:00.000Z", basan: "admin", not: "Gönderildi" } },
    },
    { ad: "bos_opsiyonel", aciklama: "Sizde gövde yok (açık ifade), dönemde hareket yok, kodsuz devereci", snapshot: env(empty) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren metin", snapshot: env(long) },
    { ad: "iptal", aciklama: "İptal edilmiş (VOIDED) ikinci sürüm", snapshot: env(base()), ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "Sayım hatalı" } } },
  ];
}

export const beamBodyStatementContract: DocumentContract<BeamBodyStatementConfig, never> = {
  docType: "BEAM_BODY_STATEMENT",
  hedef: "musteri",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: [LETTERHEAD_EXTRA_TABLE, BODY_TABLE, MOVE_TABLE, SUMMARY_TABLE],
  ayarSemasi: baseConfigSchema(Object.keys(SECTIONS), [["govdeler", "govdeler"], ["hareketler", "hareketler"]]),
  ayarNormalize: normalizeBeamBodyStatementConfig,
  insa: buildContext,
  senaryolar: scenarios,
  sistemIcAlanlari: systemInternalFields,
};
