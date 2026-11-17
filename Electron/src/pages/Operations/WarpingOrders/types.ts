// =============================================================================
// FASON DEVERE SİPARİŞİ — panel tipleri (`/api/warping-orders`, backend `services/warping-order/*`)
// =============================================================================
// Sayılar sunucudan METİN olarak gelir (Decimal `toFixed(3)`); panel hesap yapmaz, yalnız biçimler.
// =============================================================================

export type WarpingOrderStatus = "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type WarpingFeeUnit = "METRE" | "KG" | "ENDS_METRE";

export const WARPING_ORDER_STATUSES: WarpingOrderStatus[] = ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

export const WARPING_STATUS_META: Record<WarpingOrderStatus, { label: string; badgeClass: string }> = {
  OPEN: { label: "Açık", badgeClass: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  IN_PROGRESS: { label: "Sevkte", badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  COMPLETED: { label: "Kapandı", badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  CANCELLED: { label: "İptal", badgeClass: "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-400" },
};

/** Bilinmeyen durum (yeni backend, eski panel) çökmez: ham adla nötr rozet. */
export function warpingStatusMeta(s: string): { label: string; badgeClass: string } {
  return (WARPING_STATUS_META as Record<string, { label: string; badgeClass: string } | undefined>)[s] ?? { label: `Bilinmeyen (${s})`, badgeClass: WARPING_STATUS_META.CANCELLED.badgeClass };
}

export const WARPING_FEE_UNIT_LABEL: Record<WarpingFeeUnit, string> = {
  METRE: "Metre başına",
  KG: "Kg başına",
  ENDS_METRE: "Tel × metre başına",
};

export const WARPING_CURRENCIES = ["USD", "EUR", "TRY", "GBP", "RUB"] as const;

export interface BeamLine {
  beamCount: number;
  beamLengthM: string;
}

export interface SpecRef {
  id: string;
  code: string;
  name: string;
}

export interface WarpingPlanYarn {
  yarnItemId: string;
  code: string;
  name: string;
  sourceWarpSpecId: string;
  endsCount: number;
  denier: string;
  wastePct: string;
  netKg: string;
  grossKg: string;
}

export interface WarpingOrder {
  id: string;
  orderNo: string;
  status: WarpingOrderStatus;
  warpSpec: SpecRef & { sequenceNote: string | null; reedNo: string | null; reedWidthCm: string | null; endsPerDent: number | null };
  subcontractor: SpecRef;
  beamLines: BeamLine[];
  beamCount: number;
  targetLengthM: string;
  extraSpecs: SpecRef[];
  salesOrders: Array<{ id: string; orderNumber: string; status: string; customerName: string }>;
  fixedWasteM: string;
  wasteTolerancePct: string | null;
  fee: { unit: WarpingFeeUnit; unitPrice: string | null; currency: string | null };
  expectedReturnAt: string | null;
  notes: string | null;
  hasWaste: boolean;
  yarns: Array<WarpingPlanYarn & { letter: string }>;
  totals: { endsCount: number; netKg: string; grossKg: string };
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WarpingOrderRow {
  id: string;
  orderNo: string;
  status: WarpingOrderStatus;
  warpSpec: SpecRef;
  subcontractor: { id: string; name: string };
  beamCount: number;
  targetLengthM: string;
  expectedReturnAt: string | null;
  createdAt: string;
}

export interface WarpingOrderSummary {
  count: number;
  byStatus: Record<WarpingOrderStatus, number>;
  openTargetLengthM: string;
}

export interface WarpingOrderPreview {
  warpSpec: SpecRef;
  extras: SpecRef[];
  suggestedExtraSpecs: SpecRef[];
  beamLines: BeamLine[];
  beamCount: number;
  targetLengthM: string;
  fixedWasteM: string;
  hasWaste: boolean;
  stock: { known: boolean; emanetAcik: boolean };
  yarns: Array<WarpingPlanYarn & { depoKg: string | null; emanetKg: string | null }>;
  totals: { netKg: string; grossKg: string };
}

export interface WarpingOrderCancelPreview {
  order: Pick<WarpingOrder, "id" | "orderNo" | "status" | "targetLengthM" | "beamCount">;
  canCancel: boolean;
  blockedReason: string | null;
  salesOrders: WarpingOrder["salesOrders"];
  affected: { dispatches: number; beams: number };
}

/** Oluşturma/düzenleme gövdesi — route Zod'u (`strictObject`) ile birebir; bilinmeyen anahtar 400. */
export interface WarpingOrderBody {
  warpSpecId?: string;
  subcontractorId?: string;
  beamLines?: Array<{ beamCount: number; beamLengthM: number }>;
  extraWarpSpecIds?: string[];
  fixedWasteM?: number;
  salesOrderIds?: string[];
  wasteTolerancePct?: number | null;
  feeUnit?: WarpingFeeUnit;
  feeUnitPrice?: number | null;
  feeCurrency?: string | null;
  expectedReturnAt?: string | null;
  notes?: string | null;
}
