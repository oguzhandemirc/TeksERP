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
  /** Çekmenin kaynağı: YAPI (ürün yapısı) · KART (terbiye tarifesi); eski backend göndermez. */
  shrinkSource?: "YAPI" | "KART" | null;
  /** Uygulanan dokuma firesi % (0 = eklenmedi); eski backend göndermez. */
  weavingWastePct?: number;
  plannedM: number | null;
  orderLines: Array<{ orderLineId: string; openM: number | null; allocatedM: number | null }>;
  beamNeeds?: BeamNeed[];
  /** Karar özetleri (yalnız önizleme; `production-proposal-insight.helper` aynası). Hesaplanamayan null, eski backend'de yok. */
  loomSummary?: LoomSummary | null;
  yarnSummary?: YarnSummary | null;
  durationEstimate?: WeavingDurationEstimate | null;
}

export type LoomTier = "READY" | "BEAM_SHORT" | "WARP_CHANGE";

export interface LoomSummary {
  requiredM: number;
  best: {
    machineId: string;
    code: string;
    name: string;
    tier: LoomTier;
    /** Yalnız BEAM_SHORT: takılı leventlerle dokunabilecek metre. */
    weavableM: number | null;
    /** Yalnız WARP_CHANGE: gerekeni karşılayan ilk hazır levent no'su. */
    readyBeamNo: string | null;
    sameDesignRunning: boolean;
    hasOpenRun: boolean;
    widthWarning: boolean;
  };
  counts: Record<LoomTier, number>;
}

export interface YarnSummaryRow {
  yarnItemId: string;
  code: string;
  name: string;
  needKg: number;
  shortKg: number | null;
  /** SY-3 I2: `IPLIK` iplik kartı firesi, `KART` çözgü/atkı fire zinciri; eski backend göndermez. */
  wasteSource?: "IPLIK" | "KART";
  /** SY-3 I1: yalnız iplik ayırma açıkken var — açık dokuma işlerine ayrılan kg (tesis geneli). */
  reservedKg?: number;
  /** SY-3 I1: serbest stok − ayrılan (eksiye inebilir); stok bilinmiyorsa null. */
  freeKg?: number | null;
}

export interface YarnSummary {
  rawM: number;
  yarns: YarnSummaryRow[];
  /** Stok bilinmiyorsa (iplik modülü kapalı) null. */
  totalShortKg: number | null;
  sources: { stock: boolean; openPurchase: boolean; readyBeams: boolean };
}

export interface WeavingDurationEstimate {
  machineId: string;
  picksPerCm: number;
  planRpm: number;
  planEfficiencyPct: number;
  weavingHours: number;
  weavingDays: number;
  hoursUntilDeadline: number | null;
  /** Yalnız dokuma süresi termine sığıyor mu — "yetişir" hükmü DEĞİL; termin yoksa null. */
  weavingOnlyFitsDeadline: boolean | null;
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
  /** Uygulanan dokuma firesi % (yalnız dokuma bölümü hesaplandıysa). */
  weavingWastePct?: number;
  /** Yalnız önizleme: sipariş termini (ISO). */
  deadline?: string | null;
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
