// =============================================================================
// Çalışma Oturumu (WorkSession) API — kim hangi makinede/istasyonda
// =============================================================================
// Oturum açma/kapama CİHAZ bağlamıyla çalışır (x-device-id header'ı api.ts'te
// otomatik). Makine doluysa backend 409 { details: { code: 'MACHINE_OCCUPIED',
// occupiedBy } } döner — çağıran devralma teyidi sorup confirmTakeover ile
// tekrar dener (api.ts interceptor'ı details'i Error.details'e taşır).
// =============================================================================

import { apiClient } from './api';
import { BOOTSTRAP_TIMEOUT_MS } from '../constants/api';
import type { ApiResponse } from '../types/api';
import type { SessionStationKind } from '../constants/stationScreens';

export interface SessionStation {
  id: string;
  code: string;
  name: string;
  kind: SessionStationKind | string;
}

export interface SessionMachine {
  id: string;
  code: string;
  name: string;
  /** Üretim hattı sayısı (çift enli tezgah = 2). Eski sunucu göndermez → 1 varsayılır. */
  productionLineCount?: number | null;
}

export interface ActiveWorkSession {
  id: string;
  machineId: string | null;
  stationId: string;
  startedAt: string;
  machine: SessionMachine | null;
  station: SessionStation;
}

export interface LastPlace {
  machine: (SessionMachine & { isActive: boolean }) | null;
  station: SessionStation & { isActive: boolean };
}

export interface SessionPlace extends SessionStation {
  /** Aktif makineler — boş dizi = MAKİNESİZ istasyon (SHIPPING): oturum istasyonla açılır. */
  machines: SessionMachine[];
}

export interface ResolvedMachine extends SessionMachine {
  station: SessionStation & { isActive: boolean };
}

export const workSessionService = {
  /** Oturum aç — { machineId } XOR { stationId }. Dolu makinede MACHINE_OCCUPIED → confirmTakeover. */
  open: (input: {
    machineId?: string;
    stationId?: string;
    confirmTakeover?: boolean;
  }): Promise<ActiveWorkSession> =>
    apiClient
      .post<ApiResponse<ActiveWorkSession>>('/work-sessions', input)
      .then((r) => r.data.data),

  /** Cihazın aktif oturumunu kapat (LOGOUT — idempotent). */
  close: (): Promise<{ closed: boolean }> =>
    apiClient
      .post<ApiResponse<{ closed: boolean }>>('/work-sessions/close', {})
      .then((r) => r.data.data),

  /** Aktif oturum + son yer (onay ekranı varsayılanı — server-side hafıza).
   *  Kısa timeout: MainNavigator bu cevaba kadar tam ekran spinner'da —
   *  yanıtsız sunucuda 10sn boş ekran yerine ≤5sn'de gate akışına düşülür
   *  (sessionStore.init hatayı yutar, yerel lastPlace snapshot'ı devreye girer). */
  current: (): Promise<{ active: ActiveWorkSession | null; lastPlace: LastPlace | null }> =>
    apiClient
      .get<ApiResponse<{ active: ActiveWorkSession | null; lastPlace: LastPlace | null }>>(
        '/work-sessions/current',
        { timeout: BOOTSTRAP_TIMEOUT_MS },
      )
      .then((r) => r.data.data),

  /** Oturum açılabilir yerler — istasyon-gruplu aktif makine listesi. */
  places: (): Promise<SessionPlace[]> =>
    apiClient
      .get<ApiResponse<SessionPlace[]>>('/work-sessions/places')
      .then((r) => r.data.data),

  /** Makine QR'ı → makine + istasyon (ham machine.code, tam eşleşme). */
  resolveMachine: (code: string): Promise<ResolvedMachine> =>
    apiClient
      .get<ApiResponse<ResolvedMachine>>('/machines/resolve', { params: { code } })
      .then((r) => r.data.data),
};
