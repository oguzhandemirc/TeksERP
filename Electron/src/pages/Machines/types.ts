export interface Machine {
  id: string;
  stationId: string;
  code: string;
  name: string;
  isActive: boolean;
  /** Devere Faz 3: levent yuva sayısı (0 = cağlıklı; varsayılan 1). */
  warpBeamSlots: number;
  station?: { id: string; code: string; name: string };
  createdAt: string;
  updatedAt: string;
}
