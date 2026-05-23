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
};
