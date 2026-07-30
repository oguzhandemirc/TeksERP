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

import type { SackContentDumpSack, SackContents } from "../types";

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
 * Editör kaynağı — bellekteki tek çuval dökümü. `SackContents.customer/branch`
 * çuvalın KENDİ müşterisidir (sevkiyattan bağımsız); sevkiyata atanmış çuvalda
 * bile doğru ad basılır.
 */
export function fromSackContents(data: SackContents): SackDump {
  return {
    sackNo: data.sackNo,
    customerName: data.customer?.name ?? null,
    branchName: data.branch?.name ?? null,
    branchCode: data.branch?.code ?? null,
    // Decimal alanlar bu uçta string gelebilir (getSackContents Number()'a çevirmiyor).
    weightKg: data.weightKg == null ? null : Number(data.weightKg),
    notes: data.notes,
    shipmentNo: data.shipment?.shipmentNo ?? null,
    rolls: data.rolls.map((r) => ({
      barcode: r.barcode,
      itemName: r.item.name,
      colorName: r.color?.name ?? null,
      width: r.width == null ? null : Number(r.width),
      qty: Number(r.currentQty),
      qualityGrade: r.qualityGrade || null,
    })),
    swatches: data.swatches.map((s) => ({
      barcode: s.barcode,
      itemName: s.item.name,
      colorName: s.color?.name ?? null,
    })),
  };
}

/** Liste kaynağı — `content-dump` yanıtı (sayısal alanlar zaten Number). */
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
