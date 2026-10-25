// =============================================================================
// SUBCONTRACTOR_DIRECT_SHIP (Fasondan Doğrudan Sevk İrsaliyesi) veri sözleşmesi
// =============================================================================
// Sistem renderer'ı (`document-render/fason-direct-ship.*`) DEĞİŞMEZ ve burada YALNIZ
// OKUNUR: kolon düzeni `renderFasonDirectShipTables`ın çözücüsünden alınır. Fasoncu
// kimliği `karsi_taraf`; malın gittiği müşteri `belge.musteri_*` alanlarıdır (ad rejimi
// yok — renderer cari adını olduğu gibi basar). Opt-in iç kolon yok → `hedef: musteri`.
// Rakamlar donmuş snapshot'tan: toplamlar BRÜTTÜR, şablon yeniden toplamaz.
// =============================================================================

import { docTitle } from "../../document-render/doc-style";
import { renderFasonDirectShipTables } from "../../document-render/fason-direct-ship.model";
import { pickExportCode } from "../../helpers/shipment-destination.helper";
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
import { baseConfigSchema, columnViewsOf, normalizeBase, plainJson, sanitizeRawConfig, type BaseDocConfig } from "./subcontractor-common";
import type { BuildExtras, ContextObject, ContextValue, DocumentContract, FieldDef, Scenario, TableDef, TemplateContext } from "./tipler";

type Row = Record<string, unknown>;

/** Renderer `sectionOn` okuduğu bölümler — hepsi blocklist (anahtar yoksa AÇIK). */
export const DIRECT_SHIP_SECTIONS = {
  fasonDispatchNo: true,
  batchInfo: true,
  branchName: true,
  exportCode: true,
  taxNo: true,
  subcontractorInfo: true,
  directShipInfo: true,
  vehicleInfo: true,
  allocations: true,
  rollTable: true,
  notes: true,
} as const;

/** [renderer tablo/ayar anahtarı, bağlam tablo anahtarı]. */
const TABLES = [
  ["allocations", "siparisler"],
  ["rollTable", "toplar"],
] as const;

export type DirectShipConfig = BaseDocConfig;

