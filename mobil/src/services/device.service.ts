import { apiClient } from './api';
import { getPinnedInstallationId } from '../store/baseUrlStore';
import { parseIdentityPayload, DISCOVERY_IDENTITY_PATH } from '../lib/discovery';
import { getDeviceModel, getHardwareDigest } from '../utils/hardwareId';

/**
 * `REBIND_PENDING`/`REBIND_REJECTED` (eşleme v2): bu donanım başka bir kayıt olarak tanındı,
 * yeniden bağlama yönetici onayı bekliyor/reddedildi. Eski backend hiç göndermez.
 */
export type DeviceAssignmentStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'INACTIVE'
  | 'UNKNOWN'
  | 'REBIND_PENDING'
  | 'REBIND_REJECTED';

export interface DeviceAssignment {
  /**
   * Cihaz onayı ZORUNLU mu? Kararı sunucu taşır (2026-09-04) — onay ekranı
   * koşulu `pairingRequired && status !== 'APPROVED'` (bkz.
   * `navigation/pairingGate.ts`). Alanı taşımayan ESKİ backend'de undefined
   * gelir; o durumda `/devices/pairing-required` ucu taban olur.
   */
  pairingRequired?: boolean;
  /**
   * Onaysız (PENDING) cihaz onay beklemeden yalnız kullanıcı adı + parolayla girebilir mi
   * (`device.unpairedPasswordLogin`). Eski backend göndermez → undefined = bugünkü kapı.
   */
  unpairedPasswordLogin?: boolean;
  status: DeviceAssignmentStatus;
  machineId: string | null;
  machineCode: string | null;
  machineName: string | null;
  stationId: string | null;
  stationName: string | null;
  /** Yalnız REBIND_* cevaplarında: donanımın bağlı olduğu kaydın adı. */
  targetName?: string;
}

/** Yerinde yönetici onayı gövdesi — parola/TOTP yalnız bu istekte yaşar, saklanmaz. */
export interface OnsiteApproveInput {
  localId: string;
  username: string;
  password: string;
  totp?: string;
}

/**
 * Özetin anahtarı: sabitlenmiş kurulum kimliği; kaldır-kur sonrası (sabitleme silinmiş)
 * announce edilen sunucunun kendi kimliği. Bulunamazsa null → `hw` gönderilmez.
 */
async function resolveInstallationId(): Promise<string | null> {
  const pinned = await getPinnedInstallationId();
  if (pinned && pinned.trim()) return pinned.trim();
  try {
    const r = await apiClient.get(DISCOVERY_IDENTITY_PATH.replace(/^\/api/, ''), { timeout: 4000 });
    return parseIdentityPayload(r.data?.data ?? r.data)?.installationId ?? null;
  } catch {
    return null;
  }
}

/** announce gövdesi: eski backend bilinmeyen `hw`/`model`i atar (şema katı değil). */
export async function buildAnnounceBody(input: { deviceId: string; name?: string }) {
  const hw = getHardwareDigest(await resolveInstallationId());
  const model = getDeviceModel();
  return { ...input, ...(hw ? { hw } : {}), ...(model ? { model } : {}) };
}

export const deviceService = {
  /**
   * Tablet boot'ta kendini bildirir. Bilinmiyorsa backend PENDING kaydı açar
   * (admin onaylar+atar). Mevcut atama durumunu döner.
   */
  announce: async (input: { deviceId: string; name?: string }): Promise<DeviceAssignment> =>
    apiClient
      .post<{ success: boolean; data: DeviceAssignment }>('/devices/announce', await buildAnnounceBody(input))
      .then((r) => r.data.data),

  /** Tablette yerinde yönetici onayı (D1 ucu, PUBLIC; JWT verilmez). */
  onsiteApproveRebind: (input: OnsiteApproveInput): Promise<{ targetName: string; status: 'APPROVED' }> =>
    apiClient
      .post<{ success: boolean; data: { targetName: string; status: 'APPROVED' } }>(
        '/devices/rebind-requests/onsite-approve',
        input,
      )
      .then((r) => r.data.data),

  /** Atama durumunu poll'la (x-device-id header interceptor'dan eklenir). */
  getStatus: (): Promise<DeviceAssignment> =>
    apiClient
      .get<{ success: boolean; data: DeviceAssignment }>('/devices/status')
      .then((r) => r.data.data),

  /**
   * Login öncesi public gate: cihaz onayı/ataması zorunlu mu? false (default) ise
   * pasif — uygulama "atama bekleniyor" ekranını atlayıp doğrudan Login'e geçer.
   * Hata/erişimsizlikte false (pasif varsayım — operatör en azından Login'e ulaşır).
   */
  getAssignmentRequired: (): Promise<boolean> =>
    apiClient
      .get<{ success: boolean; data: { required: boolean } }>('/devices/pairing-required')
      .then((r) => r.data?.data?.required ?? false)
      .catch(() => false),
};
