// =============================================================================
// TEZGAH (dokuma) API istemcisi — top indirme (doff) + makine başına listeler
// =============================================================================
// Backend: `/machine-doffs` (kaydet · geri al · listeler) ve `/machine-runs?open=true`
// (açık koşumlar). Üçü de `requireDokumaEnabled` arkasında; izinler `mobile:dokuma`
// (ekran) ve `mobile:dokuma-geri-al` (geri alma yeteneği) — `test_mobile_screen_permissions`.
//
// ⚠️ `counterSource` HER yükte gönderilir (`@default` yok); uydurma değer `SIMULATED`
// beyanıyla gider, kararı backend verir. `clientToken` mantıksal deneme başına bir kez
// (`doffAttempt.ts`). Kuyruk YOK: online-only, anlık toast (`kk1.md` kararı).
// =============================================================================
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type { MachineDataSource } from '../types/models';

export interface DoffEvent {
  id: string;
  machineId: string;
  /** Tezgah kodu/adı — masa KK1 listesi tezgahı satırda söyler. Eski sunucu göndermez. */
  machine?: { code: string; name: string } | null;
  productionLineNo: number;
  machineRunId: string | null;
  doffedAt: string;
  pieceCount: number;
  counterAtDoff: number | null;
  counterSource: MachineDataSource;
  /** `DF`+GGAAYY+NNNN — etiket koddan basılır/elle yazılır; toast'ta BÜYÜK basılır. */
  code: string;
  notes: string | null;
  clientToken: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  createdAt: string;
}

/** Liste satırı: doğmuş top sayısı (geri alınamazlık işareti). */
export type DoffListRow = DoffEvent & { rollCount: number };

export interface OpenMachineRun {
  id: string;
  machineId: string;
  productionLineNo: number;
  startedAt: string;
  weavingOrderId: string | null;
  itemId: string | null;
  colorId: string | null;
}

export interface LoomListMeta {
  total: number;
  truncated: boolean;
}

export type LoomListResponse<T> = ApiResponse<T[]> & { meta: LoomListMeta };

export interface OpenDoffRequest {
  machineId: string;
  productionLineNo: number;
  machineRunId: string | null;
  doffedAt: string;
  pieceCount: number;
  counterAtDoff: number | null;
  counterSource: MachineDataSource;
  notes: string | null;
  clientToken: string;
}

export const doffService = {
  /** Makinenin açık koşumları (hat sırasıyla) — "hangi koşuma" seçicisi. */
  listOpenRuns: (machineId: string): Promise<LoomListResponse<OpenMachineRun>> =>
    apiClient
      .get<LoomListResponse<OpenMachineRun>>('/machine-runs', { params: { machineId, open: 'true' } })
      .then((r) => r.data),

  /** Makinenin bugünkü (fabrika günü) indirmeleri — geri al listesi. */
  listToday: (machineId: string): Promise<LoomListResponse<DoffListRow>> =>
    apiClient.get<LoomListResponse<DoffListRow>>('/machine-doffs', { params: { machineId } }).then((r) => r.data),

  /** Bağlanmamış indirmeler (hiç top doğurmamış, geri alınmamış; son 3 gün) — KK1'in
   *  "hangi indirmeden?" listesi. Makine VERİLMEZ: masa KK1 her tezgahı görür (hüküm (a);
   *  makine eşleşmesini backend yalnız tezgah başı KK1'de denetler). */
  listUnlinked: (): Promise<LoomListResponse<DoffListRow>> =>
    apiClient.get<LoomListResponse<DoffListRow>>('/machine-doffs', { params: { unlinked: 'true' } }).then((r) => r.data),

  /** Kaydet: 201 yeni · 201 replay (aynı token → özgün kayıt, `message` "zaten"). */
  /** `idempotent: true` = yeniden gönderim, yeni indirme doğmadı (metne BAKILMAZ). */
  open: (body: OpenDoffRequest): Promise<ApiResponse<DoffEvent> & { idempotent?: true }> =>
    apiClient.post<ApiResponse<DoffEvent> & { idempotent?: true }>('/machine-doffs', body).then((r) => r.data),

  /** Geri al: damga; top doğmuşsa 409 `DOFF_HAS_ROLLS` (barkodlar `details.barcodes`). */
  revoke: (id: string, reason: string): Promise<ApiResponse<DoffEvent>> =>
    apiClient.post<ApiResponse<DoffEvent>>(`/machine-doffs/${id}/revoke`, { reason }).then((r) => r.data),
};