const ROOT_FIELDS: FieldDef[] = [
  { yol: "belge.no", etiket: "İrsaliye no (sevk no, yoksa fason sevk no)", tur: "metin", sinif: "musteri", ornek: "DSF-2026-0012" },
  { yol: "belge.tur", etiket: "Belge türü", tur: "metin", sinif: "musteri", ornek: "SUBCONTRACTOR_DIRECT_SHIP" },
  { yol: "belge.baslik", etiket: "Belge başlığı", tur: "metin", sinif: "musteri", ornek: "FASONDAN SEVK İRSALİYESİ" },
  { yol: "belge.tarih", etiket: "Sevk tarihi (doğrudan sevk, yoksa fason sevk)", tur: "tarih", sinif: "musteri", ornek: "2026-09-25T08:30:00.000Z" },
  ...DOC_STATUS_FIELDS,
  { yol: "belge.fason_sevk_no", etiket: "Fason sevk no (yalnız ayrı sevk no varsa)", tur: "metin", sinif: "musteri", ornek: null },
  { yol: "belge.parti_no", etiket: "Parti no", tur: "metin", sinif: "musteri", ornek: "P1207261" },
  { yol: "belge.sevk_eden", etiket: "Fasondan sevk eden", tur: "metin", sinif: "musteri", ornek: "Ayşe Kaya" },
  { yol: "belge.sebep", etiket: "Doğrudan sevk sebebi", tur: "metin", sinif: "musteri", ornek: "Müşteri acil talep" },
  { yol: "belge.plaka", etiket: "Plaka", tur: "metin", sinif: "musteri", ornek: "16 XYZ 789" },
  { yol: "belge.sofor", etiket: "Şoför", tur: "metin", sinif: "musteri", ornek: "Ali Demir" },
  { yol: "belge.notlar", etiket: "Sevk notu", tur: "metin", sinif: "musteri", ornek: null },
  { yol: "belge.is_emri_no", etiket: "İş emri no", tur: "metin", sinif: "musteri", ornek: "IE2507260001" },
  { yol: "belge.adim", etiket: "Fason adımı (istasyon)", tur: "metin", sinif: "musteri", ornek: "Boyahane (Fason)" },
  { yol: "belge.musteri_var", etiket: "Belgede müşteri var mı", tur: "mantiksal", sinif: "musteri", ornek: true },
  { yol: "belge.musteri_ad", etiket: "Müşteri adı", tur: "metin", sinif: "musteri", ornek: "Örnek Tekstil A.Ş." },
  { yol: "belge.musteri_kod", etiket: "Müşteri kodu", tur: "metin", sinif: "musteri", ornek: "M001" },
  { yol: "belge.musteri_vergi_no", etiket: "Müşteri vergi no", tur: "metin", sinif: "musteri", ornek: "1234567890" },
  { yol: "belge.musteri_sube", etiket: "Müşteri şubesi", tur: "metin", sinif: "musteri", ornek: "Merkez Şube" },
  { yol: "belge.musteri_ihracat_kodu", etiket: "İhracat kodu (şube, yoksa cari)", tur: "metin", sinif: "musteri", ornek: "IST-01" },
  ...COMPANY_FIELDS,
  { yol: "karsi_taraf.ad", etiket: "Fasoncu adı", tur: "metin", sinif: "musteri", ornek: "Yıldız Boyahane" },
  { yol: "karsi_taraf.kod", etiket: "Fasoncu kodu", tur: "metin", sinif: "musteri", ornek: "FB-03" },
  { yol: "toplamlar.top_adedi", etiket: "Toplam top", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 2 },
  { yol: "toplamlar.metre", etiket: "Toplam metre (brüt)", tur: "sayi", ondalik: 1, birim: "m", sinif: "musteri", ornek: 500 },
  { yol: "toplamlar.kg", etiket: "Toplam kg", tur: "sayi", ondalik: 1, birim: "kg", sinif: "musteri", ornek: 79 },
  ...PRINT_FIELDS,
];

const ALLOCATION_TABLE: TableDef = {
  anahtar: "siparisler",
  etiket: "Karşılanan siparişler",
  kolonlar: [
    { yol: "sira", etiket: "Sıra", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1, hiza: "c", kaynakKolon: "seq" },
    { yol: "siparis_no", etiket: "Sipariş no", tur: "metin", sinif: "musteri", ornek: "SIP-2026-0107", hiza: "l", kaynakKolon: "orderNumber" },
    { yol: "urun", etiket: "Ürün", tur: "metin", sinif: "musteri", ornek: "Pamuklu Astar", hiza: "l", kaynakKolon: "itemColor" },
    { yol: "renk", etiket: "Renk (ürünle aynı hücrede)", tur: "metin", sinif: "musteri", ornek: "Bej", hiza: "l" },
    { yol: "metre", etiket: "Miktar", tur: "sayi", ondalik: 1, birim: "m", sinif: "musteri", ornek: 500, hiza: "r", kaynakKolon: "qty" },
  ],
};

