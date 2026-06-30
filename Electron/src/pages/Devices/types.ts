export type DeviceStatus = "PENDING" | "APPROVED";

export interface DeviceListItem {
  id: string;
  deviceId: string;
  name: string;
  machineId: string | null;
  status: DeviceStatus;
  lastSeenAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  machine: {
    id: string;
    code: string;
    name: string;
    station: { id: string; name: string };
  } | null;
  /** Cihaza atanan donanım (M:N join). Paylaşımlı olabilir. */
  hardwareLinks?: {
    peripheral: { id: string; code: string; name: string; kind: string };
  }[];
}
