// Sevk irsaliyesi belgesinin saf (DB'siz) fikstür uzayı — altın kopya bekçisi
// (`test_sevk_belge_altin`) ile PDF↔Excel eşitlik bekçisi (`test_sevk_belge_excel_esit`)
// AYNI kombinasyonları ölçsün diye tek yerde durur. `test_` öneki YOK: koşucu bunu
// test saymaz.
import type { PrintedDocSnapshot } from "../../src/services/printed-document.service";
import type { DocumentConfig } from "../../src/services/system-setting.service";
import { SAMPLE_PRINTED_DOCS } from "../../src/services/document-render/sample-data";

type Meta = Record<string, unknown>;

const ISO = "2026-09-25T08:30:00.000Z";

/** Sevk partisi + ambalaj no + sıra + müşteri adı + eksik alanlar (null barkod/parti, kg=0, en yok). */
const ZENGIN_DOC = {
  header: {
    shipmentNo: "SVK-2609-0007",
    customerName: "Örnek Konfeksiyon <Ltd>",
    customerCode: "MUS-001",
    customerTaxNumber: "9876543210",
    branchName: "İzmir",
    branchCode: "IZM",
    customerExportCode: "EXP-9",
    exportCode: "IZM",
    procedureCode: "GTIP-55",
    destination: "EXPORT",
    status: "DISPATCHED",
    date: ISO,
    plateNumber: "35 ZZ 350",
    driverName: "Ayşe Kaya",
    carrier: null,
    orderNos: "SIP-1, SIP-2",
  },
  products: [
    { name: "Linen 330cm.", customerName: "BS-6650 EKRU 330cm.", customerItemOnly: "BS-6650 330cm.", customerColorOnly: "EKRU", rollCount: 3, totalMeters: 312.456 },
    { name: "Saten Siyah 150cm.", customerName: null, customerItemOnly: null, customerColorOnly: null, rollCount: 1, totalMeters: 40 },
  ],
  sacks: [
    { code: "CV2609250001", seq: 1, totalMeters: 212.456, totalKg: 30.25, packageCount: 2, packageNo: 1, packingGroupName: "P-1", packingGroupCode: "PRT-2609-0001" },
    { code: "CV2609250002", seq: 2, totalMeters: 100, totalKg: 0, packageCount: 1, packageNo: 2, packingGroupName: "P-2", packingGroupCode: "PRT-2609-0002" },
    { code: "CV2609250003", seq: 3, totalMeters: 40, totalKg: 7.5, packageCount: 1, packageNo: null, packingGroupName: null, packingGroupCode: null },
  ],
  cekiRows: [
    { sackCode: "CV2609250001", seq: 1, packageNo: 1, packingGroupName: "P-1", packingGroupCode: "PRT-2609-0001", barcode: "R0001", desen: "Linen", varyant: "Ekru", customerDesen: "BS-6650", customerVaryant: "EKRU", width: 330, meters: 112.456, kg: 15.25, batchNumber: "P0925001" },
    { sackCode: "CV2609250001", seq: 1, packageNo: 1, packingGroupName: "P-1", packingGroupCode: "PRT-2609-0001", barcode: null, desen: "Linen", varyant: "Ekru", customerDesen: "BS-6650", customerVaryant: null, width: 329.6, meters: 100, kg: 15, batchNumber: null },
    { sackCode: "CV2609250002", seq: 2, packageNo: 2, packingGroupName: "P-2", packingGroupCode: "PRT-2609-0002", barcode: "R0003", desen: "Linen", varyant: "Ekru", customerDesen: null, customerVaryant: null, width: null, meters: 100, kg: 0, batchNumber: "P0925002" },
    { sackCode: "CV2609250003", seq: 3, packageNo: null, packingGroupName: null, packingGroupCode: null, barcode: "R0004", desen: "Saten", varyant: "Siyah", width: 150, meters: 40, kg: 7.5, batchNumber: "P0925003" },
  ],
  sackSeqPrefix: "SP",
  totals: { totalRolls: 4, totalMeters: 352.456, totalKg: 37.75, sackCount: 3, manualSackCount: 2 },
};

