// Ham duruş kodu eşlemesi tel tipi — backend `machineStopCodeMapService.defaultInclude` aynası.
export interface MachineStopCodeMap {
  id: string;
  collectorType: string;
  rawStopCode: string;
  /** null = kart tipi geneli; dolu = bu tezgahın üst-yazımı (önce o okunur). */
  machineId: string | null;
  stopReasonId: string;
  isActive: boolean;
  machine: { id: string; code: string; name: string } | null;
  stopReason: { id: string; code: string; label: string; isActive: boolean };
  createdAt: string;
  updatedAt: string;
}
