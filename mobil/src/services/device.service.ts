import { apiClient } from './api';

export interface PairResponse {
  success: boolean;
  data: {
    device: { id: string; deviceId: string; name: string };
    machine: {
      id: string;
      code: string;
      name: string;
      station: { id: string; name: string };
    };
  };
}

export const deviceService = {
  pair: (input: { deviceId: string; code: string }): Promise<PairResponse> =>
    apiClient.post<PairResponse>('/devices/pair', input).then((r) => r.data),

  /**
   * Login öncesi public gate: cihaz eşleştirmesi zorunlu mu? false (default) ise
   * pasif — uygulama Pairing ekranını atlayıp doğrudan Login'e geçer. Auth/eşleşme
   * gerektirmez (backend resolveDevice'tan muaf). Hata/erişimsizlikte false döner
   * (pasif varsayım — operatör en azından Login'e ulaşır).
   */
  getPairingRequired: (): Promise<boolean> =>
    apiClient
      .get<{ success: boolean; data: { required: boolean } }>(
        '/devices/pairing-required',
      )
      .then((r) => r.data?.data?.required ?? false)
      .catch(() => false),
};