/** Alanları hiç taşımayan ESKİ donmuş snapshot (packingLot/seq/müşteri adı/en/parti yok). */
const ESKI_DOC = {
  header: { ...ZENGIN_DOC.header, destination: "DOMESTIC", procedureCode: null, exportCode: undefined },
  products: [{ name: "Linen 330cm.", rollCount: 2, totalMeters: 200 }],
  sacks: [{ code: "C-1", seq: 1, totalMeters: 200, totalKg: 20, packageCount: 2 }],
  cekiRows: [
    { sackCode: "C-1", barcode: "B1", desen: "Linen", varyant: "Ekru", meters: 100, kg: 10 },
    { sackCode: "C-1", barcode: "B2", desen: "Linen", varyant: "Ekru", meters: 100, kg: 10 },
  ],
  totals: { totalRolls: 2, totalMeters: 200, totalKg: 20, sackCount: 1 },
};

export const SEVK_BELGE_DOCS: Record<string, Record<string, unknown>> = {
  ornek: SAMPLE_PRINTED_DOCS.SHIPMENT_DISPATCH as Record<string, unknown>,
  zengin: ZENGIN_DOC,
  eski: ESKI_DOC,
};

const TAM_KOLON: NonNullable<DocumentConfig["columns"]> = {
  urun: { order: ["totalMeters", "customerName", "name"], labels: { name: "ÜRÜN" }, hidden: ["rollCount"] },
  cuval: {
    shown: ["packingGroupCode", "note", "tag"],
    order: ["packingGroupCode", "code", "packageNo"],
    labels: { code: "ÇUVAL <#>", totalKg: "   " },
    blankLabels: ["packingGroupCode"],
    hidden: ["packageCount"],
  },
  ceki: {
    shown: ["packingGroupCode"],
    hidden: ["width", "batchNumber"],
    order: ["barcode", "sackCode"],
    labels: { barcode: "BARKOD", meters: "MT" },
    blankLabels: ["kg"],
  },
};

export const SEVK_BELGE_CFGS: Record<string, DocumentConfig | null> = {
  yok: null,
  bos: {},
  tamKolon: { columns: TAM_KOLON },
  yalnizOptIn: { columns: { cuval: { shown: ["packingGroupCode"] }, ceki: { shown: ["packingGroupCode"] } } },
  bolumKapali: { sections: { urun: false, docNo: false, date: false, direction: false, vehicleInfo: false } },
  seritEn: { sections: { listHeader: true }, language: "en", blankWidths: true },
  otoDil: { language: "auto", titleOverride: "Sevk Fişi", footerNote: "not <b>", footerNotePlacement: "top" },
  hepsi: {
    columns: TAM_KOLON,
    sections: { listHeader: true, orders: false, exportCode: false },
    language: "auto",
    blankWidths: false,
    showSignatures: false,
  },
};

const ROW_NOTES = { CV2609250001: "Kontrol <et>", "Ç-01": "not 1", "C-1": "eski not" };
const ROW_TAGS = { CV2609250002: "Eksik", "Ç-02": "iz" };

