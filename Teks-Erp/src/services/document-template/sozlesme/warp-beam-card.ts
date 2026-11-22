// =============================================================================
// WARP_BEAM_CARD (Levent Kartı, A6) veri sözleşmesi — devere S5 tasarımcı eşleniği
// =============================================================================
// İç belge (`hedef: ic`); ücret/fiyat payload'da YOKTUR. Kâğıt A6 sabittir: ayar yalnız renderer'ın
// okuduğu anahtarları taşır (başlık, alt not, bölümler, kenar, yazı, iplik kolonları). Bilgi satırları
// renderer'ın `warpBeamCardInfoRows`undan HAZIR gelir (boş alan satır doğurmaz) — şablon hesap yapmaz.
// =============================================================================

import { docTitle, resolveDocStyle } from "../../document-render/doc-style";
import { docNum } from "../../document-render/fmt-num";
import {
  WARP_BEAM_CARD_MARGIN_MM,
  WARP_BEAM_CARD_SECTIONS,
  WARP_BEAM_CARD_TITLE,
  warpBeamCardInfoRows,
  warpBeamCardYarnColumns,
  type WarpBeamCardDoc,
  type WarpBeamCardYarn,
} from "../../document-render/warp-beam-card.html";
import type { PrintedDocSnapshot } from "../../printed-document.service";
import { COMPANY_FIELDS, DOC_STATUS_FIELDS, PRINT_FIELDS, asObject, asRows, companyRoot, docStatus, fillFields, printRoot, rootFields } from "./ortak";
import { longText, sampleDoc, sampleEnvelope } from "./senaryolar";
import { plainJson, resolveColumns, sanitizeRawConfig, type ColumnConfig } from "./subcontractor-common";
import type { BuildExtras, ColumnView, ConfigFieldDef, ContextObject, ContextValue, DocumentContract, FieldDef, Scenario, TableDef, TemplateContext } from "./tipler";

type Row = Record<string, unknown>;

const INFO_TABLE: TableDef = {
  anahtar: "bilgi",
  etiket: "Bilgi satırları (boş alan satır doğurmaz; fason bölümü kapalıysa devereci satırları yok)",
  kolonlar: [
    { yol: "etiket", etiket: "Etiket", tur: "metin", sinif: "musteri", ornek: "Çözgü kartı", hiza: "l" },
    { yol: "deger", etiket: "Değer (biçimli metin)", tur: "metin", sinif: "musteri", ornek: "CZ-TUL-01 — Tül 300 cm çözgü", hiza: "l" },
  ],
};

const YARN_TABLE: TableDef = {
  anahtar: "iplikler",
  etiket: "İplik kırılımı (sarım anındaki kopya)",
  kolonlar: [
    { yol: "sira", etiket: "Sıra", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1, hiza: "c", kaynakKolon: "seq" },
    { yol: "iplik_kodu", etiket: "İplik kodu", tur: "metin", sinif: "musteri", ornek: "PES-50D/24F", hiza: "l", kaynakKolon: "yarn" },
    { yol: "iplik_adi", etiket: "İplik adı", tur: "metin", sinif: "musteri", ornek: "Polyester 50 denye 24 filament", hiza: "l" },
    { yol: "tel", etiket: "Tel", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 7200, hiza: "r", kaynakKolon: "ends", toplam: "tel" },
    { yol: "denye", etiket: "Denye", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 50, hiza: "r", kaynakKolon: "denier" },
    { yol: "kg", etiket: "Kg", tur: "sayi", ondalik: 1, birim: "kg", sinif: "musteri", ornek: 46.7, hiza: "r", kaynakKolon: "kg", toplam: "kg" },
    { yol: "lotlar", etiket: "Lot no'ları (lotsuzsa boş)", tur: "metin", sinif: "musteri", ornek: "L2406-1, L2406-2", hiza: "l", kaynakKolon: "lots" },
  ],
};

