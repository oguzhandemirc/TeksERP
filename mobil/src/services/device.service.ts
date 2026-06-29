import { apiClient } from './api';

export type DeviceAssignmentStatus = 'PENDING' | 'APPROVED' | 'INACTIVE' | 'UNKNOWN';

export interface DeviceAssignment {
  status: DeviceAssignmentStatus;
  machineId: string | null;
  machineCode: string | null;
  machineName: string | null;
  stationId: string | null;
  stationName: string | null;
}

export const deviceService = {
  /**
   * Tablet boot'ta kendini bildirir. Bilinmiyorsa backend PENDING kaydı açar
   * (admin onaylar+atar). Mevcut atama durumunu döner.
   */
  announce: (input: { deviceId: string; name?: string }): Promise<DeviceAssignment> =>
    apiClient
      .post<{ success: boolean; data: DeviceAssignment }>('/devices/announce', input)
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