export const SEVK_BELGE_METAS: Record<string, Meta> = {
  yok: {},
  packingLot: { packingLot: true },
  sira: { sackSeq: { prefix: "SP", showTotal: true } },
  siraOneksiz: { sackSeq: { prefix: "", showTotal: false } },
  musterideki: { itemNameMode: "musterideki" },
  ikisiAyrik: { itemNameMode: "ikisi", cekiNameMode: "bizdeki", productColorSplit: true },
  cekiMusteri: { itemNameMode: "bizdeki", cekiNameMode: "musterideki" },
  notlarZorla: { rowNotes: ROW_NOTES, forceRowNotes: true, rowTags: ROW_TAGS, forceRowTags: true },
  notlarKalici: { rowNotes: ROW_NOTES, rowTags: ROW_TAGS },
  yalnizCuval: { listSections: ["cuval"], packingLot: true },
  cekiUrun: { listSections: ["ceki", "urun", "xx"], mergeSections: true },
  taslak: { draft: true, packingLot: true, sackSeq: { prefix: "P-", showTotal: false } },
  iptal: { status: "VOIDED", voidReason: "hata", itemNameMode: "ikisi", productColorSplit: true, packingLot: true },
  hepsi: {
    packingLot: true,
    sackSeq: { prefix: "SP", showTotal: true },
    itemNameMode: "ikisi",
    cekiNameMode: "ikisi",
    productColorSplit: true,
    rowNotes: ROW_NOTES,
    forceRowNotes: true,
    rowTags: ROW_TAGS,
    forceRowTags: true,
    printNote: "baskı notu",
    printedAtText: "25.09.2026 11:30",
    printedBy: "admin",
  },
};

export interface SevkBelgeKombinasyon {
  ad: string;
  snapshot: PrintedDocSnapshot;
  meta: Meta;
}

/** Üç doc × sekiz config × on dört meta = 336 kombinasyon, sıra deterministik. */
export function sevkBelgeKombinasyonlari(): SevkBelgeKombinasyon[] {
  const out: SevkBelgeKombinasyon[] = [];
  for (const [docAd, doc] of Object.entries(SEVK_BELGE_DOCS)) {
    for (const [cfgAd, cfg] of Object.entries(SEVK_BELGE_CFGS)) {
      for (const [metaAd, meta] of Object.entries(SEVK_BELGE_METAS)) {
        out.push({
          ad: `${docAd}/${cfgAd}/${metaAd}`,
          snapshot: {
            schemaVersion: 1,
            frozenAt: ISO,
            company: {
              name: "Deneme Tekstil",
              letterhead: { addressLine: "Organize San.", phone: "0232", taxInfo: "VD 1" },
              logoHash: null,
            },
            docConfigOverride: cfg,
            doc,
          } as unknown as PrintedDocSnapshot,
          meta,
        });
      }
    }
  }
  return out;
}

// ── Fasondan DOĞRUDAN sevk irsaliyesi (SUBCONTRACTOR_DIRECT_SHIP) ──────────────

/** Kaçış gerektiren adlar, barkodsuz/ensiz/kg'sız top, sıfır toplam kg, çok sipariş. */
const DOGRUDAN_ZENGIN = {
  directShip: true,
  shipmentNo: "SVK-2609-0101",
  dispatchNo: "FSN-2609-0042",
  directShippedAt: ISO,
  directShipReason: "Acil <müşteri> talebi",
  directShippedBy: "Ayşe Kaya",
  dispatchedAt: ISO,
  driverName: null,
  plateNumber: "16 FSN 16",
  notes: "Rampa 2 & kapı 3",
  batchNumber: "P0925009",
  customer: { id: "c1", name: "Örnek & Konfeksiyon", code: "MUS-9", taxNumber: "5556667778", branchName: "Bursa", branchCode: null, exportCode: "EXP-5" },
  workOrder: { id: "w1", workOrderNumber: "IE-2609-0007", type: "ORDER_PRODUCTION" },
  subcontractor: { id: "s1", name: "Yıldız Boyahane", code: null },
  step: { id: "st1", stepSequence: 3, station: { name: "Boyahane (Fason)", code: "DYE" } },
  rolls: [
    { sequence: 1, barcode: "R0101", itemCode: "K1", itemName: "Linen", colorCode: "E", colorName: "Ekru", dispatchedQty: 1234.56, dispatchedWeight: 38.25, qualityGrade: "A", width: 329.6 },
    { sequence: 2, barcode: null, itemCode: "K1", itemName: "Linen <x>", colorCode: null, colorName: null, dispatchedQty: 100, dispatchedWeight: null, qualityGrade: "A", width: null },
    { sequence: 3, barcode: "R0103", itemCode: "K2", itemName: "Saten", colorCode: "S", colorName: "Siyah", dispatchedQty: 40.05, dispatchedWeight: 0, qualityGrade: "B", width: 150 },
  ],
  allocations: [
    { orderNumber: "SIP-1", itemCode: "K1", itemName: "Linen", colorName: "Ekru", qty: 1000 },
    { orderNumber: "SIP-2 & B", itemCode: "K2", itemName: "Saten", colorName: null, qty: 374.61 },
  ],
  totals: { rollCount: 3, totalQty: 1374.61, totalWeight: 38.25 },
};

