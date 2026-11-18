// Çözgü ihtiyacı → fason devere önerisi tel tipleri (D8) — backend `services/warp-need.service.ts` +
// `helpers/warp-supply.helper.ts` aynası. Her sayı SUNUCUDAN gelir; istemci yalnız biçimler.

export type WarpNeedSource = "FABRIC" | "WEAVING_ORDER" | "ORDER";

export type WarpNeedQuery =
  | { source: "FABRIC"; itemId: string; recipeId?: string; fabricM: number }
  | { source: "WEAVING_ORDER"; weavingOrderId: string }
  | { source: "ORDER"; orderId: string };

export interface WarpNeedOpenOrder {
  id: string;
  orderNo: string;
  status: "OPEN" | "IN_PROGRESS";
  subcontractorName: string;
  targetM: number;
  receivedM: number;
  remainingM: number;
}

export interface WarpNeedRow {
  demandKey: string;
  itemId: string;
  itemName: string;
  role: "GROUND" | "LENO" | "SECONDARY";
  beamMode: "GROUND" | "SEPARATE_BEAM" | "SHARED_BEAM" | "CREEL";
  warpSpecId: string;
  warpSpecCode: string;
  warpSpecName: string;
  takeUpPct: number | null;
  ownBeam: boolean;
  fabricM: number | null;
  requiredM: number | null;
  supply: { stockM: number; plannedBeamM: number; openWarpingM: number; totalM: number } | null;
  committedM: number | null;
  freeM: number | null;
  shortfallM: number | null;
  suggestion: { beamCount: number; beamLengthM: number; totalM: number } | null;
  subcontractor: { id: string; name: string } | null;
  openWarpingOrders: WarpNeedOpenOrder[];
}

export interface WarpNeedResult {
  source: WarpNeedSource;
  sourceLabel: string;
  salesOrder: { id: string; label: string } | null;
  rows: WarpNeedRow[];
  warnings: Array<{ code: string; message: string }>;
}
