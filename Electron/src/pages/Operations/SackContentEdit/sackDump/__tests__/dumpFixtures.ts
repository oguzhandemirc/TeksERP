// Çuval içerik dökümü testlerinin ortak fikstür uzayı — altın kopya
// (`dumpHtml.altin.test.ts`) ve PDF↔Excel eşitliği (`dumpEsitlik.test.ts`) AYNI
// kombinasyonları ölçsün diye tek yerde. Uygulama kodu bunu içe aktarmaz.
import type { SackDump, SackDumpOptions } from "../types";

/** Müşterili, şubeli, tartılmış, notlu, sevkiyatlı; üç ad + etiket hâlleri + kartela. */
const DOLU: SackDump = {
  sackNo: "TEST-CV-01",
  customerName: "Örnek & Konfeksiyon",
  branchName: "İzmir",
  branchCode: "IZM",
  weightKg: 31.4,
  notes: "Kontrol <et>",
  shipmentNo: "TEST-SVK-01",
  rolls: [
    { barcode: "R0001", itemName: "Linen", colorName: "Ekru", width: 330, qty: 112.35, qualityGrade: "1K", musteriItemName: "BS-6650", musteriColorName: "EKRU", etiketAd: "Linen · Ekru", etiketBasildi: true, etiketBayat: false },
    { barcode: null, itemName: "Linen <x>", colorName: null, width: null, qty: 40, qualityGrade: null, musteriItemName: "BS-6650", musteriColorName: null, etiketAd: null, etiketBasildi: false, etiketBayat: false },
    { barcode: "R0003", itemName: "Saten", colorName: "Siyah", width: 150.5, qty: 1204.5, qualityGrade: "2K", musteriItemName: null, musteriColorName: null, etiketAd: null, etiketBasildi: true, etiketBayat: true },
  ],
  swatches: [
    { barcode: "K001", itemName: "Linen", colorName: "Ekru", musteriItemName: "BS-6650", musteriColorName: "EKRU" },
    { barcode: null, itemName: "Saten", colorName: null, musteriItemName: null, musteriColorName: null },
  ],
};

/** Müşterisiz, tartılmamış, boş çuval. */
const BOS: SackDump = {
  sackNo: "TEST-CV-02",
  customerName: null,
  branchName: null,
  branchCode: null,
  weightKg: null,
  notes: null,
  shipmentNo: null,
  rolls: [],
  swatches: [],
};

/** Eski backend'in alanları taşımadığı top (müşteri/etiket alanları YOK). */
const ESKI: SackDump = {
  sackNo: "TEST-CV-03",
  customerName: "Örnek & Konfeksiyon",
  branchName: null,
  branchCode: null,
  weightKg: 0,
  notes: null,
  shipmentNo: null,
  rolls: [{ barcode: "R0009", itemName: "Linen", colorName: "Ekru", width: 330, qty: 98.6, qualityGrade: "1K" }],
  swatches: [],
};

export const DUMP_SETS: Record<string, SackDump[]> = {
  tekDolu: [DOLU],
  tekBos: [BOS],
  cok: [DOLU, BOS, ESKI],
};

export const DUMP_OPTS: Record<string, SackDumpOptions> = {
  ikisi: { nameMode: "ikisi" },
  bizdeki: { nameMode: "bizdeki" },
  musterideki: { nameMode: "musterideki" },
  ikisiNot: { nameMode: "ikisi", withNotes: true },
  kapsamNot: { nameMode: "ikisi", withNotes: true, scopeLabel: "P2" },
  musteridekiKapsam: { nameMode: "musterideki", scopeLabel: "P-1" },
};

/** Sabit basım anı — HTML'deki "Basım" damgası deterministik olsun. */
export const SABIT_AN = new Date("2026-09-25T11:30:00+03:00");

export function dumpKombinasyonlari(): Array<{ ad: string; dumps: SackDump[]; opts: SackDumpOptions }> {
  const out: Array<{ ad: string; dumps: SackDump[]; opts: SackDumpOptions }> = [];
  for (const [d, dumps] of Object.entries(DUMP_SETS)) {
    for (const [o, opts] of Object.entries(DUMP_OPTS)) out.push({ ad: `${d}/${o}`, dumps, opts });
  }
  return out;
}
