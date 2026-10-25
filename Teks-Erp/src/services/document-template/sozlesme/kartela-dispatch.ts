// =============================================================================
// KARTELA_DISPATCH (Kartela Çeki Listesi) veri sözleşmesi
// =============================================================================
// Sistem renderer'ı (`document-render/kartela-ceki.html.ts`) DEĞİŞMEZ ve yalnız okunur.
// Kartela firmasına gider (`hedef: musteri`); firma `karsi_taraf`tır. Renderer'da opt-in iç
// kolon yok → iç alan beyanı yok; basılmayan ürün/renk kodu ve kalite bağlama hiç girmez.
// Toplamlar snapshot'ta donmuştur (brüt gönderilen); şablon hesap yapmaz.
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

const TITLE = "KARTELA ÇEKİ LİSTESİ";
const SECTIONS = { subcontractorInfo: true, vehicleInfo: true, rollTable: true, notes: true } as const;

const ROLL_TABLE: TableDef = {
  anahtar: "toplar",
  etiket: "Gönderilen toplar",
  kolonlar: [
    { yol: "sira", etiket: "Sıra", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1, hiza: "c", kaynakKolon: "seq" },
    { yol: "barkod", etiket: "Barkod", tur: "metin", sinif: "musteri", ornek: "TR-260607-R0200", hiza: "l", kaynakKolon: "barcode" },
    { yol: "urun", etiket: "Ürün", tur: "metin", sinif: "musteri", ornek: "Pamuklu Astar", hiza: "l", kaynakKolon: "itemColor" },
    { yol: "renk", etiket: "Renk (ürünle aynı hücrede)", tur: "metin", sinif: "musteri", ornek: "Bej", hiza: "l" },
    { yol: "en", etiket: "En", tur: "sayi", ondalik: 0, birim: "cm", sinif: "musteri", ornek: 150, hiza: "c", kaynakKolon: "width" },
    { yol: "metre", etiket: "Metre", tur: "sayi", ondalik: 1, birim: "m", sinif: "musteri", ornek: 6, hiza: "r", kaynakKolon: "meters", toplam: "metre" },
    { yol: "kg", etiket: "Kg", tur: "sayi", ondalik: 1, birim: "kg", sinif: "musteri", ornek: 1.2, hiza: "r", kaynakKolon: "kg", toplam: "kg" },
  ],
};

const TEXT = { t: "text" } as const;
/** Renderer kolonlarının eşi (anahtar/başlık/hiza) — kolon düzeni renderer'ın çözücüsünden. */
const ROLL_SPECS: DocColSpec<never>[] = [
  { key: "seq", label: "#", align: "c", width: "34px", kind: TEXT, value: () => null },
  { key: "barcode", label: "BARKOD", align: "l", cellClass: "mono", kind: TEXT, value: () => null },
  { key: "itemColor", label: "ÜRÜN / RENK", align: "l", kind: TEXT, value: () => null },
  { key: "width", label: "EN", align: "c", width: "60px", kind: { t: "int", suffix: " cm" }, value: () => null },
  { key: "meters", label: "METRE", align: "r", width: "80px", kind: { t: "num", dec: 1 }, value: () => null, foot: { value: null } },
  { key: "kg", label: "KG", align: "r", width: "70px", kind: { t: "num", dec: 1 }, value: () => null, foot: { value: null } },
];

const ROOT_FIELDS: FieldDef[] = [
  ...headFields("Sevk no", sampleSeriesCode("kartelaDispatch", 1), TITLE, "KARTELA_DISPATCH"),
  { yol: "belge.plaka", etiket: "Plaka", tur: "metin", sinif: "musteri", ornek: "06 KRT 060" },
  { yol: "belge.sofor", etiket: "Şoför", tur: "metin", sinif: "musteri", ornek: "Hasan Kaya" },
  { yol: "belge.notlar", etiket: "Not", tur: "metin", sinif: "musteri", ornek: "Numune kartelası" },
  { yol: "karsi_taraf.ad", etiket: "Kartela firması", tur: "metin", sinif: "musteri", ornek: "Desen Kartela" },
  { yol: "karsi_taraf.kod", etiket: "Kartela firması kodu", tur: "metin", sinif: "musteri", ornek: "KF-01" },
  ...COMPANY_FIELDS,
  { yol: "toplamlar.top_adedi", etiket: "Top adedi", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 2 },
  { yol: "toplamlar.metre", etiket: "Toplam metre (brüt gönderilen)", tur: "sayi", ondalik: 1, birim: "m", sinif: "musteri", ornek: 12 },
  { yol: "toplamlar.kg", etiket: "Toplam kg", tur: "sayi", ondalik: 1, birim: "kg", sinif: "musteri", ornek: 2.3 },
  ...PRINT_FIELDS,
];

export type KartelaDispatchConfig = BaseDocConfig;

export function normalizeKartelaDispatchConfig(raw: unknown): KartelaDispatchConfig {
  const base = normalizeBase(sanitizeRawConfig(raw), {
    sections: SECTIONS,
    signatureDefaults: ["Teslim Eden", "Teslim Alan"],
    marginMm: 9,
    tables: ["rollTable"],
  });
  return { ...base, kolonlar: { toplar: resolveColumns(ROLL_TABLE, ROLL_SPECS, base.columns.rollTable!) } };
}

