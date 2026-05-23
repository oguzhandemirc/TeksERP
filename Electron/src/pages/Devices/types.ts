export interface DeviceListItem {
  id: string;
  deviceId: string;
  name: string;
  machineId: string | null;
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
}

export interface PairingCode {
  code: string;
  machineId: string;
  deviceName: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}
