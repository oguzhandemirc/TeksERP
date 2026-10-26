import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type {
  DeviceDetail, DeviceListItem, MergeCandidateGroup, MergePreview, MergeResult, ProofLostOverview, ProofResetOutcome,
  RebindRejectBody, RebindRequest,
} from "./types";

const BASE = "/api/admin/devices";
// Talep uçları kendi hatasını gösterir (409 → "başka biri işledi"); eski backend 404 → bölüm gizli.
const QUIET = { suppressErrorToast: true } as const;

export const deviceService = {
  list: (): Promise<ApiResponse<DeviceListItem[]>> =>
    apiClient.get<ApiResponse<DeviceListItem[]>>(BASE).then((r) => r.data),

  /** Cihaz detayı — donanım (etiket profiliyle) + son çalışma oturumu. */
  detail: (id: string): Promise<ApiResponse<DeviceDetail>> =>
    apiClient.get<ApiResponse<DeviceDetail>>(`${BASE}/${id}`).then((r) => r.data),

  /** Cihazı onayla + tür (Tablet/Telefon/PC) + opsiyonel takma ad. (makineId çalışma
   *  oturumu modelinde kullanılmaz — geriye-uyum imzası; null geçilir.) */
  approve: (
    id: string,
    machineId: string | null,
    kind?: string,
    name?: string,
  ): Promise<ApiResponse<DeviceListItem>> =>
    apiClient
      .post<ApiResponse<DeviceListItem>>(`${BASE}/${id}/approve`, {
        machineId,
        ...(kind ? { kind } : {}),
        ...(name && name.trim() ? { name: name.trim() } : {}),
      })
      .then((r) => r.data),

  /** Cihaza donanım (yazıcı/okuyucu) ata — peripheralIds = bu cihazın kullandığı donanım. */
  assignHardware: (id: string, peripheralIds: string[]): Promise<ApiResponse<unknown>> =>
    apiClient
      .post<ApiResponse<unknown>>(`${BASE}/${id}/assign-hardware`, { peripheralIds })
      .then((r) => r.data),

  /** Onayı/atamayı geri al (→ PENDING). */
  revoke: (id: string): Promise<ApiResponse<DeviceListItem>> =>
    apiClient.post<ApiResponse<DeviceListItem>>(`${BASE}/${id}/revoke`).then((r) => r.data),

  rename: (id: string, name: string): Promise<ApiResponse<DeviceListItem>> =>
    apiClient
      .patch<ApiResponse<DeviceListItem>>(`${BASE}/${id}`, { name })
      .then((r) => r.data),

  deactivate: (id: string): Promise<ApiResponse<DeviceListItem>> =>
    apiClient.delete<ApiResponse<DeviceListItem>>(`${BASE}/${id}`).then((r) => r.data),

  reactivate: (id: string): Promise<ApiResponse<DeviceListItem>> =>
    apiClient
      .post<ApiResponse<DeviceListItem>>(`${BASE}/${id}/reactivate`)
      .then((r) => r.data),

  hardDelete: (id: string): Promise<ApiResponse<{ id: string }>> =>
    apiClient
      .delete<ApiResponse<{ id: string }>>(`${BASE}/${id}/permanent`)
      .then((r) => r.data),

  /** Yeniden bağlama talepleri; eski backend (uç yok) → `null`. */
  rebindRequests: (): Promise<RebindRequest[] | null> =>
    apiClient
      .get<ApiResponse<RebindRequest[]>>(`${BASE}/rebind-requests`, QUIET)
      .then((r) => r.data.data ?? [])
      .catch((e: unknown) => {
        if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
        throw e;
      }),

  /** Kopya olabilecek kayıt grupları (D4); eski backend (uç yok) → `null` (şerit gizli). */
  mergeCandidates: (): Promise<{ groups: MergeCandidateGroup[]; scanned: number } | null> =>
    apiClient
      .get<ApiResponse<{ groups: MergeCandidateGroup[]; scanned: number }>>(`${BASE}/merge/candidates`, QUIET)
      .then((r) => r.data.data ?? { groups: [], scanned: 0 })
      .catch((e: unknown) => {
        if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
        throw e;
      }),

  /** Yan etkisiz önizleme: kaynak başına etkilenen her kayıt. */
  mergePreview: (targetId: string, sourceIds: string[]): Promise<MergePreview> =>
    apiClient
      .post<ApiResponse<MergePreview>>(`${BASE}/merge/preview`, { targetId, sourceIds }, QUIET)
      .then((r) => r.data.data as MergePreview),

  merge: (targetId: string, sourceIds: string[]): Promise<MergeResult> =>
    apiClient
      .post<ApiResponse<MergeResult>>(`${BASE}/merge`, { targetId, sourceIds }, QUIET)
      .then((r) => r.data.data as MergeResult),

  undoMerge: (sourceId: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`${BASE}/merge/${sourceId}/undo`, {}, QUIET).then((r) => r.data),

  /** Kanıtı doğrulanamayan cihazlar (D5, yazmaz); eski backend (uç yok) → `null` (bölüm gizli). */
  proofLost: (): Promise<ProofLostOverview | null> =>
    apiClient
      .get<ApiResponse<ProofLostOverview>>(`${BASE}/proof-lost`, QUIET)
      .then((r) => r.data.data ?? { halkaKaybi: null, cihazlar: [], bekleyenler: [] })
      .catch((e: unknown) => {
        if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
        throw e;
      }),

  /** Seçilen cihazlarda kanıtı sıfırla — yeni sır yalnız aynı donanıma. */
  proofReset: (deviceIds: string[]): Promise<{ sonuclar: ProofResetOutcome[] }> =>
    apiClient
      .post<ApiResponse<{ sonuclar: ProofResetOutcome[] }>>(`${BASE}/proof-reset`, { deviceIds }, QUIET)
      .then((r) => r.data.data as { sonuclar: ProofResetOutcome[] }),

  approveRebind: (id: string): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`${BASE}/rebind-requests/${id}/approve`, {}, QUIET).then((r) => r.data),

  /** "Ayrı cihazdır" (`AYRI_CIHAZ`, yeni satır açılır) ya da düz red (`REDDET`). */
  rejectRebind: (id: string, body: RebindRejectBody): Promise<ApiResponse<unknown>> =>
    apiClient.post<ApiResponse<unknown>>(`${BASE}/rebind-requests/${id}/reject`, body, QUIET).then((r) => r.data),
};