function buildContext(snapshot: PrintedDocSnapshot, rawConfig: unknown, internalFields: readonly string[], extras?: BuildExtras<never>): TemplateContext {
  const config = normalizeKartelaDispatchConfig(rawConfig);
  const optIn = new Set(internalFields);
  const doc = asObject(snapshot?.doc);
  const sub = asObject(doc.subcontractor);
  const totals = asObject(doc.totals);
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject =>
    fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);
  const rolls = asRows(doc.rolls).map((r) =>
    fillFields(
      ROLL_TABLE.kolonlar,
      {
        sira: asNumber(r.sequence), barkod: asText(r.barcode), urun: asText(r.itemName), renk: asText(r.colorName),
        en: asNumber(r.width), metre: asNumber(r.dispatchedQty), kg: asNumber(r.dispatchedWeight),
      },
      optIn,
    ),
  );

  return {
    belge: root("belge", {
      no: asText(doc.dispatchNo),
      tur: "KARTELA_DISPATCH",
      baslik: docTitle(config.titleOverride, TITLE),
      tarih: asText(doc.dispatchedAt),
      ...docStatus(extras?.baski),
      plaka: asText(doc.plateNumber),
      sofor: asText(doc.driverName),
      notlar: asText(doc.notes),
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", { ad: asText(sub.name), kod: asText(sub.code) }),
    tablolar: { antet_ek: letterheadExtraRows(snapshot).map((r) => fillFields(LETTERHEAD_EXTRA_TABLE.kolonlar, r, optIn)), toplar: rolls },
    toplamlar: root("toplamlar", { top_adedi: asNumber(totals.rollCount), metre: asNumber(totals.totalQty), kg: asNumber(totals.totalWeight) }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("KARTELA_DISPATCH");
  const roll = (i: number, width: number | null = 150, qty = 6, kg: number | null = 1.2): Row => ({
    sequence: i, barcode: `TR-260607-R${String(200 + i).padStart(4, "0")}`, itemCode: "KMS-001", itemName: "Pamuklu Astar",
    colorCode: "BEJ", colorName: "Bej", dispatchedQty: qty, dispatchedWeight: kg, qualityGrade: SAMPLE_GRADE_LABEL, width,
  });
  const withRolls = (d: Row, rolls: Row[]): Row => {
    const qty = rolls.reduce((s, r) => s + Number(r.dispatchedQty), 0);
    const kg = rolls.reduce((s, r) => s + (Number(r.dispatchedWeight) || 0), 0);
    return { ...d, rolls, totals: { rollCount: rolls.length, totalQty: qty, totalWeight: kg } };
  };

  const single = withRolls(base(), [roll(1, 150, 6.25)]);
  const multi = withRolls(base(), Array.from({ length: 60 }, (_, i) => roll(i + 1, i % 3 === 0 ? 149.6 : 150, 5 + (i % 7) * 0.35, i % 5 === 0 ? null : 1.05)));
  const empty: Row = {
    dispatchNo: sampleSeriesCode("kartelaDispatch", 2), dispatchedAt: null, driverName: null, plateNumber: null, notes: null,
    subcontractor: { id: "ks2", name: "Desen Kartela", code: null },
    rolls: [{ sequence: 1, barcode: null, itemCode: "KMS-002", itemName: "Tül", colorCode: null, colorName: null, dispatchedQty: 0, dispatchedWeight: null, qualityGrade: "", width: null }],
    totals: { rollCount: 1, totalQty: 0, totalWeight: 0 },
  };
  const long = withRolls(
    {
      ...base(), plateNumber: "06 <KRT> 060", driverName: longText("Şoför Adı Soyadı", 60), notes: longText("Numune kartelası; acele"),
      subcontractor: { id: "ks3", name: longText("Çok Uzun Adlı Kartela ve Numune Atölyesi"), code: "KF-<01>" },
    },
    [roll(1), { ...roll(2, 999), itemName: longText("Süet Kumaş", 120), colorName: "Antrasit & Gri" }, roll(3, 999.4, 1234.567, 98.76)],
  );

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek kartela çekisi", snapshot: sampleEnvelope(base()) },
    { ad: "tek_kalem", aciklama: "Tek top", snapshot: sampleEnvelope(single) },
    {
      ad: "cok_sayfa",
      aciklama: "60 top — liste birden çok sayfaya taşar; bir kısmının kg'ı yok",
      snapshot: sampleEnvelope(multi),
      ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Acil" } },
    },
    { ad: "bos_opsiyonel", aciklama: "Opsiyonel alanların tümü boş/eksik; toplam kg sıfır", snapshot: sampleEnvelope(empty) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren adlar; 999 cm en sınırı", snapshot: sampleEnvelope(long) },
    {
      ad: "iptal",
      aciklama: "İptal edilmiş (VOIDED) ikinci sürüm",
      snapshot: sampleEnvelope(base()),
      ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "Yanlış firma" } },
    },
  ];
}

export const kartelaDispatchContract: DocumentContract<KartelaDispatchConfig, never> = {
  docType: "KARTELA_DISPATCH",
  hedef: "musteri",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: [LETTERHEAD_EXTRA_TABLE, ROLL_TABLE],
  ayarSemasi: baseConfigSchema(Object.keys(SECTIONS), [["rollTable", "toplar"]]),
  ayarNormalize: normalizeKartelaDispatchConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
