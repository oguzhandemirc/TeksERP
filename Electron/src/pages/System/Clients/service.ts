import apiClient from "@/services/apiClient";

/** Backend sözleşmesi — `GET /api/admin/clients` (Teks-Erp admin.routes.ts). */
export interface ConnectedClientUser {
  id: string;
  username: string;
  fullName: string | null;
  /** En yetkili hesap rozeti. ⚠️ 2026-09-04'ten beri GİZLENMEZ, maskelenmez. */
  isSystemAccount: boolean;
}

export interface ConnectedClient {
  instanceId: string;
  /** electron | mobil | web — künye başlığı bildirmediyse null. */
  kind: string | null;
  version: string | null;
  /** Yayındaki güncel sürüm (`client-version-policy`) — kıyas burada yapılır. */
  expectedVersion: string | null;
  /** Yöneticinin Cihazlar ekranında verdiği ad. Web istemcisinde yoktur. */
  deviceName: string | null;
  deviceKind: string | null;
  /** null = BİLİNMİYOR (kimliksiz istek), "kimse yok" DEĞİL. */
  lastUser: ConnectedClientUser | null;
  /**
   * false = sürüm beyan EDİLMEDİ, User-Agent'tan çıkarıldı. Künye başlıkları
   * 2026-09-04'te geldiği için bu satır "istemci o tarihten eski" demektir —
   * yani kendi kendine güncellenemeyen kurulum tam olarak budur.
   */
  declared: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  active: boolean;
}

export interface ConnectedClientsSnapshot {
  /**
   * "Aktif" eşiği — TEK KAYNAK SUNUCUDA. Ekran kendi eşiğini YAZMAZ; başlıktaki
   * "son N dakikada istek gönderenler" cümlesi bu değerden üretilir. İki yerde
   * ayrı yazılsaydı biri değiştiğinde ekran ölçtüğünden farklı bir eşik iddia
   * ederdi.
   */
  activeWindowMs: number;
  /** Satırın listede kalma süresi — aktiflikten ayrı. */
  retentionMs: number;
  now: string;
  /** Defter süreçle doğar; sunucu yeniden başlarsa liste boşalır. */
  serverStartedAt: string;
  clients: ConnectedClient[];
}

/** Bağlı istemci envanteri — saf veri erişimi (React'e bağlı değil). */
export async function fetchConnectedClients(): Promise<ConnectedClientsSnapshot> {
  const res = await apiClient.get<{ success: boolean; data: ConnectedClientsSnapshot }>(
    "/api/admin/clients",
  );
  return res.data.data;
}