const ROOT_FIELDS: FieldDef[] = [
  { yol: "belge.no", etiket: "Belge no (levent no)", tur: "metin", sinif: "musteri", ornek: "LV-0012" },
  { yol: "belge.tur", etiket: "Belge türü", tur: "metin", sinif: "musteri", ornek: "WARP_BEAM_CARD" },
  { yol: "belge.baslik", etiket: "Belge başlığı", tur: "metin", sinif: "musteri", ornek: WARP_BEAM_CARD_TITLE },
  ...DOC_STATUS_FIELDS,
  { yol: "belge.levent_no", etiket: "Levent no (karekod metni)", tur: "metin", sinif: "musteri", ornek: "LV-0012" },
  { yol: "belge.govde_no", etiket: "Gövde no (yoksa boş)", tur: "metin", sinif: "musteri", ornek: "G-27" },
  { yol: "belge.cozgu_kodu", etiket: "Çözgü kartı kodu", tur: "metin", sinif: "musteri", ornek: "CZ-TUL-01" },
  { yol: "belge.cozgu_adi", etiket: "Çözgü kartı adı", tur: "metin", sinif: "musteri", ornek: "Tül 300 cm çözgü" },
  { yol: "belge.tahar", etiket: "Tahar düzeni notu", tur: "metin", sinif: "musteri", ornek: "1-2-3-4 düz" },
  { yol: "belge.kumas", etiket: "Kumaş", tur: "metin", sinif: "musteri", ornek: "Tül Perde 300" },
  { yol: "belge.dokuma_is_emri", etiket: "Dokuma iş emri", tur: "metin", sinif: "musteri", ornek: "DIE-0042" },
  { yol: "belge.metre", etiket: "Metre", tur: "sayi", ondalik: 1, birim: "m", sinif: "musteri", ornek: 4200 },
  { yol: "belge.tel", etiket: "Tel", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 9600 },
  { yol: "belge.hesap_kg", etiket: "Hesap kg", tur: "sayi", ondalik: 1, birim: "kg", sinif: "musteri", ornek: 74.7 },
  { yol: "belge.tarti_kg", etiket: "Tartı net kg", tur: "sayi", ondalik: 1, birim: "kg", sinif: "musteri", ornek: 75.2 },
  { yol: "belge.sarim_tarihi", etiket: "Sarım tarihi", tur: "tarih", sinif: "musteri", ornek: "2026-06-07T10:30:00.000Z" },
  { yol: "belge.sahibi", etiket: "Sahibi (fason leventte)", tur: "metin", sinif: "musteri", ornek: null },
  { yol: "belge.devereci", etiket: "Devereci", tur: "metin", sinif: "musteri", ornek: "Örnek Devere Ltd." },
  { yol: "belge.irsaliye_no", etiket: "Devereci irsaliye no", tur: "metin", sinif: "musteri", ornek: "IRS-5521" },
  { yol: "belge.kabul_belgesi_no", etiket: "Kabul belgesi no", tur: "metin", sinif: "musteri", ornek: "DDK-0007" },
  { yol: "belge.devere_siparisi_no", etiket: "Devere siparişi no", tur: "metin", sinif: "musteri", ornek: "DS-0019" },
  ...COMPANY_FIELDS,
  { yol: "toplamlar.tel", etiket: "Toplam tel", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 9600 },
  { yol: "toplamlar.kg", etiket: "Toplam kg", tur: "sayi", ondalik: 1, birim: "kg", sinif: "musteri", ornek: 74.7 },
  ...PRINT_FIELDS,
];

/** Kartın eksiksiz ayarı — yalnız renderer'ın okuduğu anahtarlar (kâğıt A6 sabit, seçim yok). */
export interface WarpBeamCardConfig {
  titleOverride: string;
  footerNote: string;
  sections: Record<string, boolean>;
  style: {
    margins: { top: number; right: number; bottom: number; left: number };
    fontScale: number;
    fontWeight: "light" | "normal" | "bold";
  };
  columns: { iplikler: ColumnConfig };
  kolonlar: { iplikler: ColumnView[] };
}

const FONT_WEIGHT: Record<number, "light" | "normal" | "bold"> = { [-100]: "light", 0: "normal", 100: "bold" };
const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const EMPTY_TOTALS = { endsCount: 0, kg: 0 };

