// Siparişten üretim önerisi (SY-M1/M2 `POST /api/orders/:id/production-proposal/*`) tel tipleri —
// backend `helpers/production-proposal.helper.ts` + `helpers/beam-need.helper.ts` aynası.
export interface BeamNeed {
  role: "GROUND" | "LENO" | "SECONDARY";
  beamMode: "GROUND" | "SEPARATE_BEAM" | "SHARED_BEAM" | "CREEL";
  warpSpecId: string;
  warpSpecCode: string;
  takeUpPct: number | null;
  ownBeam: boolean;
  requiredM: number | null;
  availableM: number | null;
  shortfallM: number | null;
  proposedBeams: { count: number; lengthM: number } | null;
}

export interface WeavingProposal {
  key: string;
  itemId: string;
  itemName: string;
  recipeId: string | null;
  warpSpecId: string | null;
  weftSpecId: string | null;
  weaveDesignId: string | null;
  shrinkPct: number | null;
  plannedM: number | null;
  orderLines: Array<{ orderLineId: string; openM: number | null; allocatedM: number | null }>;
  beamNeeds?: BeamNeed[];
}

export interface WorkOrderProposal {
  key: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  width: number | null;
  routeId: string | null;
  foldType: string | null;
  targetQuantity: number | null;
  orderLines: Array<{ orderLineId: string; allocatedQty: number }>;
  blockedCode: string | null;
}

export interface ProductionProposal {
  orderId: string;
  orderNumber: string;
  weavingOrders: WeavingProposal[];
  workOrders: WorkOrderProposal[];
  excluded: Array<{ orderLineId: string; kind: "WEAVING" | "WORK_ORDER" | "LINE"; code: string }>;
  canCreate: { weaving: boolean; workOrder: boolean };
}

export interface ProposalApplyBody {
  clientToken: string;
  weavingOrders: Array<{ key: string; orderLineIds: string[]; plannedM: number | null }>;
  workOrders: Array<{ key: string; orderLineIds: string[] }>;
}

export interface ProposalApplyResult {
  weavingOrders: Array<{ id: string; number: string }>;
  workOrders: Array<{ id: string; number: string }>;
}
