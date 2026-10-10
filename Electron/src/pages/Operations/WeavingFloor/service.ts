// =============================================================================
// TEZGAH SALONU API İSTEMCİSİ — `GET /api/loom-floor`
// =============================================================================
// ⚠️ YOL TAM YAZILIR ("/api/…") — `apiClient.baseURL` `/api` İÇERMEZ.
// Tel tipleri backend `services/loom-floor.service.ts` + `helpers/loom-floor.helper.ts`
// aynasıdır; tarihler JSON'da ISO metindir. Kapı: `tezgahEnabled` + `loom:live-view`.
// =============================================================================
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";

export type WireLossClass = "UNPLANNED" | "SETUP" | "PLANNED" | "NON_SCHEDULED" | "MINOR";

export interface WireFloorCounts {
  total: number;
  monitored: number;
  running: number;
  stopped: number;
  unmonitored: number;
  overdue: number;
  stoppedByClass: Record<"UNPLANNED" | "SETUP" | "PLANNED" | "NON_SCHEDULED" | "UNCLASSIFIED", number>;
  nowPct: number | null;
  todayPct: number | null;
}

export interface WireOpenStop {
  id: string;
  reasonCode: string | null;
  reasonLabel: string | null;
  lossClass: WireLossClass | null;
  startedAt: string;
  targetMinutes: number | null;
  graceMinutes: number;
  tier: "UNTRACKED" | "WITHIN" | "OVERDUE";
  escalationDueAt: string | null;
  requiresReason: boolean;
  source: string;
}

export interface WireBreakdownRow {
  reasonCode: string | null;
  reasonLabel: string | null;
  lossClass: WireLossClass | null;
  beamSlotNull: boolean;
  stopCount: number;
  stopSec: number;
}

export interface WireLoom {
  id: string;
  code: string;
  name: string;
  hallId: string;
  hallName: string;
  monitoringState: "OFF" | "SHADOW" | "LIVE";
  state: "RUNNING" | "STOPPED" | "UNMONITORED";
  openStop: WireOpenStop | null;
  today: { potSec: number; aptSec: number; availabilityPct: number | null; stopCount: number; breakdown: WireBreakdownRow[] };
  targetUnitsPerMin: number | null;
  job: { weavingOrderNumber: string; itemName: string; colorName: string | null; colorHex: string | null; plannedM: number | null } | null;
  recentStops: { id: string; reasonCode: string | null; lossClass: WireLossClass | null; startedAt: string; endedAt: string | null }[];
  source: string;
}

export interface LoomFloorDto {
  asOf: string;
  factoryDayStart: string;
  shift: { name: string; startsAt: string; endsAt: string } | null;
  graceMinutes: number;
  dokumaEnabled: boolean;
  summary: WireFloorCounts;
  halls: (WireFloorCounts & { hallId: string; hallName: string })[];
  looms: WireLoom[];
}

export const loomFloorService = {
  get: (): Promise<LoomFloorDto> =>
    apiClient.get<ApiResponse<LoomFloorDto>>("/api/loom-floor").then((r) => r.data.data),
};
