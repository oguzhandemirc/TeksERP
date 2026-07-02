// =============================================================================
// Kartela çeki listesi — donmuş belge (PrintedDocument.snapshot.doc) tipleri.
// Baskı/önizleme artık backend tek-kaynak HTML'inden gelir (renderKartelaCekiHtml);
// bu modül yalnız PrintedDocument generic'leri için tip taşır.
// =============================================================================

/** Donmuş kartela çeki listesindeki tek top satırı. */
export interface KartelaDocRoll {
  sequence: number;
  id: string;
  barcode: string | null;
  itemCode: string | null;
  itemName: string | null;
  colorCode: string | null;
  colorName: string | null;
  dispatchedQty: number;
  dispatchedWeight: number | null;
  qualityGrade: string;
  width: number | null;
}

/** Donmuş kartela çeki listesi payload'ı (PrintedDocument.snapshot.doc). */
export interface KartelaDispatchDoc {
  dispatchNo: string;
  dispatchedAt: string;
  driverName: string | null;
  plateNumber: string | null;
  notes: string | null;
  subcontractor: { id: string; name: string; code: string | null };
  rolls: KartelaDocRoll[];
  totals: { rollCount: number; totalQty: number; totalWeight: number };
}
