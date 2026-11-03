// =============================================================================
// Gelen belge (Gülkesim D7) — tablet "Belge Tara" istemcisi
// =============================================================================
// Tarama + başlık: DRAFT irsaliye + sayfa fotoğrafları. Belge başına tek kayıt kipinde (T2) onay kartı detayı okur,
// başlığı yamar ve `gelen-belge:approve` izniyle onaylar; kural sunucuda. Tarama uçları `gelen-belge:write`; modül kapalıyken 403 MODULE_DISABLED (ekran zaten gizli).
// =============================================================================
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type { ClientOcr } from './deviceOcr';
import type {
  ScanWords,
  SuggestBody,
  SuggestResult,
  TemplateJson,
  UserTemplateDetail,
  UserTemplateView,
} from '../types/inboundDocTeach';

/** Fotoğraf gövdesi 1–2 MB base64; varsayılan 10 sn atölye Wi-Fi'ında yetmez. */
const UPLOAD_TIMEOUT_MS = 60_000;

export interface InboundDocTabletContext {
  customers: { id: string; name: string }[];
  /** Belge masası (K23): kurşun istasyonlarının aktif makineleri. Eski sunucu göndermez → makine seçimi çizilmez. */
  kursunMachines?: DeskKursunMachine[];
}

export interface DeskKursunMachine {
  id: string;
  code: string;
  name: string;
  stationId: string;
}

/** `GET /gelen-belge/rota-onerisi` — sahibin rota önerisi (plan ucuyla tek zincir). */
export interface DeskRouteSuggestion {
  routeTemplateId: string | null;
  routeName: string | null;
  source: 'LAST_WORK_ORDER' | 'CUSTOMER_ROUTE' | 'FACTORY_DEFAULT' | null;
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
  /** S16c: tabletin ML Kit okuması — varsa sunucu okuma servisini atlar (gövde katmanı allowlist'i: alan iki uçta). */
  clientOcr?: ClientOcr;
}

export interface UploadScanResult {
  scan: { id: string; sha256: string; noteId: string | null };
  duplicate: boolean;
  boundTo: string | null;
  /** `READ`: cihaz okuması taslağa işlendi · `FALLBACK`: sunucu okumasına bırakıldı · null/yok: cihaz okuması yok (eski sunucu). */
  deviceOcr?: 'READ' | 'FALLBACK' | null;
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
  /** Taslağın sahibi + müşteri önerisi (OIE): satır formu detay ucu (`gelen-belge:read`) olmadan buradan dolar. Eski sunucu göndermez. */
  ownerCustomerId?: string | null;
  ownerSuggestion?: OwnerSuggestion | null;
  /** S16a: tanıtmada işaretlenen form alanları + katalog önerileri (tek form doldurur). Eski sunucu göndermez. */
  formFields?: DocFormFields | null;
  suggestions?: DocFormSuggestions | null;
}

/** S16a sözleşme 3: belgeden okunan form değerleri (sayılar sunucuda TR biçiminden çözülür; string de kabul). */
export interface DocFormFields {
  hedefMetraj?: number | string | null;
  hedefKg?: number | string | null;
  en?: number | string | null;
  desenText?: string | null;
  renkText?: string | null;
  not?: string | null;
}

/** S16a: `gelenBelge.desenRenkEslesme = ONER` iken adı/kodu tutan katalog kaydı (görevli onaylar). */
export interface DocFormSuggestions {
  targetItem?: { id: string; name: string; code?: string | null } | null;
  targetColor?: { id: string; name: string } | null;
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
  /** Okunduğu şablon (null = GENEL yedekle okundu → tanınmadı); tanıtma (S1b) okur. */
  templateId?: string | null;
  /** Sayfa taramaları; tablet yerel fotoğrafı `sha256` ile eşler (tanıtma). */
  scans?: InboundNoteScan[];
  /** Gönderenin basılı belge no'su (onay kartı K28 vurgusu). */
  senderDocNo?: string | null;
  /** K28 belge fotoğrafı saklama kipi; eski sunucu göndermez (undefined = FULL, vurgu yok). */
  photoRetention?: PhotoRetentionMode;
  /** S16a: okuma özetindekiyle aynı (tek form doldurur). */
  formFields?: DocFormFields | null;
  suggestions?: DocFormSuggestions | null;
}

/** Backend `PhotoRetentionMode` aynası (K28). */
export type PhotoRetentionMode = 'FULL' | 'SHRINK_ON_APPROVAL' | 'DELETE_ON_APPROVAL' | 'DELETE_ON_DISPATCH';

