import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// 4 puan önizleme ucu (K4P) — YAZMAZ; tablet yalnız puan/100 m² + derece önerisini buradan okur
// (formül aynası yok). Kuyruğa girmez: çevrimdışıysa öneri yoktur, operatör bugünkü gibi seçer.

export type InspectionWireSize = 'UP_TO_3IN' | 'IN_3_TO_6' | 'IN_6_TO_9' | 'OVER_9IN';
export type InspectionWidthSource = 'MANUAL' | 'ITEM_CARD' | 'ROLL_MEASURED' | 'UNKNOWN';

export interface InspectionPreviewRequest {
  rollId?: string;
  /** KK1 doğuşu: top henüz yok — kumaş + form eni. */
  draft?: { itemId: string; widthCm?: number | null };
  defects: { defectTypeId: string; sizeClass?: InspectionWireSize | null; startMeter?: number | null }[];
  inspectedLengthM?: number | null;
}

export interface InspectionPreview {
  totalPoints: number;
  cappedPoints: number;
  widthCm: string | number | null;
  widthSource: InspectionWidthSource;
  pointsPer100M2: string | number | null;
  gradeScore: string | number | null;
  ruleSet: { id: string; name: string; unit: string } | null;
  suggested: { qualityGradeId: string | null; code: string | null; label: string; accepted: boolean } | null;
}

export const qualityInspectionService = {
  preview: (body: InspectionPreviewRequest, signal?: AbortSignal): Promise<ApiResponse<InspectionPreview>> =>
    apiClient.post<ApiResponse<InspectionPreview>>('/quality-inspections/preview', body, { signal }).then((r) => r.data),
};
