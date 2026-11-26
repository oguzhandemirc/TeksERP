// =============================================================================
// CONSIGNMENT_DISPATCH (Emanet Çıkış Belgesi) veri sözleşmesi — denetim 6 tasarımcı eşleniği
// =============================================================================
// Emanet sahibine gider (`hedef: musteri`); sahip `karsi_taraf`. Depo adı payload'da YOKTUR. Tek iç alan belge
// notudur: Sistem'de `sections.internalNotes === true`, tasarımcıda tek kapı `internalFields` (`belge_notu`).
// Özet, araç ve tür metinleri renderer'ın AYNI yardımcılarından — şablon hesap yapmaz.
// =============================================================================

import { docTitle } from "../../document-render/doc-style";
import {
  CONSIGNMENT_DISPATCH_SIGNATURES,
  CONSIGNMENT_DISPATCH_TITLE,
  CONSIGNMENT_KIND_TEXT,
  consignmentDispatchColumns,
  consignmentDispatchSummary,
  consignmentVehicleText,
  type ConsignmentDispatchDoc,
  type ConsignmentDispatchDocLine,
} from "../../document-render/consignment-dispatch.html";
import { docNum } from "../../document-render/fmt-num";
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
import { longText, sampleDoc, sampleEnvelope, sampleSeriesCode } from "./senaryolar";
import { baseConfigSchema, normalizeBase, plainJson, resolveColumns, sanitizeRawConfig, type BaseDocConfig } from "./subcontractor-common";
import type { BuildExtras, ContextObject, ContextValue, DocumentContract, FieldDef, Scenario, TableDef, TemplateContext } from "./tipler";

type Row = Record<string, unknown>;

/** `internalNotes` burada YOK: iç alanın tasarımcıdaki tek kapısı `internalFields`. */
const SECTIONS = { taxNo: true, ownerCode: true, date: true, vehicle: true, summary: true, lineTable: true } as const;

/** Belge notu opt-in kodu (Sistem: `sections.internalNotes`). */
export const DISPATCH_NOTE_CODE = "belge_notu";

const LINE_TABLE: TableDef = {
  anahtar: "kalemler",
  etiket: "Çıkan kalemler",
  kolonlar: [
    { yol: "sira", etiket: "Sıra", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1, hiza: "c", kaynakKolon: "seq" },
    { yol: "tur", etiket: "Tür (Levent · İplik)", tur: "metin", sinif: "musteri", ornek: "Levent", hiza: "l", kaynakKolon: "kind" },
    { yol: "tur_kodu", etiket: "Tür kodu (WARP_BEAM · YARN)", tur: "metin", sinif: "musteri", ornek: "WARP_BEAM", hiza: "l" },
    { yol: "kalem", etiket: "Kalem (çözgü adı · iplik kodu — adı)", tur: "metin", sinif: "musteri", ornek: "Tül 300 çözgü", hiza: "l", kaynakKolon: "item" },
    { yol: "referans", etiket: "Levent no / lot no", tur: "metin", sinif: "musteri", ornek: "LV-12", hiza: "l", kaynakKolon: "ref" },
    { yol: "miktar", etiket: "Miktar", tur: "sayi", ondalik: 2, sinif: "musteri", ornek: 1850.5, hiza: "r", kaynakKolon: "qty" },
    { yol: "birim", etiket: "Birim (m · kg)", tur: "metin", sinif: "musteri", ornek: "m", hiza: "c", kaynakKolon: "unit" },
  ],
};

const SUMMARY_TABLE: TableDef = {
  anahtar: "ozet",
  etiket: "Özet satırları",
  kolonlar: [
    { yol: "etiket", etiket: "Özet", tur: "metin", sinif: "musteri", ornek: "Levent", hiza: "l" },
    { yol: "deger", etiket: "Değer", tur: "metin", sinif: "musteri", ornek: "2 adet · 3.570,50 m", hiza: "r" },
  ],
};

