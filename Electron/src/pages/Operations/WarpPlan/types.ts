// Çözgü hesabı tel tipleri — backend `services/warp-plan.service.ts` + `helpers/warp-plan.helper.ts` aynası.
// Her sayı SUNUCUDAN gelir (kg 3 hane, metre 1 hane); istemci yalnız biçimler.

export type WarpPlanMode = "FROM_BEAMS" | "FROM_STOCK";

export interface WarpPlanLineBody {
  yarnItemId: string;
  endsCount: number;
}

export interface WarpPlanBody {
  mode: WarpPlanMode;
  warpSpecId?: string;
  lines?: WarpPlanLineBody[];
  specWastePct?: number | null;
  beamCount?: number;
  beamLengthM?: number;
  fixedWasteM?: number;
  subcontractorId?: string;
}

export type WarpWasteSource =
  | { kind: "SABIT_M"; value: number }
  | { kind: "KART_PCT"; value: number }
  | { kind: "IPLIK_PCT"; value: number; yarnItemId: string };

export interface WarpPlanYarnInfo {
  yarnItemId: string;
  code: string;
  name: string;
  denier: number;
  sortOrder: number;
  emanetKg: number | null;
}

export interface WarpPlanForwardLine {
  yarnItemId: string;
  endsCount: number;
  wastePct: number;
  netKg: number;
  grossKg: number;
  depoKg: number | null;
  fasondaKg: number | null;
  sendKg: number;
  depoShortKg: number | null;
}

export interface WarpPlanForward {
  lengthM: number;
  grossLengthM: number;
  hasWaste: boolean;
  wasteSources: WarpWasteSource[];
  lines: WarpPlanForwardLine[];
  totals: { netKg: number; grossKg: number; sendKg: number };
}

export interface WarpPlanReverseLine {
  yarnItemId: string;
  availableKg: number | null;
  maxLengthM: number | null;
  leftoverKg: number | null;
}

export interface WarpPlanReverse {
  maxLengthM: number | null;
  constraintYarnItemId: string | null;
  insufficient: boolean;
  unknownStock: boolean;
  fullBeams: number | null;
  remainderM: number | null;
  hasWaste: boolean;
  wasteSources: WarpWasteSource[];
  lines: WarpPlanReverseLine[];
}

export interface WarpPlanResult {
  mode: WarpPlanMode;
  warpSpec: { id: string; code: string; name: string } | null;
  fixedWasteM: number;
  stock: { known: boolean; emanetAcik: boolean; subcontractorId: string | null };
  yarns: WarpPlanYarnInfo[];
  forward: WarpPlanForward | null;
  reverse: WarpPlanReverse | null;
}

export type WarpEndsSuggestBody =
  | { kind: "KG_PER_1000M"; yarnItemId: string; kgPer1000m: number }
  | { kind: "REED"; reedPerCm: number; widthCm: number; endsPerDent?: number };

export interface WarpEndsSuggest {
  endsCount: number;
  diffKg: number | null;
  denier: number | null;
}