export function normalizeWarpBeamCardConfig(raw: unknown): WarpBeamCardConfig {
  const cfg = sanitizeRawConfig(raw);
  const st = resolveDocStyle(cfg.style, { marginMm: WARP_BEAM_CARD_MARGIN_MM });
  const sections: Record<string, boolean> = {};
  for (const [k, dflt] of Object.entries(WARP_BEAM_CARD_SECTIONS)) {
    const v = cfg.sections?.[k];
    sections[k] = typeof v === "boolean" ? v : dflt;
  }
  const c = cfg.columns?.iplikler ?? {};
  const iplikler: ColumnConfig = { hidden: stringList(c.hidden), order: stringList(c.order), labels: { ...(c.labels ?? {}) }, blankLabels: stringList(c.blankLabels) };
  // Lot kolonu bölüm anahtarıyla da kapanır (renderer `parts` eşi); kayıtlı kolon ayarı değişmez.
  const view = sections.lots ? iplikler : { ...iplikler, hidden: [...iplikler.hidden, "lots"] };
  return {
    titleOverride: cfg.titleOverride ?? "",
    footerNote: cfg.footerNote ?? "",
    sections,
    style: { margins: { ...st.margins }, fontScale: st.fontScale, fontWeight: FONT_WEIGHT[st.weightDelta] ?? "normal" },
    columns: { iplikler },
    kolonlar: { iplikler: resolveColumns(YARN_TABLE, warpBeamCardYarnColumns(EMPTY_TOTALS) as never, view) },
  };
}

const CONFIG_SCHEMA: ConfigFieldDef[] = [
  { yol: "titleOverride", etiket: "Başlık (boş = varsayılan)", tur: "metin" },
  { yol: "footerNote", etiket: "Alt not", tur: "metin" },
  ...Object.keys(WARP_BEAM_CARD_SECTIONS).map((b): ConfigFieldDef => ({ yol: `sections.${b}`, etiket: `Bölüm: ${b}`, tur: "mantiksal" })),
  { yol: "style.margins.top", etiket: "Üst kenar (mm)", tur: "sayi" },
  { yol: "style.margins.right", etiket: "Sağ kenar (mm)", tur: "sayi" },
  { yol: "style.margins.bottom", etiket: "Alt kenar (mm)", tur: "sayi" },
  { yol: "style.margins.left", etiket: "Sol kenar (mm)", tur: "sayi" },
  { yol: "style.fontScale", etiket: "Yazı ölçeği", tur: "sayi" },
  { yol: "style.fontWeight", etiket: "Yazı kalınlığı", tur: "secim", secenekler: ["light", "normal", "bold"] },
  { yol: "columns.iplikler.hidden", etiket: "iplikler: gizli kolonlar", tur: "liste" },
  { yol: "columns.iplikler.order", etiket: "iplikler: kolon sırası", tur: "liste" },
  { yol: "columns.iplikler.labels", etiket: "iplikler: kolon başlıkları", tur: "nesne" },
  { yol: "columns.iplikler.blankLabels", etiket: "iplikler: başlıksız kolonlar", tur: "liste" },
  { yol: "kolonlar.iplikler", etiket: "iplikler: çözülmüş kolon düzeni", tur: "liste" },
];