/** Alanları taşımayan ESKİ snapshot (müşteri/sevk no/parti yok, sipariş yok, toplam kg 0). */
const DOGRUDAN_ESKI = {
  ...DOGRUDAN_ZENGIN,
  shipmentNo: undefined,
  batchNumber: undefined,
  customer: undefined,
  allocations: [],
  rolls: [DOGRUDAN_ZENGIN.rolls[1]],
  totals: { rollCount: 1, totalQty: 100, totalWeight: 0 },
};

export const DOGRUDAN_DOCS: Record<string, Record<string, unknown>> = {
  ornek: SAMPLE_PRINTED_DOCS.SUBCONTRACTOR_DIRECT_SHIP as Record<string, unknown>,
  zengin: DOGRUDAN_ZENGIN,
  eski: DOGRUDAN_ESKI,
};

export const DOGRUDAN_CFGS: Record<string, DocumentConfig | null> = {
  yok: null,
  bos: {},
  tamKolon: {
    columns: {
      allocations: { hidden: ["seq"], order: ["qty", "orderNumber"], labels: { orderNumber: "SİPARİŞ <#>" }, blankLabels: ["itemColor"] },
      rollTable: { hidden: ["itemColor"], order: ["kg", "meters", "barcode"], labels: { barcode: "BARKOD & NO" }, blankLabels: ["width"] },
    },
  },
  tumuGizli: { columns: { rollTable: { hidden: ["seq", "barcode", "itemColor", "width", "meters", "kg"] } } },
  bolumKapali: {
    sections: {
      allocations: false, subcontractorInfo: false, directShipInfo: false, vehicleInfo: false,
      fasonDispatchNo: false, batchInfo: false, exportCode: false, branchName: false, taxNo: false, notes: false,
    },
    footerNote: "gizli not",
  },
  topsuz: { sections: { rollTable: false }, titleOverride: "Doğrudan Sevk", footerNote: "not <b>", showSignatures: false },
};

export const DOGRUDAN_METAS: Record<string, Meta> = {
  yok: {},
  taslak: { draft: true },
  iptal: { status: "VOIDED", voidReason: "hata" },
  eskiKopya: { status: "SUPERSEDED" },
  notDamga: { printNote: "baskı <notu>", printedAtText: "25.09.2026 11:30", printedBy: "admin" },
};

/** Üç doc × altı config × beş meta = 90 kombinasyon; ad `dogrudan/` önekli. */
export function dogrudanKombinasyonlari(): SevkBelgeKombinasyon[] {
  const out: SevkBelgeKombinasyon[] = [];
  for (const [docAd, doc] of Object.entries(DOGRUDAN_DOCS)) {
    for (const [cfgAd, cfg] of Object.entries(DOGRUDAN_CFGS)) {
      for (const [metaAd, meta] of Object.entries(DOGRUDAN_METAS)) {
        out.push({
          ad: `dogrudan/${docAd}/${cfgAd}/${metaAd}`,
          snapshot: {
            schemaVersion: 1,
            frozenAt: ISO,
            company: { name: "Deneme Tekstil", letterhead: { addressLine: "Organize San.", phone: "0232", taxInfo: "VD 1" }, logoHash: null },
            docConfigOverride: cfg,
            doc,
          } as unknown as PrintedDocSnapshot,
          meta,
        });
      }
    }
  }
  return out;
}

/** Altın karşılaştırmanın tek normalizasyonu: boşluk dizileri tek boşluğa iner. */
export function normalizeHtml(html: string): string {
  return html.replace(/\s+/g, " ").trim();
}
