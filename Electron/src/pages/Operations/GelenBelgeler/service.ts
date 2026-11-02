// Gelen belge servisi — yollar TAM (`/api/...`; apiClient baseURL `/api` içermez).
import apiClient from "@/services/apiClient";
import { withSettingsPassword } from "@/lib/settings-password";
import type { ApiResponse } from "@/types/api";
import type {
  ProcessChoice,
  ApproveResult, DeliveryNoteDetail, DeliveryNoteLine, DeliveryNoteListQuery, DeliveryNoteListResponse,
  HeaderPatch, IncomingDocumentSettings, LineInput, LinePatch, NoteMatchSuggestions, ReaderStatus, SenderTemplatePatch,
  SenderTemplateView, UnreviewedApproval, RouteSuggestionPriority, CustomerDefaultView, ProcessValuePage, WorkOrderPlan,
  BulkDeletePreview, BulkDeleteResult,
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

/** Yükleme başlığı: `clientToken` mantıksal deneme başına (çağıran `useAttemptToken`ten verir). */
export async function createUploadNote(body: { clientToken: string; sourceKind: "MANUAL"; ownerCustomerId: string | null; senderDocNo: string | null }): Promise<DeliveryNoteDetail> {
  return (await apiClient.post<ApiResponse<DeliveryNoteDetail>>(`${BASE}/irsaliyeler`, body)).data.data;
}

/** Tarama yükle (base64 + istemci sha256; sunucu tutmazsa 400 DOCUMENT_SCAN_HASH_MISMATCH). Aynı özet → 200 duplicate. */
export async function uploadScan(body: { contentBase64: string; noteId: string; pageNo: number; sha256: string }): Promise<{ duplicate: boolean }> {
  return (await apiClient.post<ApiResponse<{ duplicate: boolean }>>(`${BASE}/taramalar`, body)).data.data;
}

/** Yeniden okut (READ_FAILED → PENDING). PDF 400 DOCUMENT_SCAN_PDF_NOT_READABLE; servis yoksa 503. */
export async function requeueScan(scanId: string): Promise<unknown> {
  return (await apiClient.post<ApiResponse<unknown>>(`${BASE}/taramalar/${scanId}/oku`)).data.data;
}

export async function updateNoteHeader(id: string, patch: HeaderPatch): Promise<unknown> {
  return (await apiClient.patch<ApiResponse<unknown>>(`${BASE}/irsaliyeler/${id}`, patch)).data.data;
}

export async function deleteDraftNote(id: string): Promise<unknown> {
  return (await apiClient.delete<ApiResponse<unknown>>(`${BASE}/irsaliyeler/${id}`)).data.data;
}

/** Toplu silme önizlemesi — sunucu YAZMAZ; kayıt başına silinebilir mi + neden, satır/sayfa sayısı. */
export async function previewBulkDeleteNotes(ids: string[]): Promise<BulkDeletePreview> {
  return (await apiClient.post<ApiResponse<BulkDeletePreview>>(`${BASE}/irsaliyeler/toplu-sil/onizleme`, { ids })).data.data;
}

/** Toplu silme — her kayıt tekil silme yolundan; kayıt başına sonuç (biri düşerse diğerleri sürer). */
export async function applyBulkDeleteNotes(ids: string[]): Promise<BulkDeleteResult> {
  return (await apiClient.post<ApiResponse<BulkDeleteResult>>(`${BASE}/irsaliyeler/toplu-sil`, { ids })).data.data;
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
export async function approveNote(id: string, varianceReason: string | null, processChoices: readonly ProcessChoice[] = []): Promise<{ result: ApproveResult; warnings: string[] }> {
  // Boş seçimde alan gönderilmez: gövde eski backend'in katı şemasıyla da (strictObject) aynı kalır.
  const r = await apiClient.post<ApiResponse<ApproveResult>>(
    `${BASE}/irsaliyeler/${id}/onay`,
    { ...(varianceReason ? { varianceReason } : {}), ...(processChoices.length ? { processChoices } : {}) },
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
export function updateIncomingDocumentSettings(body: { defaultItemId?: string | null; unreviewedApproval?: UnreviewedApproval; autoWorkOrder?: boolean; defaultRouteTemplateId?: string | null; routeSuggestionPriority?: RouteSuggestionPriority; handwritingOutlierFactor?: number | null }): Promise<IncomingDocumentSettings> {
  return withSettingsPassword((headers) =>
    apiClient.put<ApiResponse<IncomingDocumentSettings>>(`${BASE}/ayarlar`, body, { headers }).then((r) => r.data.data),
  );
}

/** Gönderen şablonları (E2, `gelen-belge:template`): motor şablonları + DB bağı; satırı olmayan şablon `id: null`. */
export async function listSenderTemplates(): Promise<SenderTemplateView[]> {
  return (await apiClient.get<ApiResponse<SenderTemplateView[]>>(`${BASE}/sablonlar`)).data.data;
}

/** Şablon bağını güncelle; yalnız verilen alanlar yazılır. Pasif cari 400; araya giren yazım 409. */
export async function updateSenderTemplate(code: string, patch: SenderTemplatePatch): Promise<SenderTemplateView> {
  return (await apiClient.patch<ApiResponse<SenderTemplateView>>(`${BASE}/sablonlar/${encodeURIComponent(code)}`, patch)).data.data;
}

/** Sahibe özel varsayılan ürünler (E4, `gelen-belge:template`). */
export async function listCustomerDefaults(): Promise<CustomerDefaultView[]> {
  return (await apiClient.get<ApiResponse<CustomerDefaultView[]>>(`${BASE}/varsayilan-urunler`)).data.data;
}

/** Yaz (yoksa doğar). Pasif müşteri / top doğuramayan ürün 400; araya giren yazım 409. */
export async function setCustomerDefault(customerId: string, defaultItemId: string): Promise<CustomerDefaultView> {
  return (await apiClient.put<ApiResponse<CustomerDefaultView>>(`${BASE}/varsayilan-urunler/${customerId}`, { defaultItemId })).data.data;
}

/** Kaldır — sonra fabrika ayarı geçerli. */
export async function removeCustomerDefault(customerId: string): Promise<{ customerId: string }> {
  return (await apiClient.delete<ApiResponse<{ customerId: string }>>(`${BASE}/varsayilan-urunler/${customerId}`)).data.data;
}

/** Belgeden iş emri planı (D4-D2; salt okunur, yalnız APPROVED/PARTIAL — aksi 409 DELIVERY_NOTE_NOT_APPROVED). */
export async function getWorkOrderPlan(noteId: string): Promise<WorkOrderPlan> {
  return (await apiClient.get<ApiResponse<WorkOrderPlan>>(`${BASE}/irsaliyeler/${noteId}/is-emri-plani`)).data.data;
}

/** İşlem çeşidi değer araması — süzme SUNUCUDA (yüzlerce desen); `cursor` opak. */
export async function searchProcessValues(q: { propertyId: string; q?: string; cursor?: string; limit?: number }): Promise<ProcessValuePage> {
  const params = Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ""));
  return (await apiClient.get<ApiResponse<ProcessValuePage>>(`${BASE}/islem-degerleri`, { params })).data.data;
}