const ROLL_TABLE: TableDef = {
  anahtar: "toplar",
  etiket: "Sevk edilen toplar",
  kolonlar: [
    { yol: "sira", etiket: "Sıra", tur: "sayi", ondalik: 0, sinif: "musteri", ornek: 1, hiza: "c", kaynakKolon: "seq" },
    { yol: "barkod", etiket: "Barkod", tur: "metin", sinif: "musteri", ornek: "TR-260607-R0123", hiza: "l", kaynakKolon: "barcode" },
    { yol: "urun", etiket: "Ürün", tur: "metin", sinif: "musteri", ornek: "Pamuklu Astar", hiza: "l", kaynakKolon: "itemColor" },
    { yol: "renk", etiket: "Renk (ürünle aynı hücrede)", tur: "metin", sinif: "musteri", ornek: "Bej", hiza: "l" },
    { yol: "en", etiket: "En", tur: "sayi", ondalik: 0, birim: "cm", sinif: "musteri", ornek: 150, hiza: "c", kaynakKolon: "width" },
    { yol: "metre", etiket: "Metre", tur: "sayi", ondalik: 1, birim: "m", sinif: "musteri", ornek: 240, hiza: "r", kaynakKolon: "meters", toplam: "metre" },
    { yol: "kg", etiket: "Kg", tur: "sayi", ondalik: 1, birim: "kg", sinif: "musteri", ornek: 38, hiza: "r", kaynakKolon: "kg", toplam: "kg" },
  ],
};

const TABLE_DEFS: TableDef[] = [LETTERHEAD_EXTRA_TABLE, ALLOCATION_TABLE, ROLL_TABLE];

/** Değerleri önemsiz aday belge — renderer'dan iki tablonun kolon düzenini almak için. */
const CANDIDATE_DOC = {
  directShip: true,
  dispatchNo: "",
  workOrder: { workOrderNumber: "" },
  subcontractor: { name: "" },
  step: { station: { name: "" } },
  rolls: [{ sequence: 1, itemName: "", dispatchedQty: 0 }],
  allocations: [{ orderNumber: "", itemName: "", qty: 0 }],
  totals: { rollCount: 1, totalQty: 0, totalWeight: 0 },
};

export function normalizeDirectShipConfig(raw: unknown): DirectShipConfig {
  const base = normalizeBase(sanitizeRawConfig(raw), {
    sections: DIRECT_SHIP_SECTIONS,
    signatureDefaults: ["Teslim Eden", "Teslim Alan"],
    marginMm: 9,
    tables: TABLES.map(([t]) => t),
  });
  const tables = renderFasonDirectShipTables({
    schemaVersion: 1,
    frozenAt: "",
    company: { name: "", letterhead: { addressLine: "", phone: "", taxInfo: "" } },
    docConfigOverride: { columns: base.columns, sections: { allocations: true, rollTable: true } },
    doc: CANDIDATE_DOC,
  }).tables;
  const kolonlar: BaseDocConfig["kolonlar"] = {};
  for (const [key, ctxKey] of TABLES) {
    const def = key === "allocations" ? ALLOCATION_TABLE : ROLL_TABLE;
    kolonlar[ctxKey] = columnViewsOf(def, tables.find((t) => t.key === key)?.columns ?? []);
  }
  return { ...base, kolonlar };
}

