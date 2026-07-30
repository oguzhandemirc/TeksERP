// =============================================================================
// Çuval İÇERİK DÖKÜMÜ — normalize veri şekli + iki kaynaktan mapper
// =============================================================================
// Aynı çıktıyı (yazdır / PDF / Excel) iki ekran üretir:
//   • Çuval editörü — bellekteki `useSackContents` verisi (ek ağ çağrısı YOK)
//   • Çuval listesi — `POST /sack-search/content-dump` (N çuval tek istekte)
// İkisi de bu şekle indirgenir → layout tek yerde yaşar, ikiye kopyalanmaz.
//
// Çeki listesi (`PickListRow`) ile karıştırılmamalı: orası ürün·renk·en bazında
// GRUPLU özettir (sahada çuval aramak için), burası TOP BAZLI dökümdür.
// =============================================================================

import type { SackContentDumpSack } from "../types";

/** Döküm satırı — tek top. */
export interface SackDumpRoll {
  barcode: string | null;
  itemName: string;
  colorName: string | null;
  width: number | null;
  qty: number;
  qualityGrade: string | null;
}

/** Döküm bölümü — tek çuval (başlık + toplar + kartelalar). */
export interface SackDump {
  sackNo: string;
  customerName: string | null;
  branchName: string | null;
  /** Şube ihracat kodu — varsa başlıkta "İhracat Kodu: X" olarak görünür. */
  branchCode: string | null;
  weightKg: number | null;
  /** İç not — YALNIZ `withNotes` açıkken basılır (opt-in). */
  notes: string | null;
  /** Sevkiyata atanmışsa sevk no (çıktıda "Sevkiyat: X") — depodaysa null. */
  shipmentNo: string | null;
  rolls: SackDumpRoll[];
  swatches: { barcode: string | null; itemName: string; colorName: string | null }[];
}

/** Döküm çıktı seçenekleri. */
export interface SackDumpOptions {
  /** Çuval notunu bas/indir — kök CLAUDE.md kuralı: iç not her yerde OPT-IN. */
  withNotes?: boolean;
}

export const dumpTotalQty = (d: SackDump): number => d.rolls.reduce((a, r) => a + r.qty, 0);

/** Tüm dökümdeki top satırı sayısı — PDF/yazdır tavan kontrolü için. */
export const dumpRowCount = (dumps: SackDump[]): number =>
  dumps.reduce((a, d) => a + d.rolls.length + d.swatches.length, 0);

/** En az bir çuvalda not var mı — opt-in onay kutusunu göstermeye karar verir. */
export const dumpHasNotes = (dumps: SackDump[]): boolean => dumps.some((d) => !!d.notes);

/**
 * TEK kaynak — `content-dump` yanıtı (sayısal alanlar zaten Number).
 *
 * Editör de liste de bu ucu kullanır; bilinçli olarak bellekteki `getSackContents`
 * verisinden döküm ÜRETİLMEZ: "top fiziksel olarak çuvalda mı" kararı backend'de
 * `SACK_ABSENT_STATUSES` ile verilir (editör tablosu hayalet topu bilerek gösterir,
 * belge saymaz) ve o statü kümesi istemciye KOPYALANMAMALIDIR.
 */
export function fromDumpRows(rows: SackContentDumpSack[]): SackDump[] {
  return rows.map((s) => ({
    sackNo: s.sackNo,
    customerName: s.customer?.name ?? null,
    branchName: s.branch?.name ?? null,
    branchCode: s.branch?.code ?? null,
    weightKg: s.weightKg,
    notes: s.notes,
    shipmentNo: s.shipment?.shipmentNo ?? null,
    rolls: s.rolls.map((r) => ({
      barcode: r.barcode,
      itemName: r.itemName,
      colorName: r.colorName,
      width: r.width,
      qty: r.qty,
      qualityGrade: r.qualityGrade || null,
    })),
    swatches: s.swatches.map((w) => ({
      barcode: w.barcode,
      itemName: w.itemName,
      colorName: w.colorName,
    })),
  }));
}
