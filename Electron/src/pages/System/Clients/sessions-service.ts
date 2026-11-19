import apiClient from "@/services/apiClient";
import type { ConnectedClientUser } from "./service";

/** Backend sözleşmesi — `GET /api/admin/open-sessions` (Teks-Erp open-session.routes.ts). Belirteç kimliği yok. */
export type SessionDeviceType = "ELECTRON" | "MOBILE" | "WEB" | "PATRON";

export interface OpenSession {
  id: string;
  deviceType: SessionDeviceType;
  /** Yöneticinin Cihazlar ekranında verdiği ad (birleşmiş kopya ana ada). */
  deviceName: string | null;
  deviceKind: string | null;
  /** Cihaz kimliğinin ilk 8 karakteri — tam değer listelenmez. */
  deviceIdPrefix: string | null;
  /** Girişte bildirilen sürüm; null = ölçülemedi (eski istemci demek değil). */
  clientVersion: string | null;
  expectedVersion: string | null;
  /** null = oturum açıldıktan sonra hiç istek gelmedi. */
  lastSeenAt: string | null;
  createdAt: string;
  expiresAt: string;
  /** Bu isteği yapan oturum — sonlandırma düğmesi çizilmez. */
  isCurrent: boolean;
  user: ConnectedClientUser;
}

export interface OpenSessionsSnapshot {
  now: string;
  truncated: boolean;
  limit: number;
  sessions: OpenSession[];
}

export async function fetchOpenSessions(search?: string): Promise<OpenSessionsSnapshot> {
  const res = await apiClient.get<{ success: boolean; data: OpenSessionsSnapshot }>("/api/admin/open-sessions", {
    params: search ? { search } : {},
  });
  return res.data.data;
}

export async function revokeOpenSession(id: string): Promise<void> {
  await apiClient.post(`/api/admin/open-sessions/${id}/revoke`, {});
}