function buildContext(
  snapshot: PrintedDocSnapshot,
  rawConfig: unknown,
  internalFields: readonly string[],
  extras?: BuildExtras<never>,
): TemplateContext {
  const config = normalizeDirectShipConfig(rawConfig);
  const optIn = new Set(internalFields);
  const doc = asObject(snapshot?.doc);
  const sub = asObject(doc.subcontractor);
  const hasCustomer = !!doc.customer && typeof doc.customer === "object";
  const cust = asObject(doc.customer);
  const totals = asObject(doc.totals);
  const shipmentNo = asText(doc.shipmentNo);
  const root = (rootKey: string, values: Record<string, ContextValue | undefined>): ContextObject =>
    fillFields(rootFields(ROOT_FIELDS, rootKey), values, optIn);
  const rows = (t: TableDef, values: Record<string, ContextValue | undefined>[]): ContextObject[] =>
    values.map((r) => fillFields(t.kolonlar, r, optIn));

  return {
    belge: root("belge", {
      no: shipmentNo ?? asText(doc.dispatchNo),
      tur: "SUBCONTRACTOR_DIRECT_SHIP",
      baslik: docTitle(config.titleOverride, "FASONDAN SEVK İRSALİYESİ"),
      tarih: asText(doc.directShippedAt) ?? asText(doc.dispatchedAt),
      ...docStatus(extras?.baski),
      fason_sevk_no: shipmentNo ? asText(doc.dispatchNo) : null,
      parti_no: asText(doc.batchNumber),
      sevk_eden: asText(doc.directShippedBy),
      sebep: asText(doc.directShipReason),
      plaka: asText(doc.plateNumber),
      sofor: asText(doc.driverName),
      notlar: asText(doc.notes),
      is_emri_no: asText(asObject(doc.workOrder).workOrderNumber),
      adim: asText(asObject(asObject(doc.step).station).name),
      musteri_var: hasCustomer,
      musteri_ad: asText(cust.name),
      musteri_kod: asText(cust.code),
      musteri_vergi_no: asText(cust.taxNumber),
      musteri_sube: asText(cust.branchName),
      musteri_ihracat_kodu: hasCustomer
        ? pickExportCode({ branchCode: asText(cust.branchCode), customerExportCode: asText(cust.exportCode) })
        : null,
    }),
    firma: root("firma", companyRoot(snapshot, extras?.baski)),
    karsi_taraf: root("karsi_taraf", { ad: asText(sub.name), kod: asText(sub.code) }),
    tablolar: {
      antet_ek: rows(LETTERHEAD_EXTRA_TABLE, letterheadExtraRows(snapshot)),
      siparisler: rows(
        ALLOCATION_TABLE,
        asRows(doc.allocations).map((a, i) => ({
          sira: i + 1,
          siparis_no: asText(a.orderNumber),
          urun: asText(a.itemName),
          renk: asText(a.colorName),
          metre: asNumber(a.qty),
        })),
      ),
      toplar: rows(
        ROLL_TABLE,
        asRows(doc.rolls).map((r) => ({
          sira: asNumber(r.sequence),
          barkod: asText(r.barcode),
          urun: asText(r.itemName),
          renk: asText(r.colorName),
          en: asNumber(r.width),
          metre: asNumber(r.dispatchedQty),
          kg: asNumber(r.dispatchedWeight),
        })),
      ),
    },
    // Donmuş toplamlar olduğu gibi (brüt); şablon satırlardan yeniden toplamaz.
    toplamlar: root("toplamlar", {
      top_adedi: asNumber(totals.rollCount),
      metre: asNumber(totals.totalQty),
      kg: asNumber(totals.totalWeight),
    }),
    ayar: plainJson(config) as unknown as ContextObject,
    ic_acik: {},
    baski: root("baski", printRoot(extras?.baski, config.stamps.copyLabel)),
  };
}

