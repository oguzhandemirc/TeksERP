// `GET /api/weaving-orders/loom-load` yanıtının istemci tipi (tek kaynak backend `loom-load.service.ts`).
import type { WeavingOrderStatus } from "../WeavingOrders/types";

export interface LoomLoadJobBase {
  weavingOrderId: string;
  weavingOrderNumber: string;
  status: WeavingOrderStatus;
  itemId: string;
  itemCode: string;
  itemName: string;
  plannedM: number | null;
  producedM: number | null;
  /** max(0, plan − üretilen); açık uçlu işte null. */
  remainingM: number | null;
  plannedStartDate: string | null;
  /** İşin, yoksa ürünün atkı kartındaki sıklık; ikisi de yoksa null. */
  picksPerCm: number | null;
}

export interface LoomLoadJob extends LoomLoadJobBase {
  assignment: "OPEN_RUN" | "MOUNTED_BEAM";
  runStartedAt: string | null;
  /** İş birden çok tezgâhta açık → süre bölüşülemez, `estimatedHours` null. */
  sharedAcrossLooms: boolean;
  estimatedHours: number | null;
}

export interface LoomLoadRow {
  machineId: string;
  code: string;
  name: string;
  planRpm: number | null;
  planEfficiencyPct: number | null;
  jobs: LoomLoadJob[];
  /** Σ saat; bir iş null ise null; işsiz tezgâhta 0. */
  totalEstimatedHours: number | null;
  /** Şimdi + toplam (kesintisiz 24 saat varsayımı); toplam null ise null. */
  estimatedFreeAtIfContinuous: string | null;
}

export interface LoomLoadResponse {
  generatedAt: string;
  assumption: "CONTINUOUS_24H_FROM_NOW";
  looms: LoomLoadRow[];
  unassigned: LoomLoadJobBase[];
}
