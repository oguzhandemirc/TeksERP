// =============================================================================
// GÖVDE SAYIMI — MOBİL SERVİS (devere S7, 2026-11-22)
// =============================================================================
// Bağlam `GET /beam-bodies/count-context`, önizleme `POST /beam-bodies/count-preview` (salt okuma; ekran izni
// `mobile:govde-sayim`). Düzeltme panelle AYNI elle geçiş uçları (`beam-body:write` ister; düğme yetkisizde yok).
// =============================================================================
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

export type CountScope = { warehouseId: string | null } | { subcontractorId: string };
export type FixKind = 'SHIP_EMPTY' | 'RETURN_EMPTY' | 'MAINTENANCE_IN' | 'MAINTENANCE_OUT' | 'SCRAP';

export interface CountContext {
  warehouses: { id: string; name: string; expectedCount: number }[];
  subcontractors: { id: string; name: string; expectedCount: number }[];
  stockTotal: number;
}

export interface CountSuggestion { kind: FixKind; label: string; subcontractorId?: string; warehouseId?: string; reason?: string }

export interface CountLine {
  id: string;
  bodyNo: string;
  status: string;
  statusLabel: string;
  placeLabel: string;
  code?: string;
  matchedBy?: 'NORMALIZED';
  suggestion: CountSuggestion | null;
}

export interface CountPreview {
  scope: { kind: 'WAREHOUSE' | 'SUBCONTRACTOR'; id: string | null; label: string };
  expectedCount: number;
  matched: CountLine[];
  missing: CountLine[];
  unexpected: CountLine[];
  unknown: { code: string; candidates: string[] }[];
}

export interface TransitionBody { kind: FixKind; subcontractorId?: string | null; warehouseId?: string | null; reason?: string | null }
export interface TransitionPlan { kindLabel: string; from: string; to: string; toLabel: string; warnings: string[]; body: { bodyNo: string; statusLabel: string } }

export const beamBodyCountService = {
  context: async (): Promise<CountContext> => (await apiClient.get<ApiResponse<CountContext>>('/beam-bodies/count-context')).data.data,
  preview: async (scope: CountScope, codes: string[]): Promise<CountPreview> =>
    (await apiClient.post<ApiResponse<CountPreview>>('/beam-bodies/count-preview', { scope, codes })).data.data,
  transitionPreview: async (id: string, body: TransitionBody): Promise<TransitionPlan> =>
    (await apiClient.post<ApiResponse<TransitionPlan>>(`/beam-bodies/${id}/transition-preview`, body)).data.data,
  transition: async (id: string, body: TransitionBody): Promise<ApiResponse<{ bodyNo: string; statusLabel: string }>> =>
    (await apiClient.post<ApiResponse<{ bodyNo: string; statusLabel: string }>>(`/beam-bodies/${id}/transition`, body)).data,
};