function scenarios(): Scenario<never>[] {
  const base = () => sampleDoc("SUBCONTRACTOR_DIRECT_SHIP");
  const roll = (i: number, width: number | null, qty: number, kg: number | null): Row => ({
    sequence: i, barcode: `TR-260607-R${String(100 + i).padStart(4, "0")}`, itemCode: "KMS-001", itemName: "Pamuklu Astar",
    colorCode: "BEJ", colorName: "Bej", dispatchedQty: qty, dispatchedWeight: kg, qualityGrade: "A", width,
  });

  const single = base();
  single.rolls = [roll(1, 150, 240, 38)];
  single.totals = { rollCount: 1, totalQty: 240, totalWeight: 38 };

  const multi = base();
  multi.shipmentNo = sampleSeriesCode("shipment", 7);
  multi.rolls = Array.from({ length: 60 }, (_, i) => roll(i + 1, i % 4 === 0 ? 149.5 : 150, 100 + i / 4, i % 5 === 0 ? null : 15.25));
  multi.allocations = [
    { orderNumber: "SIP-2026-0107", itemCode: "KMS-001", itemName: "Pamuklu Astar", colorName: "Bej", qty: 4000 },
    { orderNumber: "SIP-2026-0111", itemCode: "KMS-001", itemName: "Pamuklu Astar", colorName: null, qty: 2442.5 },
  ];
  multi.totals = { rollCount: 60, totalQty: 6442.5, totalWeight: 732 };

  // Eski/eksik şekil: müşteri yok, sevk eden/sebep/araç boş, ağırlık yok, parti yok.
  const empty: Row = {
    directShip: true, dispatchNo: "DSF-2026-0013", directShippedAt: null, directShipReason: null, directShippedBy: null,
    dispatchedAt: "2026-09-24T08:30:00.000Z", driverName: null, plateNumber: null, notes: null,
    workOrder: { id: "wo2", workOrderNumber: sampleSeriesCode("workOrder", 2), type: "ORDER_PRODUCTION" },
    subcontractor: { id: "sub2", name: "Boş Alanlı Fasoncu", code: null },
    step: { id: "st2", stepSequence: 1, station: { name: "Zımpara (Fason)", code: "ZMP" } },
    rolls: [{ sequence: 1, barcode: null, itemCode: "KMS-001", itemName: "Pamuklu Astar", colorCode: null, colorName: null, dispatchedQty: 100, dispatchedWeight: null, qualityGrade: "A", width: null }],
    allocations: [],
    totals: { rollCount: 1, totalQty: 100, totalWeight: 0 },
  };

  const long = base();
  long.customer = {
    id: "cus2", name: longText("Çok Uzun Unvanlı Müşteri Tekstil Konfeksiyon İthalat İhracat"), code: "M<002>",
    taxNumber: "9876543210", branchName: longText("Organize Sanayi Şubesi", 120), branchCode: null, exportCode: "EXP-TR-<&>",
  };
  long.directShipReason = longText("Müşteri acil talep — fabrikaya dönmeden sevk");
  long.notes = longText("Kapı teslim, rampa 3");
  long.rolls = [roll(1, 999, 240, 38), { ...roll(2, 999.4, 260, 41), itemName: longText("Süet Kumaş", 120) }];
  long.allocations = [{ orderNumber: "SIP-<2026>-0107", itemCode: "KMS-001", itemName: longText("Pamuklu Astar", 90), colorName: "Bej", qty: 500 }];

  return [
    { ad: "ornek", aciklama: "Panel önizlemesinin örnek doğrudan sevk irsaliyesi", snapshot: sampleEnvelope(base()) },
    { ad: "tek_kalem", aciklama: "Tek top", snapshot: sampleEnvelope(single) },
    {
      ad: "cok_sayfa",
      aciklama: "60 top, iki sipariş, ayrı sevk numarası (fason sevk no basılır)",
      snapshot: sampleEnvelope(multi),
      ek: { baski: { surum: 1, durum: "ACTIVE", zaman: "2026-09-25T09:00:00.000Z", basan: "admin", not: "Acil" } },
    },
    { ad: "bos_opsiyonel", aciklama: "Müşterisiz, opsiyonel alanların tümü boş/eksik", snapshot: sampleEnvelope(empty) },
    { ad: "uzun_metin", aciklama: "Uzun ve kaçış gerektiren adlar; 999 cm en sınırı", snapshot: sampleEnvelope(long) },
    {
      ad: "iptal",
      aciklama: "İptal edilmiş (VOIDED) ikinci sürüm",
      snapshot: sampleEnvelope(base()),
      ek: { baski: { surum: 2, durum: "VOIDED", iptalNedeni: "Yanlış müşteri" } },
    },
  ];
}

export const subcontractorDirectShipContract: DocumentContract<DirectShipConfig, never> = {
  docType: "SUBCONTRACTOR_DIRECT_SHIP",
  hedef: "musteri",
  contractVersion: 1,
  kokler: ROOT_FIELDS,
  tablolar: TABLE_DEFS,
  ayarSemasi: baseConfigSchema(Object.keys(DIRECT_SHIP_SECTIONS), TABLES),
  ayarNormalize: normalizeDirectShipConfig,
  insa: buildContext,
  senaryolar: scenarios,
};