export interface InboundNoteScan {
  id: string;
  pageNo: number;
  sha256: string;
  status: string;
  mimeType: string;
}

export interface OwnerSuggestion {
  customerId: string;
  name: string;
  matchedText: string;
  /** OWNER_TEXT: okunan sahip alanı (alan dolar) · FULL_TEXT: sayfa metninde geçiyor (yalnız sorulur). Eski sunucu göndermez → alan dolar. */
  source?: 'OWNER_TEXT' | 'FULL_TEXT';
}

/** Gelen belge ayarı (`GET /gelen-belge/ayarlar`) — tabletin okuduğu alt küme. Eski sunucu `formApproval` göndermez. */
export interface InboundDocSettings {
  formApproval?: 'SEPARATE' | 'WITH_WORK_ORDER';
  /** Sözleşme 2 (`production.refakatAutoPrint`); eski sunucu göndermez → kapalı (bugün: elle "Çıktı Al"). */
  refakatAutoPrint?: boolean;
  /** S16a `gelenBelge.tabletIeGirisi`; eski sunucu göndermez → IKISI (bugünkü ekran). */
  tabletIeGirisi?: TabletWoEntry;
}

/** Tablet iş emri girişi: IKISI = bugünkü (top + belge) · BELGE = her karo tek formu açar · TOP = yalnız top yolu. */
export type TabletWoEntry = 'IKISI' | 'BELGE' | 'TOP';

/** Sözleşme 3: belgeden tek seferde terbiye iş emri (`POST /gelen-belge/irsaliyeler/:id/is-emri`). */
export interface CreateWorkOrderFromNoteBody {
  clientToken: string;
  ownerCustomerId: string;
  /** null = temizle. */
  ourBatchNo?: string | null;
  ourBatchNoKey?: string;
  /** Decimal string; verilince gözden geçirilmiş sayılır. */
  kursunMeters: string;
  /** Yok = rotasız iş emri (K29; yalnız rota uygulaması "Okutmayla", sunucu SIRALI'da 400 verir). */
  routeTemplateId?: string;
  stepPlanning?: { sequence: number; plannedMachineId?: string | null }[];
  targetValues?: { propertyId: string; valueId: string }[];
  notes?: string;
  /** S1 çok partili belge (≥2 parti); yalnız `/partiler` çok parti dediğinde gider (eski sunucu strict gövdeyle 400 verir). */
  parties?: {
    blockNo: number;
    batchNo: string | null;
    meters: number;
    /** Belge masası: parti başına gramaj / plan makinesi (verilmezse gövdedekiler). */
    targetValues?: { propertyId: string; valueId: string }[];
    stepPlanning?: { sequence: number; plannedMachineId?: string | null }[];
  }[];
  mode?: MultiPartyMode;
  /** K27 WARN: işi süren aynı belge no'lu eşe rağmen kaydet (409 `DELIVERY_NOTE_DUPLICATE_DOC_NO_ACTIVE` sonrası). */
  confirmDuplicateDocNo?: true;
  // S16a tek form alanları (hepsi isteğe bağlı): verilen açık değer toptan türetileni ezer; yoksa bugünkü davranış.
  targetItemId?: string;
  targetColorId?: string;
  /** cm */
  width?: number;
  /** m */
  targetQuantity?: number;
  /** kg */
  targetWeight?: number;
  plannedStartDate?: string;
  plannedEndDate?: string;
  foldType?: string;
  orderLineIds?: string[];
}

export interface CreateWorkOrderFromNoteResult {
  workOrderId: string;
  workOrderNo: string;
  batchNumber: string;
  rollId: string;
  /** Çok partili kayıtta açılan iş emirleri (eski sunucu göndermez). */
  workOrders?: { blockNos: number[]; workOrderId: string; workOrderNo: string; batchNumber: string | null }[];
}

export type MultiPartyMode = 'SINGLE' | 'PER_PARTY';

/** `GET /gelen-belge/irsaliyeler/:id/partiler` — parti özeti + canlı uyarılar + fabrika varsayılan kipi. */
export interface NoteParty {
  blockNo: number;
  batchNo: string | null;
  orderNo: string | null;
  declaredTopCount: number | null;
  declaredMeters: number | null;
  lineCount: number;
  meters: number;
  weightKg: number | null;
  warnings: string[];
}

