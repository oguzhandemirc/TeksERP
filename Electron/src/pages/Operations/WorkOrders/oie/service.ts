// "İş emri oluştur" (Gülkesim K6–K9) panel servisi — backend sözleşmesi (B): kısayol listesi `GET /api/routes?shortcut=1`,
// belgeden tek seferde iş emri `POST /api/gelen-belge/irsaliyeler/:id/is-emri`. Eski backend alanları göndermez →
// kısayol listesi boş sayılır (bugünkü form), uç yoksa 404 satır sonucuna düşer.
import axios from "axios";
import apiClient from "@/services/apiClient";
import type { ApiResponse } from "@/types/api";
import type { MultiPartyMode, NotePartiesView } from "./partyDraft";

/** İş emri kısayolu = `isWorkOrderShortcut` işaretli rota şablonu (sıra `shortcutOrder`). */
export interface WorkOrderShortcut {
  id: string;
  name: string;
  description: string | null;
  shortcutOrder: number;
  stepNames: string[];
  /** Rotada kurşun adımı var mı (sunucu `isKursunStation`; eski sunucuda PROCESS_QC türü). */
  hasKursun: boolean;
}

interface RouteRow {
  id: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
  isWorkOrderShortcut?: boolean;
  shortcutOrder?: number;
  steps?: Array<{ sequence: number; station?: { name: string; kind?: string | null; isKursunStation?: boolean } | null }>;
}

/** Rota adımlarında kurşun istasyonu var mı — sunucu türetir; alan yoksa (eski sunucu) kurşun+KK2 türü yedeği. */
export function routeHasKursunStep(steps: ReadonlyArray<{ station?: { kind?: string | null; isKursunStation?: boolean } | null }> | undefined): boolean {
  return (steps ?? []).some((s) => s.station?.isKursunStation ?? s.station?.kind === "PROCESS_QC");
}

/** `?shortcut=1` sunucuda sayfasız döner (en çok 100). Yanıttan kısayolları süzer: sunucu süzgeci tanımıyorsa (eski backend) bütün rotalar gelir — işaretsizler atılır. */
export function toShortcuts(rows: readonly RouteRow[]): WorkOrderShortcut[] {
  return rows
    .filter((r) => r.isWorkOrderShortcut === true && r.isActive !== false)
    .map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? null,
      shortcutOrder: r.shortcutOrder ?? 0,
      stepNames: [...(r.steps ?? [])].sort((a, b) => a.sequence - b.sequence).map((s) => s.station?.name ?? "?"),
      hasKursun: routeHasKursunStep(r.steps),
    }))
    .sort((a, b) => a.shortcutOrder - b.shortcutOrder || a.name.localeCompare(b.name, "tr"));
}

export const WORK_ORDER_SHORTCUTS_KEY = ["routes", "work-order-shortcuts"] as const;

export async function listWorkOrderShortcuts(): Promise<WorkOrderShortcut[]> {
  const r = await apiClient.get<{ data?: RouteRow[] } | RouteRow[]>("/api/routes", { params: { shortcut: 1 } });
  const body = r.data;
  return toShortcuts(Array.isArray(body) ? body : (body.data ?? []));
}

/** Sözleşme 3 gövdesi. `kursunMeters` Decimal metni ("4521.5"). */
export interface NoteWorkOrderBody {
  clientToken: string;
  ownerCustomerId: string;
  /** null = temizle (formda silinen parti no). */
  ourBatchNo?: string | null;
  ourBatchNoKey?: string;
  kursunMeters: string;
  /** Yok = rotasız İE (K29; yalnız rota uygulaması "Okutmayla"). */
  routeTemplateId?: string;
  stepPlanning?: Array<{ sequence: number; plannedMachineId?: string | null }>;
  targetValues?: Array<{ propertyId: string; valueId: string }>;
  notes?: string;
  /** S1 çok partili belge (≥2 parti); eski backend strict gövdeyle 400 verir — yalnız `/partiler` çok parti dediğinde gider. */
  parties?: Array<{ blockNo: number; batchNo: string | null; meters: number }>;
  mode?: MultiPartyMode;
  /** K27 WARN: işi süren aynı belge no'lu eşe rağmen kaydet (409 `DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE` sonrası). */
  confirmDuplicateDocNo?: boolean;
}

export interface NoteWorkOrderResult {
  workOrderId: string;
  workOrderNo: string;
  batchNumber: string | null;
  rollId: string | null;
  /** Çok partili kayıtta açılan iş emirleri (eski backend göndermez). */
  workOrders?: Array<{ blockNos: number[]; workOrderId: string; workOrderNo: string; batchNumber: string | null }>;
  mode?: MultiPartyMode;
}

/** Parti özeti; eski backend (404) → null = bugünkü tek partili form. */
export async function getNoteParties(noteId: string): Promise<NotePartiesView | null> {
  try {
    const r = await apiClient.get<ApiResponse<NotePartiesView>>(`/api/gelen-belge/irsaliyeler/${noteId}/partiler`, { suppressErrorToast: true });
    return r.data.data ?? null;
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 404) return null;
    throw e;
  }
}

/** Hata toast'unu çağıran yazar (satır/ekran sonucu tek yüzey). */
export async function createWorkOrderFromNote(noteId: string, body: NoteWorkOrderBody): Promise<NoteWorkOrderResult> {
  const r = await apiClient.post<ApiResponse<NoteWorkOrderResult>>(`/api/gelen-belge/irsaliyeler/${noteId}/is-emri`, body, { suppressErrorToast: true });
  return r.data.data;
}

/** Ayar kapalıyken sunucunun 403 kodu (sözleşme 3). */
export const FORM_APPROVAL_DISABLED = "GELEN_BELGE_FORM_APPROVAL_DISABLED";

/** `details.code` (backend AppError sözleşmesi; `body.code` okunmaz). */
export function errorCode(e: unknown): string | null {
  if (!axios.isAxiosError(e)) return null;
  const c = (e.response?.data as { details?: { code?: unknown } } | undefined)?.details?.code;
  return typeof c === "string" ? c : null;
}
