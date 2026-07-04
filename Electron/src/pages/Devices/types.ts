export type DeviceStatus = "PENDING" | "APPROVED";
export type DeviceKind = "TABLET" | "PHONE" | "DESKTOP";

export interface DeviceListItem {
  id: string;
  deviceId: string;
  name: string;
  kind: DeviceKind;
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

/** Cihaz detayındaki donanım özeti — etiket profili dahil (backend PERIPHERAL_SUMMARY_SELECT). */
export interface PeripheralSummary {
  id: string;
  code: string;
  name: string;
  kind: string;
  connectionType: string;
  languageOverride: string | null;
  formatProfile: { id: string; code: string; name: string } | null;
}

/** Cihazın SON çalışma oturumu — "son oturum açma" başlık verisi. */
export interface DeviceLastSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  user: { id: string; username: string; fullName: string };
  machine: { id: string; code: string; name: string } | null;
  station: { id: string; code: string; name: string; kind: string };
}

/** GET /api/admin/devices/:id — cihaz detayı (İşlem Dökümü başlığı). */
export interface DeviceDetail {
  id: string;
  deviceId: string;
  name: string;
  kind: DeviceKind;
  status: DeviceStatus;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  machineId: string | null;
  machine: {
    id: string;
    code: string;
    name: string;
    station: { id: string; name: string };
  } | null;
  /** Legacy tekil sahiplik + M:N atama birleşik (backend dedup eder). */
  hardware: PeripheralSummary[];
  lastSession: DeviceLastSession | null;
}
