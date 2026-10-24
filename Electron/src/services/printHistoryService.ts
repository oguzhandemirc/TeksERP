// =============================================================================
// YAZDIRMA GEÇMİŞİ OKUMA — `GET /api/print-jobs` (+ `?ozet=1`) ve `GET /api/print-jobs/:id` (A3)
// =============================================================================
// Uç yanıtı ham gövdedir (`{ data, nextCursor, ozet? }`), ApiResponse sarmalı yok.
// Süzme ve sayma SUNUCUDA; bu istemci yalnız parametreyi taşır.
// =============================================================================
import apiClient from "@/services/apiClient";
import type { PrintOutputKind, PrintStatus, PrintSubjectKind, PrintTransport } from "@/services/printJobService";

export type { PrintOutputKind, PrintStatus, PrintSubjectKind, PrintTransport };

/** Backend `PRINT_SOURCES` aynası (tablet/telefon/sunucu dahil — okuma tarafı hepsini görür). */
export type PrintSource = "PANEL_MASAUSTU" | "PANEL_WEB" | "TABLET" | "TELEFON" | "SUNUCU";

/** Backend `PRINT_JOB_SELECT` aynası. */
export interface PrintJobRow {
  id: string;
  createdAt: string;
  userId: string | null;
  deviceRefId: string | null;
  source: PrintSource;
  outputKind: PrintOutputKind;
  appVersion: string | null;
  stationId: string | null;
  machineId: string | null;
  subjectKind: PrintSubjectKind;
  docType: string | null;
  subjectTable: string | null;
  subjectId: string | null;
  subjectIds: string[];
  subjectNo: string | null;
  printedDocumentId: string | null;
  docVersion: number | null;
  itemCount: number | null;
  copies: number;
  isReprint: boolean | null;
  transport: PrintTransport | null;
  peripheralDeviceId: string | null;
  printerName: string | null;
  printerAddress: string | null;
  language: string | null;
  status: PrintStatus;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  bytes: number | null;
  meta: Record<string, unknown> | null;
  user: { id: string; fullName: string | null; username: string } | null;
  device: { id: string; name: string | null; kind: string | null } | null;
  peripheral: { id: string; name: string | null; code: string | null } | null;
}

export interface PrintJobSummary {
  toplam: number;
  durum: Record<PrintStatus, number>;
  basarili: number;
  pdf: number;
  enCokHata: { peripheralDeviceId: string | null; printerName: string | null; sayi: number } | null;
}

export interface PrintJobPage {
  data: PrintJobRow[];
  nextCursor: string | null;
  ozet?: PrintJobSummary;
}

export const PRINT_HISTORY_PAGE_SIZE = 50;

export const printHistoryService = {
  /** İlk sayfada özet şeridi de istenir — liste ile AYNI parametre, aynı where. */
  list: (params: Record<string, string>, cursor?: string): Promise<PrintJobPage> =>
    apiClient
      .get<PrintJobPage>("/api/print-jobs", {
        params: { ...params, limit: PRINT_HISTORY_PAGE_SIZE, ...(cursor ? { cursor } : { ozet: "1" }) },
        suppressErrorToast: true,
      })
      .then((r) => r.data),

  get: (id: string): Promise<PrintJobRow> =>
    apiClient.get<PrintJobRow>(`/api/print-jobs/${id}`, { suppressErrorToast: true }).then((r) => r.data),
};

/** Eski backend: uç yok → 404. Sayfa bunu "sunucu sürümü desteklemiyor" boş durumuna çevirir. */
export function isEndpointMissing(err: unknown): boolean {
  const e = err as { response?: { status?: number; data?: { details?: { code?: string } } } } | null;
  return e?.response?.status === 404 && !e.response.data?.details?.code;
}
