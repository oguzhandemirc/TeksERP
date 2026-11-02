// =============================================================================
// Gelen belge (Gülkesim D7) — tablet "Belge Tara" istemcisi
// =============================================================================
// Tarama + başlık: DRAFT irsaliye + sayfa fotoğrafları. Belge başına tek kayıt kipinde (T2) onay kartı detayı okur,
// başlığı yamar ve `gelen-belge:approve` izniyle onaylar; kural sunucuda. Tarama uçları `gelen-belge:write`; modül kapalıyken 403 MODULE_DISABLED (ekran zaten gizli).
// =============================================================================
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

/** Fotoğraf gövdesi 1–2 MB base64; varsayılan 10 sn atölye Wi-Fi'ında yetmez. */
const UPLOAD_TIMEOUT_MS = 60_000;

export interface InboundDocTabletContext {
  customers: { id: string; name: string }[];
}

export interface CreateDraftNoteBody {
  clientToken: string;
  sourceKind: 'MANUAL';
  ownerCustomerId: string | null;
  senderDocNo: string | null;
  // pageCount GÖNDERİLMEZ: kâğıttaki "1/2" damgasıdır (sayfa kapısı ona bakar), çekilen foto sayısı değil.
}

export interface DraftNote {
  id: string;
  noteNo: string;
  status: string;
}

export interface UploadScanBody {
  contentBase64: string;
  noteId: string;
  pageNo: number;
  barcodeText: string | null;
  sha256: string;
}

export interface UploadScanResult {
  scan: { id: string; sha256: string; noteId: string | null };
  duplicate: boolean;
  boundTo: string | null;
}

/** Okuma durumu — SUNUCU türetir (`readSummaryState`); istemci yalnız gösterir. */
export type ReadSummaryState = 'NO_PAGES' | 'READING' | 'NO_SERVICE' | 'READ' | 'PARTIAL' | 'FAILED';

/** `GET /gelen-belge/irsaliyeler/:id/okuma-ozeti` (tablet izni `gelen-belge:write`). */
export interface ReadSummary {
  noteId: string;
  noteNo: string;
  noteStatus: string;
  state: ReadSummaryState;
  /** Türkçe neden (okunamadı / servis yok / yeniden deneniyor / satır çıkmadı); yoksa null. */
  reason: string | null;
  pages: { total: number; waiting: number; read: number; failed: number };
  lineCount: number;
  reviewCount: number;
  /** ok: null = belgede toplam beyanı yok; true/false onay kapısının cevabı. */
  totals: { declared: boolean; ok: boolean | null; mismatches: string[] };
  warnings: string[];
  /** Okuma uyarıları (sunucu `noteNotices`, panel şeridiyle aynı liste). Eski sunucu göndermez → yok sayılır. */
  notices?: { code: string; title: string; detail: string }[];
  // Parti no + kurşun metresi (taslak başlığı, sunucu çözer). Eski sunucu göndermez → kartta satır yok.
  ourBatchNo?: string | null;
  ourBatchNoKey?: string | null;
  /** Prisma Decimal → JSON'da string gelir; sayı da kabul. */
  kursunMeters?: string | number | null;
  kursunMetersSource?: KursunMetersSource | null;
  kursunMetersReview?: boolean;
  batchNoCandidates?: BatchNoCandidate[];
  kursunMeterCandidates?: Partial<Record<'output' | 'total' | 'input' | 'lineSum', string | number | null>>;
}

export type KursunMetersSource = 'OUTPUT' | 'TOTAL' | 'LINE_SUM' | 'MANUAL';

/** Belgedeki parti no adayı (şablon `batchNoCandidates` sırası). Tablet yalnız sayar/gösterir. */
export interface BatchNoCandidate {
  key?: string;
  field?: string;
  kind?: string;
  label?: string;
  value: string;
}

/** Metre kaynağı değeri: A dilimi düz metin/sayı, panel detayı nesne (`{ value }`) verebilir — ikisi de kabul. */
export type MeterCandidateValue = string | number | { value: string | number } | null;

/** B dilimi: belge başına tek kayıt kapısı — onayla AYNI yüklem; yalnız `entryMode=PER_DOCUMENT` iken gelir. */
export interface PerDocumentGate {
  code: 'KURSUN_METERS_REQUIRED' | 'KURSUN_METERS_REVIEW_PENDING' | null;
  warnings: string[];
  totalsBlocking?: boolean;
}

/** `GET /gelen-belge/irsaliyeler/:id` (gelen-belge:read) — onay kartının okuduğu alt küme. Eski sunucu yeni alanları göndermez. */
export interface InboundNoteDetail {
  id: string;
  noteNo: string;
  status: string;
  ownerCustomerId: string | null;
  ourBatchNo?: string | null;
  ourBatchNoKey?: string | null;
  kursunMeters?: string | number | null;
  kursunMetersSource?: KursunMetersSource | null;
  kursunMetersReview?: boolean;
  batchNoCandidates?: BatchNoCandidate[];
  kursunMeterCandidates?: Partial<Record<'output' | 'total' | 'input' | 'lineSum', MeterCandidateValue>>;
  perDocument?: PerDocumentGate;
  /** Sözleşme 4: belgede okunan metinde güçlü eşleşen müşteri; zayıfsa/eski sunucuda yok → istemci boş bırakır. */
  ownerSuggestion?: OwnerSuggestion | null;
}

