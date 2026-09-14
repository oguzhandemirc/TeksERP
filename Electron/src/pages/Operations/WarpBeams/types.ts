// =============================================================================
// LEVENT — panel tipleri (backend `WarpBeamDto` aynası) · devere Faz 1b
// =============================================================================
// Levent bir `Roll` DEĞİLDİR: kendi varlığı, kendi defteri (`WarpBeamEvent`). Faz 1b
// yalnız PLANNED → READY (sarım) → CANCELLED (sarım iptali); MOUNTED/EXHAUSTED Faz 3.
// Kalan metre sunucuda türetilir (kolon yok). Köken her leventte SEÇİLİR (§3.9).
// =============================================================================

export type WarpBeamStatus = "PLANNED" | "READY" | "CANCELLED";
export type WarpBeamOrigin = "IN_HOUSE" | "SUBCONTRACT" | "PURCHASED";
export type WarpKgSource = "WEIGHED" | "THEORETICAL";

export interface WarpBeamEvent {
  id: string;
  kind: string;
  reversesEventId: string | null;
  fromStatus: WarpBeamStatus;
  toStatus: WarpBeamStatus;
  lengthM: number | null;
  machine: { id: string; code: string; name: string } | null;
  endsCount: number | null;
  denier: number | null;
  theoreticalKg: number | null;
  kgSource: WarpKgSource | null;
  sectionCount: number | null;
  endsPerSection: number | null;
  breakCount: number | null;
  startedAt: string | null;
  reasonCode: string | null;
  reason: string | null;
  createdAt: string;
}

export interface WarpBeam {
  id: string;
  beamNo: string;
  warpSpecId: string;
  status: WarpBeamStatus;
  plannedLengthM: number;
  physicalBeamNo: string | null;
  notes: string | null;
  originKind: WarpBeamOrigin;
  subcontractorId: string | null;
  supplierId: string | null;
  createdAt: string;
  updatedAt: string;
  warpSpec: { id: string; code: string; name: string; endsCount: number; yarnItem: { id: string; code: string; name: string; linearDensityDen: number | null } };
  subcontractor: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  wound: WarpBeamEvent | null;
  remainingM: number;
}

export interface CancelWoundPreview {
  beamNo: string;
  status: WarpBeamStatus;
  wound: WarpBeamEvent | null;
  issueReversals: Array<{ warehouse: { id: string; name: string }; qtyKg: number }>;
  returnReversals: Array<{ warehouse: { id: string; name: string }; reasonCode: string; qtyKg: number }>;
}

export const WARP_BEAM_STATUSES: WarpBeamStatus[] = ["PLANNED", "READY", "CANCELLED"];

export const WARP_BEAM_STATUS_META: Record<WarpBeamStatus, { label: string; badgeClass: string }> = {
  PLANNED: { label: "Planlandı", badgeClass: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  READY: { label: "Hazır", badgeClass: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  CANCELLED: { label: "İptal", badgeClass: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300" },
};

export const WARP_BEAM_ORIGIN_LABEL: Record<WarpBeamOrigin, string> = {
  IN_HOUSE: "İçeride sarıldı",
  SUBCONTRACT: "Fasona sardırıldı",
  PURCHASED: "Hazır alındı",
};

export const WARP_KG_SOURCE_LABEL: Record<WarpKgSource, string> = {
  WEIGHED: "Tartıldı",
  THEORETICAL: "Nominal (hesap)",
};

const M = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });
const KG = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 });
export const formatM = (v: number | null | undefined): string => (v == null ? "—" : `${M.format(v)} m`);
export const formatKg = (v: number | null | undefined): string => (v == null ? "—" : `${KG.format(v)} kg`);

/** Nominal kg = tel × denye × metre / 9.000.000 — sunucu `warpTheoreticalKg` formülünün AYNASI (ön hesap; sunucu yeniden hesaplar). */
export function theoreticalKg(endsCount: number, denier: number | null, lengthM: number): number | null {
  if (denier == null || !(lengthM > 0) || !(endsCount > 0)) return null;
  return Math.round(((endsCount * denier * lengthM) / 9_000_000) * 1000) / 1000;
}