const ROOT_FIELDS: FieldDef[] = [
  { yol: "belge.no", etiket: "Belge no (emanet çıkış no)", tur: "metin", sinif: "musteri", ornek: sampleSeriesCode("consignmentDispatch", 3) },
  { yol: "belge.tur", etiket: "Belge türü", tur: "metin", sinif: "musteri", ornek: "CONSIGNMENT_DISPATCH" },
  { yol: "belge.baslik", etiket: "Belge başlığı", tur: "metin", sinif: "musteri", ornek: CONSIGNMENT_DISPATCH_TITLE },
  { yol: "belge.tarih", etiket: "Çıkış anı", tur: "tarih_saat", sinif: "musteri", ornek: "2026-06-07T09:30:00.000Z" },
  ...DOC_STATUS_FIELDS,
  { yol: "belge.plaka", etiket: "Plaka", tur: "metin", sinif: "musteri", ornek: "34 ABC 123" },
  { yol: "belge.sofor", etiket: "Şoför", tur: "metin", sinif: "musteri", ornek: "Ali Veli" },
  { yol: "belge.arac_metni", etiket: "Araç satırı (\"Plaka: … · Şoför: …\"; ikisi de yoksa boş)", tur: "metin", sinif: "musteri", ornek: "Plaka: 34 ABC 123 · Şoför: Ali Veli" },
  { yol: "belge.not", etiket: "Belge notu (iç)", tur: "metin", sinif: "ic", icKod: DISPATCH_NOTE_CODE, ornek: "Kalan iki levent hafta içi" },
  { yol: "karsi_taraf.ad", etiket: "Emanet sahibi adı", tur: "metin", sinif: "musteri", ornek: "Örnek Tekstil A.Ş." },
  { yol: "karsi_taraf.kod", etiket: "Emanet sahibi kodu", tur: "metin", sinif: "musteri", ornek: "MUS-014" },
  ...COMPANY_FIELDS,
  { yol: "toplamlar.levent", etiket: "Levent adedi", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 2 },
  { yol: "toplamlar.levent_metre", etiket: "Levent toplam metre", tur: "sayi", ondalik: 2, birim: "m", sinif: "musteri", ornek: 3570.5 },
  { yol: "toplamlar.iplik_kg", etiket: "İplik toplam kg", tur: "sayi", ondalik: 2, birim: "kg", sinif: "musteri", ornek: 412.35 },
  ...PRINT_FIELDS,
];

export type ConsignmentDispatchConfig = BaseDocConfig;

export function normalizeConsignmentDispatchConfig(raw: unknown): ConsignmentDispatchConfig {
  const base = normalizeBase(sanitizeRawConfig(raw), {
    sections: SECTIONS,
    signatureDefaults: CONSIGNMENT_DISPATCH_SIGNATURES,
    marginMm: 9,
    tables: ["kalemler"],
  });
  return { ...base, kolonlar: { kalemler: resolveColumns(LINE_TABLE, consignmentDispatchColumns() as never, base.columns.kalemler!) } };
}

/** Sistem ayarındaki iç alan anahtarı → `internalFields` (kopya ve eşitlik bekçisi aynı yoldan). */
function systemInternalFields(raw: unknown): string[] {
  return asObject(asObject(raw).sections).internalNotes === true ? [DISPATCH_NOTE_CODE] : [];
}