export interface OwnerSuggestion {
  customerId: string;
  name: string;
  matchedText: string;
}

/** Gelen belge ayarı (`GET /gelen-belge/ayarlar`) — tabletin okuduğu alt küme. Eski sunucu `formApproval` göndermez. */
export interface InboundDocSettings {
  formApproval?: 'SEPARATE' | 'WITH_WORK_ORDER';
  /** Sözleşme 2 (`production.refakatAutoPrint`); eski sunucu göndermez → kapalı (bugün: elle "Çıktı Al"). */
  refakatAutoPrint?: boolean;
}

/** Sözleşme 3: belgeden tek seferde terbiye iş emri (`POST /gelen-belge/irsaliyeler/:id/is-emri`). */
export interface CreateWorkOrderFromNoteBody {
  clientToken: string;
  ownerCustomerId: string;
  ourBatchNo?: string;
  ourBatchNoKey?: string;
  /** Decimal string; verilince gözden geçirilmiş sayılır. */
  kursunMeters: string;
  routeTemplateId: string;
  stepPlanning?: { sequence: number; plannedMachineId?: string }[];
  targetValues?: { propertyId: string; valueId: string }[];
  notes?: string;
}

export interface CreateWorkOrderFromNoteResult {
  workOrderId: string;
  workOrderNo: string;
  batchNumber: string;
  rollId: string;
}

/** Başlık PATCH alt kümesi (sunucu `UpdateBody` allowlist'i). */
export interface InboundNotePatch {
  ownerCustomerId?: string | null;
  ourBatchNo?: string | null;
  ourBatchNoKey?: string | null;
  kursunMeters?: number | null;
  kursunMetersReviewed?: true;
}

/** Onay gövdesi; `routeTemplateId` yalnız seçildiyse gönderilir (P3 rota geçersiz kılma). */
export interface ApproveNoteBody {
  routeTemplateId?: string;
}

export interface AutoWorkOrderGroup {
  key: string;
  itemName: string;
  rollCount: number;
  outcome: 'OPENED' | 'SKIPPED' | 'FAILED';
  workOrderId?: string;
  workOrderNumber?: string;
  reason?: string;
}

export interface ApproveNoteResult {
  note: { id: string; noteNo: string; status: string };
  summary: { entered: number; failed: number; skipped: number; replayed: number };
  autoWorkOrders?: { opened: number; manual: number; reason: string | null; groups: AutoWorkOrderGroup[] };
  warnings: string[];
}

export const inboundDocService = {
  settings: (): Promise<InboundDocSettings> =>
    apiClient.get<ApiResponse<InboundDocSettings>>('/gelen-belge/ayarlar').then((r) => r.data.data),

  /** Kayıt + top + iş emri tek tx; top doğurur → uzun zaman aşımı. */
  createWorkOrder: (noteId: string, body: CreateWorkOrderFromNoteBody): Promise<CreateWorkOrderFromNoteResult> =>
    apiClient
      .post<ApiResponse<CreateWorkOrderFromNoteResult>>(`/gelen-belge/irsaliyeler/${noteId}/is-emri`, body, { timeout: UPLOAD_TIMEOUT_MS })
      .then((r) => r.data.data),

  tabletContext: (): Promise<ApiResponse<InboundDocTabletContext>> =>
    apiClient.get<ApiResponse<InboundDocTabletContext>>('/gelen-belge/tablet-baglam').then((r) => r.data),

  createDraftNote: (body: CreateDraftNoteBody): Promise<DraftNote> =>
    apiClient.post<ApiResponse<DraftNote>>('/gelen-belge/irsaliyeler', body).then((r) => r.data.data),

  uploadScan: (body: UploadScanBody): Promise<UploadScanResult> =>
    apiClient
      .post<ApiResponse<UploadScanResult>>('/gelen-belge/taramalar', body, { timeout: UPLOAD_TIMEOUT_MS })
      .then((r) => r.data.data),

  readSummary: (noteId: string): Promise<ReadSummary> =>
    apiClient.get<ApiResponse<ReadSummary>>(`/gelen-belge/irsaliyeler/${noteId}/okuma-ozeti`).then((r) => r.data.data),

  noteDetail: (noteId: string): Promise<InboundNoteDetail> =>
    apiClient.get<ApiResponse<InboundNoteDetail>>(`/gelen-belge/irsaliyeler/${noteId}`).then((r) => r.data.data),

  updateNote: (noteId: string, body: InboundNotePatch): Promise<InboundNoteDetail> =>
    apiClient.patch<ApiResponse<InboundNoteDetail>>(`/gelen-belge/irsaliyeler/${noteId}`, body).then((r) => r.data.data),

  /** Onay + oto iş emri; uyarılar zarfın `warnings`inden. Onay top doğurur → uzun zaman aşımı. */
  approveNote: (noteId: string, body: ApproveNoteBody): Promise<ApproveNoteResult> =>
    apiClient
      .post<ApiResponse<Omit<ApproveNoteResult, 'warnings'>>>(`/gelen-belge/irsaliyeler/${noteId}/onay`, body, { timeout: UPLOAD_TIMEOUT_MS })
      .then((r) => ({ ...r.data.data, warnings: r.data.warnings ?? [] })),
};

export type InboundDocApi = Pick<typeof inboundDocService, 'createDraftNote' | 'uploadScan'>;
