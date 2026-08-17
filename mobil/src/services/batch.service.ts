import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

/**
 * Kısa parti sayacının anlık durumu (`GET /api/batches/number-state`).
 *
 * `nextCode` bir ÖNİZLEMEDİR, rezervasyon DEĞİL: bu satır okunduktan sonra
 * başka biri parti açarsa gerçekleşen numara farklı olur. Bu yüzden sahada
 * "SIRADAKİ" değil "SON PARTİ" yazılır — planlamacıya fabrikadaki fiziksel
 * plaka setiyle karşılaştırma imkânı verir, söz vermez.
 *
 * `enabled:false` → kısa numara rejimi kapalı; numaralar null gelir ve çağıran
 * hiçbir şey ÇİZMEMELİ (kapalı rejimde "sayaç" kavramı yoktur).
 */
export interface BatchNumberState {
  enabled: boolean;
  lastCode: string | null;
  nextCode: string | null;
  min: number;
  max: number;
}

export const batchService = {
  getNumberState: (): Promise<ApiResponse<BatchNumberState>> =>
    apiClient.get<ApiResponse<BatchNumberState>>('/batches/number-state').then((r) => r.data),
};
