/**
 * Çalışma oturumu (WorkSession) — kim hangi makinede/istasyonda ne zaman (ayak izi).
 * Backend /api/work-sessions kontratı (SESSION_INCLUDE ilişkileriyle).
 */
export type WorkSessionEndReason = "LOGOUT" | "NEW_LOGIN" | "TAKEOVER" | "IDLE" | "ADMIN";

export interface WorkSessionItem {
  id: string;
  userId: string;
  deviceId: string;
  machineId: string | null;
  stationId: string;
  startedAt: string;
  endedAt: string | null;
  endReason: WorkSessionEndReason | null;
  lastActivityAt: string;
  user: { id: string; username: string; fullName: string };
  device: { id: string; deviceId: string; name: string; kind: string };
  machine: { id: string; code: string; name: string } | null;
  station: { id: string; code: string; name: string; kind: string };
  /** Oturum TAKEOVER/NEW_LOGIN ile kapandıysa onu kapatan "devralan" ardıl oturum
   *  (aynı makine/cihazda hemen sonra açılan). Yoksa/uygulanmıyorsa null. */
  successor?: {
    id: string;
    startedAt: string;
    user: { fullName: string };
    device: { name: string };
    machine: { code: string; name: string } | null;
    station: { name: string };
  } | null;
}

export const endReasonLabels: Record<WorkSessionEndReason, string> = {
  LOGOUT: "Çıkış",
  NEW_LOGIN: "Yeni giriş",
  TAKEOVER: "Devralındı",
  IDLE: "Zaman aşımı",
  ADMIN: "Panelden kapatıldı",
};

/** Oturumun bitiş nedeni açıklaması (rozet tooltip'i) — "kim kimden ne devraldı" gibi soruları yanıtlar. */
export const endReasonHints: Record<WorkSessionEndReason, string> = {
  LOGOUT: "Kullanıcı oturumu kendisi kapattı (çıkış yaptı).",
  NEW_LOGIN: "Aynı cihazda yeni bir oturum açıldı (vardiya/kullanıcı değişimi) — bu oturum otomatik kapandı.",
  TAKEOVER: "Başka bir cihaz aynı makinede oturum açıp devraldı — bu oturum otomatik kapandı. Bir makinede aynı anda tek oturum olabilir.",
  IDLE: "Hareketsizlik zaman aşımı — oturum otomatik kapandı.",
  ADMIN: "Yönetici panelden oturumu zorla kapattı.",
};

/** Bitiş rozeti tooltip'i — açıklama + (varsa) devralan oturum ("kim devraldı"). */
export function endReasonTooltip(s: WorkSessionItem): string {
  if (!s.endReason) return "";
  const base = endReasonHints[s.endReason];
  const suc = s.successor;
  if (!suc) return base;
  const who = `${suc.device.name} · ${suc.user.fullName}`;
  if (s.endReason === "TAKEOVER") return `${base}\nDevralan: ${who}`;
  if (s.endReason === "NEW_LOGIN") return `${base}\nYeni oturum: ${who}`;
  return base;
}

/** Oturum yeri — makine varsa "İstasyon — Makine", yoksa istasyon (SHIPPING). */
export function placeLabel(s: Pick<WorkSessionItem, "machine" | "station">): string {
  return s.machine ? `${s.station.name} — ${s.machine.name}` : s.station.name;
}

/** Süre (dk) — endedAt yoksa now'a göre. Negatifler 0'a kırpılır (saat kayması). */
export function sessionDurationMinutes(
  startedAt: string,
  endedAt: string | null,
  now: number = Date.now(),
): number {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60_000));
}

/** "3 sa 25 dk" / "45 dk" biçimli insan-okur süre. */
export function formatDurationMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h} sa ${m} dk` : `${m} dk`;
}

// =============================================================================
// Oturum işlem dökümü — GET /api/work-sessions/:id/activity kontratı.
// Migration'sız atıf: MACHINE = oturum makinesine damgalı (kesin);
// OPERATOR_WINDOW = operatör + zaman penceresi eşleşmesi (kesin kanıt değil).
// Olaylar KRONOLOJİK sırada (giriş < hata < işlem < çıkış); oturum sınırlı
// olduğundan tek çekiş (truncated = üst sınır aşıldı).
// =============================================================================

export type ActivityEventKind =
  | "ROLL_CREATED"
  | "MOVE_IN"
  | "ERROR"
  | "OPERATION"
  | "MOVE_OUT"
  | "ROLL_CANCELLED";
export type ActivityAttribution = "MACHINE" | "OPERATOR_WINDOW";

/** Olay satırındaki top — barkod + kumaş(ürün)/renk adı. */
export interface ActivityRoll {
  id: string;
  barcode: string | null;
  itemName: string | null;
  colorName: string | null;
}

export interface SessionActivityEvent {
  kind: ActivityEventKind;
  id: string;
  at: string;
  attribution: ActivityAttribution;
  roll: ActivityRoll;
  station: { id: string; name: string; kind: string };
  operator: { id: string; username: string; fullName: string } | null;
  machine: { id: string; code: string; name: string } | null;
  operationType?: string;
  metadata?: Record<string, unknown> | null;
  qty?: number | null;
  weight?: number | null;
  notes?: string | null;
  /** ERROR: hatanın tespit edildiği metre noktası. */
  errorMeter?: number | null;
  /** ERROR: hata türü etiketi (snapshot ?? katalog adı). */
  errorType?: string | null;
  /** ROLL_CREATED: topun giriş kaynağı (SUPPLIER_RECEIPT=KK1 kumaş girişi vb.). */
  entrySource?: string;
  /** MOVE_OUT: topun istasyona girişi (enteredAt) ISO. */
  enteredAt?: string | null;
  /** MOVE_OUT: istasyonda kaldığı süre (dk) = exitedAt − enteredAt. */
  stayMinutes?: number | null;
}

export interface SessionActivitySummary {
  rollCreatedCount: number;
  operationCount: number;
  moveInCount: number;
  moveOutCount: number;
  errorCount: number;
  rollCancelledCount: number;
}

export interface SessionActivityResponse {
  success: boolean;
  data: {
    session: WorkSessionItem;
    summary: SessionActivitySummary;
    events: SessionActivityEvent[];
  };
  /** Üst sınır (max) aşıldıysa true — döküm kısmi gösterilir. */
  truncated: boolean;
  max: number;
}
