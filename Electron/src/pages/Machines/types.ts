import type { StationKind } from "@/types/enums";

export interface Machine {
  id: string;
  stationId: string;
  code: string;
  name: string;
  isActive: boolean;
  /** Devere Faz 3: levent yuva sayısı (0 = cağlıklı; varsayılan 1). */
  warpBeamSlots: number;
  /** Planlama (Seyitoğlu temel; eski sunucuda yok): devir/dk, verim %, en geniş çalışma eni (cm). */
  planRpm?: number | null;
  planEfficiencyPct?: number | string | null;
  maxWorkingWidthCm?: number | string | null;
  /** Liste ucu istasyonu gömer (`defaultInclude: { station: true }`); `kind` tezgah etiketi düğmesini açar. */
  station?: { id: string; code: string; name: string; kind?: StationKind };
  createdAt: string;
  updatedAt: string;
}
