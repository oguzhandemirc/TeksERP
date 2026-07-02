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
}

export const endReasonLabels: Record<WorkSessionEndReason, string> = {
  LOGOUT: "Çıkış",
  NEW_LOGIN: "Yeni giriş",
  TAKEOVER: "Devralındı",
  IDLE: "Zaman aşımı",
  ADMIN: "Panelden kapatıldı",
};

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
