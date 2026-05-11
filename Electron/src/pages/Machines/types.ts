export interface Machine {
  id: string;
  stationId: string;
  code: string;
  name: string;
  deviceIp: string | null;
  isActive: boolean;
  station?: { id: string; code: string; name: string };
  createdAt: string;
  updatedAt: string;
}
