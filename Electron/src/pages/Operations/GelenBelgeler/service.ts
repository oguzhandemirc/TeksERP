// Gelen belge servisi — yollar TAM (`/api/...`; apiClient baseURL `/api` içermez).
import apiClient from "@/services/apiClient";
import { withSettingsPassword } from "@/lib/settings-password";
import type { ApiResponse } from "@/types/api";
import type {
  ApproveResult, DeliveryNoteDetail, DeliveryNoteLine, DeliveryNoteListQuery, DeliveryNoteListResponse,
  HeaderPatch, IncomingDocumentSettings, LineInput, LinePatch, NoteMatchSuggestions, ReaderStatus, UnreviewedApproval,
} from "./types";

const BASE = "/api/gelen-belge";

export const INCOMING_DOCUMENT_QUERY_KEY = "gelen-belge";

export async function listDeliveryNotes(q: DeliveryNoteListQuery): Promise<DeliveryNoteListResponse> {
  const params = Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ""));
  const r = await apiClient.get<ApiResponse<DeliveryNoteListResponse>>(`${BASE}/irsaliyeler`, { params });
  return r.data.data;
}

export async function getDeliveryNote(id: string): Promise<DeliveryNoteDetail> {
  return (await apiClient.get<ApiResponse<DeliveryNoteDetail>>(`${BASE}/irsaliyeler/${id}`)).data.data;
}

/** Elle taslak: `clientToken` mantıksal deneme başına (çağıran `useAttemptToken`ten verir). */
export async function createManualNote(clientToken: string): Promise<DeliveryNoteDetail> {
  const body = { clientToken, sourceKind: "MANUAL" as const };
  return (await apiClient.post<ApiResponse<DeliveryNoteDetail>>(`${BASE}/irsaliyeler`, body)).data.data;
}

export async function updateNoteHeader(id: string, patch: HeaderPatch): Promise<unknown> {
  return (await apiClient.patch<ApiResponse<unknown>>(`${BASE}/irsaliyeler/${id}`, patch)).data.data;
}

export async function deleteDraftNote(id: string): Promise<unknown> {
  return (await apiClient.delete<ApiResponse<unknown>>(`${BASE}/irsaliyeler/${id}`)).data.data;
}

/** Toplu satır: parti `clientToken`ı zaman aşımı tekrarında satırları ikilemez (D2 sözleşmesi). */
export async function addLines(noteId: string, lines: LineInput[], clientToken: string): Promise<unknown> {
  return (await apiClient.post<ApiResponse<unknown>>(`${BASE}/irsaliyeler/${noteId}/satirlar`, { clientToken, lines })).data.data;
}

export async function updateLine(noteId: string, lineId: string, patch: LinePatch): Promise<DeliveryNoteLine> {
  return (await apiClient.patch<ApiResponse<DeliveryNoteLine>>(`${BASE}/irsaliyeler/${noteId}/satirlar/${lineId}`, patch)).data.data;
}

export async function deleteLine(noteId: string, lineId: string): Promise<unknown> {
  return (await apiClient.delete<ApiResponse<unknown>>(`${BASE}/irsaliyeler/${noteId}/satirlar/${lineId}`)).data.data;
}

export async function getSuggestions(noteId: string): Promise<NoteMatchSuggestions> {
  return (await apiClient.get<ApiResponse<NoteMatchSuggestions>>(`${BASE}/irsaliyeler/${noteId}/eslestirme`)).data.data;
}

/**
 * Onay. 409 `TOTAL_MISMATCH`/`DELIVERY_NOTE_PAGES_MISSING` diyalogda gerekçe ister — toast'u
 * diyalog yazar, apiClient'ınki bastırılır (tek hata yüzeyi).
 */
export async function approveNote(id: string, varianceReason: string | null): Promise<{ result: ApproveResult; warnings: string[] }> {
  const r = await apiClient.post<ApiResponse<ApproveResult>>(
    `${BASE}/irsaliyeler/${id}/onay`,
    varianceReason ? { varianceReason } : {},
    { suppressErrorToast: true },
  );
  return { result: r.data.data, warnings: r.data.warnings ?? [] };
}

export async function getReaderStatus(): Promise<ReaderStatus> {
  return (await apiClient.get<ApiResponse<ReaderStatus>>(`${BASE}/okuma/durum`)).data.data;
}

/** Tarama görüntüsü (yetkili istek; `<img src>` token taşıyamaz). */
export async function fetchScanBlob(scanId: string): Promise<Blob> {
  return (await apiClient.get<Blob>(`${BASE}/taramalar/${scanId}/icerik`, { responseType: "blob" })).data;
}

export const INCOMING_DOCUMENT_SETTINGS_QUERY_KEY = ["gelen-belge", "ayarlar"] as const;

export async function getIncomingDocumentSettings(): Promise<IncomingDocumentSettings> {
  return (await apiClient.get<ApiResponse<IncomingDocumentSettings>>(`${BASE}/ayarlar`)).data.data;
}

/** Yazım `admin:settings` + ayar şifresi (tanımlıysa diyalog `withSettingsPassword`ten). */
export function updateIncomingDocumentSettings(body: { defaultItemId?: string | null; unreviewedApproval?: UnreviewedApproval }): Promise<IncomingDocumentSettings> {
  return withSettingsPassword((headers) =>
    apiClient.put<ApiResponse<IncomingDocumentSettings>>(`${BASE}/ayarlar`, body, { headers }).then((r) => r.data.data),
  );
}
