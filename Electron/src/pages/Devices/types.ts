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
  // Etiket Stüdyosu v2: medya cihazın kendinde ("Boyutlar" profili emekli).
  labelWidthMm: number | null;
  labelHeightMm: number | null;
  labelDpi: number | null;
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

/** Yeniden bağlama talebi (cihaz eşleme v2) — `GET /api/admin/devices/rebind-requests`.
 *  Donanım özeti bilinçli olarak taşınmaz (ekranda gösterilmez). */
export interface RebindRequest {
  id: string;
  localId: string;
  kind: DeviceKind;
  model: string | null;
  status: "OPEN" | "APPROVED" | "REJECTED";
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  decidedBy: { id: string; username: string; fullName: string | null } | null;
  target: {
    id: string;
    name: string;
    kind: DeviceKind;
    status: DeviceStatus;
    isActive: boolean;
    lastSeenAt: string | null;
    machine: { id: string; code: string; name: string } | null;
  };
}

export interface RebindRejectBody {
  mode: "REDDET" | "AYRI_CIHAZ";
  reason?: string;
}
