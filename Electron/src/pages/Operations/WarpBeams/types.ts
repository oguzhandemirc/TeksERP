// =============================================================================
// LEVENT — panel tipleri (backend `WarpBeamDto` aynası) · devere Faz 1b
// =============================================================================
// Levent bir `Roll` DEĞİLDİR: kendi varlığı, kendi defteri (`WarpBeamEvent`). Faz 1b
// PLANNED → READY (sarım) → CANCELLED (sarım iptali); F1: READY ⇄ SHIPPED_OUT (fason);
// Faz 3: READY ⇄ MOUNTED (tezgah), terminal EXHAUSTED (bitti) · SCRAPPED (hurda).
// Kalan metre sunucuda türetilir (kolon yok). Köken her leventte SEÇİLİR (§3.9).
// =============================================================================

export type WarpBeamStatus = "PLANNED" | "READY" | "SHIPPED_OUT" | "MOUNTED" | "EXHAUSTED" | "SCRAPPED" | "CANCELLED";
export type WarpBeamOrigin = "IN_HOUSE" | "SUBCONTRACT" | "PURCHASED" | "CONSIGNED";
export type WarpKgSource = "WEIGHED" | "THEORETICAL";
export type WarpBeamMountMethod = "TYING_IN" | "DRAWING_IN" | "HARNESS_CHANGE";
export type WarpLengthSource = "LOOM_COUNTER" | "DIAMETER" | "WEIGHED" | "ESTIMATED";

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
  // Faz 3 — tezgah bağı ve ölçüm izi
  mountPosition: number | null;
  beamRole: string | null;
  mountMethod: WarpBeamMountMethod | null;
  setupStartedAt: string | null;
  setupMinutes: number | null;
  machineCounter: number | null;
  lengthSource: WarpLengthSource | null;
  grossKg: number | null;
  tareKg: number | null;
  fabricLengthM: number | null;
  /** Faz 4: otomatik tüketim hangi toptan; elle tüketimde null. */
  roll: { id: string; barcode: string | null } | null;
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
  /** G3 emanet: malın sahibi (müşteri); null = bizim mal. Eski backend göndermez → opsiyonel okunur. */
  ownerCustomerId?: string | null;
  ownerCustomer?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  warpSpec: { id: string; code: string; name: string; endsCount: number; yarnItem: { id: string; code: string; name: string; linearDensityDen: number | null } };
  subcontractor: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  wound: WarpBeamEvent | null;
  remainingM: number;
  /** Devere Faz 2: levente yüklenen iplik lotları (lotNo, tekil); lotsuz sarım → boş dizi. */
  lots: string[];
  /** Faz 3: yalnız MOUNTED'da dolu ("şu an ne"). */
  currentMachineId: string | null;
  currentPosition: number | null;
  currentMachine: { id: string; code: string; name: string } | null;
}

export interface CancelWoundPreview {
  beamNo: string;
  status: WarpBeamStatus;
  wound: WarpBeamEvent | null;
  issueReversals: Array<{ warehouse: { id: string; name: string }; lot: { id: string; lotNo: string } | null; qtyKg: number }>;
  returnReversals: Array<{ warehouse: { id: string; name: string }; lot: { id: string; lotNo: string } | null; reasonCode: string; qtyKg: number }>;
}

export const WARP_BEAM_STATUSES: WarpBeamStatus[] = ["PLANNED", "READY", "MOUNTED", "SHIPPED_OUT", "EXHAUSTED", "SCRAPPED", "CANCELLED"];

export const WARP_BEAM_STATUS_META: Record<WarpBeamStatus, { label: string; badgeClass: string }> = {
  PLANNED: { label: "Planlandı", badgeClass: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  READY: { label: "Hazır", badgeClass: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  SHIPPED_OUT: { label: "Fasonda", badgeClass: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  MOUNTED: { label: "Tezgahta", badgeClass: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200" },
  EXHAUSTED: { label: "Bitti", badgeClass: "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300" },
  SCRAPPED: { label: "Hurda", badgeClass: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200" },
  CANCELLED: { label: "İptal", badgeClass: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300" },
};

export const WARP_MOUNT_METHOD_LABEL: Record<WarpBeamMountMethod, string> = { TYING_IN: "Düğüm (tying-in)", DRAWING_IN: "Tahar", HARNESS_CHANGE: "Takım değişimi" };
export const WARP_LENGTH_SOURCE_LABEL: Record<WarpLengthSource, string> = { LOOM_COUNTER: "Tezgah sayacı", DIAMETER: "Çap ölçümü", WEIGHED: "Tartı", ESTIMATED: "Tahmin" };
/** Faz 3: kalan defteri (tüket/düzelt/bitir/hurda) yalnız CANLI leventte yazılır. */
export const isLiveBeam = (s: WarpBeamStatus): boolean => s === "READY" || s === "MOUNTED";

export const WARP_BEAM_ORIGIN_LABEL: Record<WarpBeamOrigin, string> = {
  IN_HOUSE: "İçeride sarıldı",
  SUBCONTRACT: "Fasona sardırıldı",
  PURCHASED: "Hazır alındı",
  // G3 emanet: yalnız `emanetEnabled` açıkken seçilebilir (form süzer); etiket liste/rozet için her zaman.
  CONSIGNED: "Müşterinin emanet leventi",
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
