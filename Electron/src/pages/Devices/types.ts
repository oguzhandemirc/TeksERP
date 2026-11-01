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
  /** Duyurunun geldiği kaynak (IP, IPv6'da /64) — doğuş olayından. Eski backend/eski satır: yok. */
  announcedFrom?: string | null;
  /** Donanım özeti kaynağı (ANDROID_ID · WIN_MACHINE_GUID · …); özet değeri gösterilmez. */
  hwSource?: string | null;
  /** Birleşmiş kopya → ana kayıt (D4). Eski backend göndermez. */
  mergedIntoId?: string | null;
  mergedAt?: string | null;
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
  /** Kopya ise ana kayıt (D4); eski backend göndermez. */
  mergedInto?: { id: string; name: string; mergedAt: string | null } | null;
  /** Ana kayda birleşmiş kopyalar ("geçmiş kurulumlar"); oturumları yerinde kalır. */
  pastInstallations?: PastInstallation[];
}

export interface PastInstallation {
  id: string;
  deviceId: string;
  name: string;
  kind: DeviceKind;
  createdAt: string;
  lastSeenAt: string | null;
  mergedAt: string | null;
  workSessionCount: number;
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

// ─── Kopya birleştirme (D4) ───
export type MergeConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface MergeCandidateMember {
  id: string;
  deviceId: string;
  name: string;
  kind: DeviceKind;
  isActive: boolean;
  status: DeviceStatus;
  createdAt: string;
  lastSeenAt: string | null;
  confidence: MergeConfidence;
  reasons: string[];
  warnings: string[];
}

export interface MergeCandidateGroup {
  kind: DeviceKind;
  confidence: MergeConfidence;
  target: MergeCandidateMember;
  sources: MergeCandidateMember[];
}

export interface MergeBlocker {
  code: string;
  message: string;
}

export interface MergePreviewSource {
  id: string;
  deviceId: string;
  name: string;
  kind: DeviceKind;
  isActive: boolean;
  status: DeviceStatus;
  createdAt: string;
  lastSeenAt: string | null;
  blockers: MergeBlocker[];
  notes: string[];
  workSessions: {
    count: number;
    staysInPlace: boolean;
    recent: Array<{
      id: string;
      startedAt: string;
      endedAt: string | null;
      user: { id: string; fullName?: string | null; username?: string | null } | null;
      station: { id: string; name: string } | null;
      machine: { id: string; code: string; name: string } | null;
    }>;
  };
  hardwareLinks: Array<{ id: string; code: string; name: string; kind: string; alreadyOnTarget: boolean }>;
  legacyPeripherals: Array<{ id: string; code: string; name: string; kind: string }>;
}

export interface MergePreview {
  target: { id: string; deviceId: string; name: string; kind: DeviceKind; isActive: boolean; status: DeviceStatus };
  targetBlockers: MergeBlocker[];
  sources: MergePreviewSource[];
  undoNote: string;
}

export interface MergeResult {
  target: { id: string; name: string };
  merged: Array<{ id: string; name: string; deviceId: string; movedLinks: number; droppedDuplicateLinks: number; movedPeripherals: number }>;
  mergedAt: string;
}

// ─── Anahtar halkası kaybı (D5) ──────────────────────────────────────────────
export interface RingLoss {
  tespit: string;
  kayipKidler: string[];
  etkilenen: { cihazKaniti: number; pin: number; kart: number; totp: number };
}

export interface ProofLostDevice {
  id: string;
  deviceId: string;
  name: string;
  kind: DeviceKind;
  status: string;
  isActive: boolean;
  machine: { code: string; name: string } | null;
  lastSeenAt: string | null;
  hasHw: boolean;
  kid: string;
}

export interface ProofLostOverview {
  halkaKaybi: RingLoss | null;
  cihazlar: ProofLostDevice[];
  bekleyenler: ProofLostDevice[];
}

export type ProofResetOutcome =
  | { id: string; name: string; sonuc: "SIFIRLANDI"; hasHw: boolean }
  | { id: string; name: string | null; sonuc: "ATLANDI"; neden: "YOK" | "KANIT_YOK" | "HALKADA" | "DEGISTI" };
