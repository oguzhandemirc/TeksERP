import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// Internal step undo (KK1, vb.). EXTERNAL/TAMBUR adımları için kullanılmaz —
// onların kendi cancel/undo akışları var.

export interface UndoStepFinishRequest {
  rollId: string;
  stepId: string;
}

export const productionService = {
  /**
   * Bir rulonun adım finish'ini geri al. Bu rulonun bu step'teki kapalı
   * movement'ı yeniden açılır; Roll.currentStepId step'e döner. Sonraki
   * step'te iz varsa backend 409 atar — UI mesajı doğrudan göster.
   */
  undoStepFinish: (data: UndoStepFinishRequest): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>('/production/undo-step-finish', data)
      .then((r) => r.data),
};