export interface NotePartiesView {
  parties: NoteParty[];
  warnings: string[];
  multi: boolean;
  defaultMode: MultiPartyMode;
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
  /** K27 WARN: işi süren aynı belge no'lu eşe rağmen onayla (yalnız operatör "Yine de onayla" deyince). */
  confirmDuplicateDocNo?: true;
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

/** Gelen belge ayarı sorgu anahtarı (form kayıt kipi + tablet giriş kipi aynı önbelleği paylaşır). */
export const INBOUND_DOC_SETTINGS_KEY = ['gelen-belge', 'ayarlar'] as const;

export const inboundDocService = {
  settings: (): Promise<InboundDocSettings> =>
    apiClient.get<ApiResponse<InboundDocSettings>>('/gelen-belge/ayarlar').then((r) => r.data.data),

  /** Kayıt + top + iş emri tek tx; top doğurur → uzun zaman aşımı. */
  createWorkOrder: (noteId: string, body: CreateWorkOrderFromNoteBody): Promise<CreateWorkOrderFromNoteResult> =>
    apiClient
      .post<ApiResponse<CreateWorkOrderFromNoteResult>>(`/gelen-belge/irsaliyeler/${noteId}/is-emri`, body, { timeout: UPLOAD_TIMEOUT_MS })
      .then((r) => r.data.data),

  /** Parti özeti; eski sunucu (404) → null = bugünkü tek partili form. */
  noteParties: (noteId: string): Promise<NotePartiesView | null> =>
    apiClient
      .get<ApiResponse<NotePartiesView>>(`/gelen-belge/irsaliyeler/${noteId}/partiler`)
      .then((r) => r.data.data ?? null)
      .catch((e: { status?: number }) => {
        if (e?.status === 404) return null;
        throw e;
      }),

  tabletContext: (): Promise<ApiResponse<InboundDocTabletContext>> =>
    apiClient.get<ApiResponse<InboundDocTabletContext>>('/gelen-belge/tablet-baglam').then((r) => r.data),

  /** Eski sunucuda uç yok (404) → çağıran kısayol sırasına düşer. */
  routeSuggestion: (ownerCustomerId: string | null): Promise<DeskRouteSuggestion> =>
    apiClient
      .get<ApiResponse<DeskRouteSuggestion>>('/gelen-belge/rota-onerisi', { params: ownerCustomerId ? { sahip: ownerCustomerId } : {} })
      .then((r) => r.data.data),

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

  // Belge tipi tanıtma (S1b) — hepsi `gelen-belge:template`; ekran izinsizde çizilmez.
  scanWords: (scanId: string): Promise<ScanWords> =>
    apiClient.get<ApiResponse<ScanWords>>(`/gelen-belge/taramalar/${scanId}/kelimeler`).then((r) => r.data.data),

  /** Öneri + aynı taramada önizleme; YAZMAZ. */
  suggestTemplate: (body: SuggestBody): Promise<SuggestResult> =>
    apiClient.post<ApiResponse<SuggestResult>>('/gelen-belge/sablonlar/oneri', body).then((r) => r.data.data),

  listUserTemplates: (): Promise<UserTemplateView[]> =>
    apiClient.get<ApiResponse<UserTemplateView[]>>('/gelen-belge/sablonlar/ozel').then((r) => r.data.data),

  getUserTemplate: (code: string): Promise<UserTemplateDetail> =>
    apiClient.get<ApiResponse<UserTemplateDetail>>(`/gelen-belge/sablonlar/ozel/${encodeURIComponent(code)}`).then((r) => r.data.data),

  /** Yeni belge tipi; `clientToken` mantıksal deneme başına. */
  createUserTemplate: (body: { name: string; template: TemplateJson; clientToken: string }): Promise<UserTemplateView> =>
    apiClient.post<ApiResponse<UserTemplateView>>('/gelen-belge/sablonlar/ozel', body).then((r) => r.data.data),

  /** Sürümlü güncelleme: araya giren kayıt → 409 USER_TEMPLATE_VERSION_CHANGED. */
  updateUserTemplate: (code: string, body: { expectedVersion: number; template: TemplateJson; name?: string }): Promise<UserTemplateView> =>
    apiClient
      .put<ApiResponse<UserTemplateView>>(`/gelen-belge/sablonlar/ozel/${encodeURIComponent(code)}`, body)
      .then((r) => r.data.data),
};

export type InboundDocApi = Pick<typeof inboundDocService, 'createDraftNote' | 'uploadScan'>;