function yarnValues(r: WarpBeamCardYarn): Record<string, ContextValue> {
  return { sira: r.seq, iplik_kodu: r.yarnCode, iplik_adi: r.yarnName, tel: r.endsCount, denye: r.denier, kg: r.kg, lotlar: r.lots };
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  const optIn = new Set(internalFields);
  const config = normalizeWarpBeamCardConfig(rawConfig);
  const doc = asObject(snapshot?.doc) as unknown as WarpBeamCardDoc;
  const h = doc.header;
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject => fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);
  const info = warpBeamCardInfoRows(doc, config.sections, docNum(snapshot ?? {}).tr);

  return {
    belge: root("belge", {
      no: h.documentNo, tur: "WARP_BEAM_CARD", baslik: docTitle(config.titleOverride, WARP_BEAM_CARD_TITLE),
      ...docStatus(extras?.baski),
      levent_no: h.beamNo, govde_no: h.bodyNo, cozgu_kodu: h.warpSpecCode, cozgu_adi: h.warpSpecName, tahar: h.drawingInNote ?? null,
      kumas: h.itemName, dokuma_is_emri: h.weavingOrderNumber, metre: h.lengthM, tel: h.endsCount, hesap_kg: h.theoreticalKg,
      tarti_kg: h.weighedNetKg, sarim_tarihi: h.woundAt, sahibi: h.ownerName, devereci: h.subcontractorName, irsaliye_no: h.deliveryNoteNo,
      kabul_belgesi_no: h.receiveDocNo, devere_siparisi_no: h.warpingOrderNo,
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: {},
    tablolar: {
      bilgi: info.map(([etiket, deger]) => fillFields(INFO_TABLE.kolonlar, { etiket, deger }, optIn)),
      iplikler: asRows<WarpBeamCardYarn>(doc.yarns).map((r) => fillFields(YARN_TABLE.kolonlar, yarnValues(r), optIn)),
    },
    toplamlar: root("toplamlar", { tel: doc.totals?.endsCount, kg: doc.totals?.kg }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, null)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("WARP_BEAM_CARD") as unknown as WarpBeamCardDoc;
  const env = (d: WarpBeamCardDoc) => sampleEnvelope(d as unknown as Row);
  const withYarns = (d: WarpBeamCardDoc, yarns: WarpBeamCardYarn[]): WarpBeamCardDoc => ({
    ...d,
    yarns: yarns.map((y, i) => ({ ...y, seq: i + 1 })),
    totals: { endsCount: yarns.reduce((s, y) => s + y.endsCount, 0), kg: Math.round(yarns.reduce((s, y) => s + y.kg, 0) * 10) / 10 },
  });
  const [first, second] = base().yarns;
  const single = withYarns(base(), [{ ...first!, lots: null }]);
  const many = withYarns(base(), Array.from({ length: 14 }, (_, i) => ({ ...(i % 2 ? second! : first!), endsCount: 600 + i * 10, kg: 3.4 + i / 10 })));
  // Fason dışı, gövdesiz, tartısız, tahar'sız, ipliksiz kart: boş alanlar satır doğurmaz.
  const empty: WarpBeamCardDoc = {
    header: {
      ...base().header, bodyNo: null, itemName: null, weavingOrderNumber: null, woundAt: null, lengthM: null, endsCount: null, theoreticalKg: null,
      weighedNetKg: null, ownerName: null, subcontractorName: null, deliveryNoteNo: null, receiveDocNo: null, warpingOrderNo: null, drawingInNote: null,
    },
    yarns: [],
    totals: { endsCount: 0, kg: 0 },
  };
  const long: WarpBeamCardDoc = withYarns(
    {
      ...base(),
      header: {
        ...base().header, bodyNo: "G-<27>", warpSpecName: longText("Çok uzun çözgü kartı adı & <özel>", 120), itemName: longText("Kumaş \"tül\"", 90),
        ownerName: longText("Sahip Tekstil", 60), drawingInNote: longText("Tahar 1-2 & 3-4", 100),
      },
    },
    [{ ...first!, yarnCode: longText("PES-50D <&>", 50), lots: longText("L-<1>", 70) }],
  );

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek kartı (iki iplik, lotlu/lotsuz, fason bilgileri, tahar)", snapshot: env(base()) },
    { ad: "tek_kalem", aciklama: "Tek iplik, lotsuz", snapshot: env(single) },
    { ad: "cok_sayfa", aciklama: "14 iplik — A6 kart taşar", snapshot: env(many), ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-06-07T11:00:00.000Z", basan: "devere" } } },
    { ad: "bos_opsiyonel", aciklama: "Gövdesiz, fason dışı, ölçüsüz, ipliksiz kart", snapshot: env(empty) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren metin", snapshot: env(long) },
    { ad: "iptal", aciklama: "İptal edilmiş leventin (VOIDED) kartı", snapshot: env(base()), ek: { baski: { surum: 1, durum: "VOIDED", iptalNedeni: "Levent iptal" } } },
  ];
}

export const warpBeamCardContract: DocumentContract<WarpBeamCardConfig, never> = {
  docType: "WARP_BEAM_CARD",
  hedef: "ic",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: [INFO_TABLE, YARN_TABLE],
  ayarSemasi: CONFIG_SCHEMA,
  ayarNormalize: normalizeWarpBeamCardConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
