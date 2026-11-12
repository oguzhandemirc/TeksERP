// Satır işareti + not — backend `/api/row-marks` (kişisel; tek tek "herkese açık" yapılabilir).
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { RowMarkEntity } from "@/lib/row-mark-entities";

export const ROW_MARK_COLORS = ["YELLOW", "RED", "GREEN", "BLUE", "PURPLE"] as const;
export type RowMarkColor = (typeof ROW_MARK_COLORS)[number];
export const ROW_MARK_NOTE_MAX = 500;
export const ROW_MARK_LOOKUP_MAX = 200;

export interface RowMark {
  recordId: string;
  color: RowMarkColor | null;
  note: string | null;
  shared: boolean;
  mine: boolean;
  ownerName: string | null;
  updatedAt: string;
}

export interface RowMarkInput {
  color: RowMarkColor | null;
  note: string | null;
  shared: boolean;
}

/** Arka plan okuması: hata toast'ı basılmaz (liste kendi hatasını gösterir; işaret yoksa satır yine çizilir). */
export async function lookupRowMarks(entityType: RowMarkEntity, recordIds: string[]): Promise<RowMark[]> {
  const r = await apiClient.post<ApiResponse<{ marks: RowMark[] }>>(
    "/api/row-marks/lookup",
    { entityType, recordIds },
    { suppressErrorToast: true },
  );
  return r.data.data.marks;
}

export async function putRowMark(entityType: RowMarkEntity, recordId: string, input: RowMarkInput): Promise<RowMark | null> {
  const r = await apiClient.put<ApiResponse<{ mark: RowMark | null }>>("/api/row-marks", { entityType, recordId, ...input });
  return r.data.data.mark;
}

export async function listMyRowMarkIds(
  entityType: RowMarkEntity,
  color: RowMarkColor | null,
): Promise<{ recordIds: string[]; hasMore: boolean }> {
  const qs = new URLSearchParams({ entityType, limit: String(ROW_MARK_LOOKUP_MAX) });
  if (color) qs.set("color", color);
  const r = await apiClient.get<ApiResponse<{ recordIds: string[]; hasMore: boolean }>>(`/api/row-marks/mine?${qs.toString()}`);
  return r.data.data;
}