function lineValues(r: ConsignmentDispatchDocLine): Record<string, ContextValue> {
  return { sira: r.seq, tur: CONSIGNMENT_KIND_TEXT[r.kind] ?? r.kind, tur_kodu: r.kind, kalem: r.itemText, referans: r.refNo, miktar: r.qty, birim: r.unit };
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  const optIn = new Set(internalFields);
  const config = normalizeConsignmentDispatchConfig(rawConfig);
  const doc = asObject(snapshot?.doc) as unknown as ConsignmentDispatchDoc;
  const h = doc.header;
  const t = doc.totals;
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject => fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);

  return {
    belge: root("belge", {
      no: h.documentNo, tur: "CONSIGNMENT_DISPATCH", baslik: docTitle(config.titleOverride, CONSIGNMENT_DISPATCH_TITLE), tarih: h.dispatchedAt,
      ...docStatus(extras?.baski),
      plaka: h.plateNumber, sofor: h.driverName, arac_metni: consignmentVehicleText(doc), not: h.notes,
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", { ad: h.ownerName, kod: h.ownerCode }),
    tablolar: {
      antet_ek: letterheadExtraRows(snapshot).map((r) => fillFields(LETTERHEAD_EXTRA_TABLE.kolonlar, r, optIn)),
      kalemler: asRows<ConsignmentDispatchDocLine>(doc.lines).map((r) => fillFields(LINE_TABLE.kolonlar, lineValues(r), optIn)),
      ozet: consignmentDispatchSummary(doc, docNum(snapshot).tr).map(([etiket, deger]) => fillFields(SUMMARY_TABLE.kolonlar, { etiket, deger }, optIn)),
    },
    toplamlar: root("toplamlar", { levent: t.beamCount, levent_metre: t.beamLengthM, iplik_kg: t.yarnKg }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: { [DISPATCH_NOTE_CODE]: optIn.has(DISPATCH_NOTE_CODE) },
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("CONSIGNMENT_DISPATCH") as unknown as ConsignmentDispatchDoc;
  const env = (d: ConsignmentDispatchDoc) => sampleEnvelope(d as unknown as Row);
  const withLines = (d: ConsignmentDispatchDoc, lines: ConsignmentDispatchDocLine[]): ConsignmentDispatchDoc => {
    const beams = lines.filter((l) => l.kind === "WARP_BEAM");
    const sum = (ls: ConsignmentDispatchDocLine[]) => Math.round(ls.reduce((s, l) => s + l.qty, 0) * 1000) / 1000;
    return {
      ...d,
      lines: lines.map((l, i) => ({ ...l, seq: i + 1 })),
      totals: { beamCount: beams.length, beamLengthM: sum(beams), yarnKg: sum(lines.filter((l) => l.kind === "YARN")) },
    };
  };
  const [beam, , yarn] = base().lines;
  const single = withLines(base(), [beam!]);
  const many = withLines(base(), Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? { ...yarn!, refNo: `L-${i}` } : { ...beam!, refNo: `LV-${100 + i}` })));
  const empty = withLines({ ...base(), header: { ...base().header, ownerCode: null, plateNumber: null, driverName: null, notes: null } }, [yarn!]);
  const long = withLines(
    { ...base(), header: { ...base().header, ownerName: longText("Çok Uzun Adlı Emanet Sahibi Tekstil"), ownerCode: "M-<01>", plateNumber: "34 <&> 1", notes: longText("İç not <b>", 120) } },
    [{ ...beam!, itemText: longText("Çözgü & tanımı", 80), refNo: "LV-<&>" }, { ...yarn!, itemText: longText("İplik \"A\"", 90) }],
  );

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek çıkışı (iki levent + bir iplik lotu)", snapshot: env(base()) },
    { ad: "tek_kalem", aciklama: "Tek levent", snapshot: env(single) },
    {
      ad: "cok_sayfa",
      aciklama: "60 kalem — tablo birden çok sayfaya taşar",
      snapshot: env(many),
      ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-06-07T09:00:00.000Z", basan: "admin", not: "Teslim edildi" } },
    },
    { ad: "bos_opsiyonel", aciklama: "Yalnız iplik; sahip kodu, plaka, şoför ve not boş", snapshot: env(empty) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren metin", snapshot: env(long) },
    { ad: "iptal", aciklama: "İptal edilmiş (VOIDED) çıkış", snapshot: env(base()), ek: { baski: { surum: 1, durum: "VOIDED", iptalNedeni: "Yanlış lot" } } },
  ];
}

export const consignmentDispatchContract: DocumentContract<ConsignmentDispatchConfig, never> = {
  docType: "CONSIGNMENT_DISPATCH",
  hedef: "musteri",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: [LETTERHEAD_EXTRA_TABLE, LINE_TABLE, SUMMARY_TABLE],
  ayarSemasi: baseConfigSchema(Object.keys(SECTIONS), [["kalemler", "kalemler"]]),
  ayarNormalize: normalizeConsignmentDispatchConfig,
  insa: buildContext,
  senaryolar: scenarios,
  sistemIcAlanlari: systemInternalFields,
};
