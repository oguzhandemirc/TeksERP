// Gelen belge (Gülkesim OCR D5) — backend `/api/gelen-belge/*` sözleşmesinin AYNASI.
// Kaynak: `Teks-Erp/src/services/gelen-belge-{note,line,scan,eslestirme,onay}.service.ts` select/dönüş şekilleri.
// Prisma Decimal JSON'da metindir (`meters`/`weightKg`/`widthCm`); hesap `totals.ts`te sayıya çevrilir.

import type { AutoWorkOrderResult } from "./workOrderTypes";
export type {
  AutoWorkOrderGroup,
  AutoWorkOrderResult,
  ChoiceProperty,
  PlanGroup,
  PlanRoll,
  PlanTarget,
  ProcessValuePage,
  WorkOrderPlan,
} from "./workOrderTypes";

export const NOTE_STATUSES = ["DRAFT", "APPROVING", "APPROVED", "PARTIAL", "CANCELLED"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];
export type NoteSourceKind = "OCR" | "MANUAL" | "IMPORT";
export type LineStatus = "PENDING" | "ENTERING" | "ENTERED" | "FAILED" | "SKIPPED";
export type ScanStatus = "PENDING" | "READING" | "READ" | "READ_FAILED";

export interface NamedRef {
  id: string;
  code: string | null;
  name: string;
}

/** Piksel cinsinden, görüntü koordinatında (motor `OcrRect`). */
export interface OcrRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DeclaredBlock {
  blockNo: number;
  count: string | null;
  kg: string | null;
  m: string | null;
}

export interface DeliveryNoteHeader {
  id: string;
  noteNo: string;
  status: NoteStatus;
  sourceKind: NoteSourceKind;
  ownerCustomerId: string | null;
  senderCustomerId: string | null;
  senderText: string | null;
  senderDocNo: string | null;
  senderDocDate: string | null;
  customerBatchNo: string | null;
  processText: string | null;
  templateId: string | null;
  templateScore: number | null;
  pageCount: number | null;
  declaredTopCount: number | null;
  totalsDeclared: { blocks?: DeclaredBlock[] } | null;
  varianceReason: string | null;
  warnings: unknown;
  approvedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  ownerCustomer: NamedRef | null;
  senderCustomer: NamedRef | null;
  _count: { lines: number; scans: number };
}

export interface DeliveryNoteLine {
  id: string;
  noteId: string;
  lineNo: number;
  blockNo: number;
  lineKind: "TOP" | "ARABA";
  senderRollNo: string | null;
  meters: string;
  weightKg: string | null;
  widthCm: string | null;
  itemText: string | null;
  itemId: string | null;
  colorText: string | null;
  colorId: string | null;
  processText: string | null;
  confidence: number | null;
  needsReview: boolean;
  sourceRects: Record<string, OcrRect> | null;
  /** Satırın okunduğu sayfanın taraması (E4); elle/Excel satırında null, eski backend göndermez → undefined. */
  scanId?: string | null;
  status: LineStatus;
  failReason: string | null;
  rollId: string | null;
  item: NamedRef | null;
  color: NamedRef | null;
}

export interface DocumentScanInfo {
  id: string;
  noteId: string | null;
  pageNo: number;
  regionNo: number | null;
  mimeType: string;
  sizeBytes: number;
  status: ScanStatus;
  attempts: number;
}

export interface DeliveryNoteDetail extends DeliveryNoteHeader {
  lines: DeliveryNoteLine[];
  scans: DocumentScanInfo[];
  /** D4-I3: sahibin İŞ KABULÜ kapsamlı aktif cari kilidi (metin sunucudan); eski backend göndermez. */
  cariHold?: { sebepEtiketi: string; koyan: string; message: string } | null;
}

/** Toplu silme önizlemesi (`POST /irsaliyeler/toplu-sil/onizleme`). */
export interface BulkDeletePreviewItem {
  id: string;
  noteNo: string | null;
  status: NoteStatus | null;
  deletable: boolean;
  code: string | null;
  reason: string | null;
  lineCount: number;
  scanCount: number;
  ownerName: string | null;
  senderName: string | null;
  senderDocNo: string | null;
}
export interface BulkDeletePreview {
  items: BulkDeletePreviewItem[];
  summary: { requested: number; deletable: number; blocked: number; lines: number; scans: number };
}
export interface BulkDeleteResultItem {
  id: string;
  noteNo: string | null;
  ok: boolean;
  status: number;
  code: string | null;
  message: string | null;
}
export interface BulkDeleteResult {
  results: BulkDeleteResultItem[];
  summary: { deleted: number; failed: number };
}

export interface DeliveryNoteListResponse {
  items: DeliveryNoteHeader[];
  nextCursor: string | null;
  summary: Record<NoteStatus, number> & { total: number };
}

export interface DeliveryNoteListQuery {
  status?: NoteStatus;
  ownerCustomerId?: string;
  senderCustomerId?: string;
  q?: string;
  /** createdAt aralığı, `YYYY-MM-DD` (sunucu fabrika gününe çözer). */
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface MatchCandidate extends NamedRef {
  score: number;
}
export interface MatchSuggestion {
  rawText: string | null;
  suggested: MatchCandidate | null;
  /** TEMPLATE: gönderen şablonunun bağlı carisi (E2) — en yüksek öncelik. */
  source: "TEMPLATE" | "ALIAS" | "SIMILARITY" | "NONE";
  list: MatchCandidate[];
}
/** İşlem metni → kurşun gramaj çeşidi önerisi (H9). ALIAS: öğrenilmiş · PATTERN: "25 GR" kalıbı · NONE: emin değil. */
export interface ProcessSuggestion {
  rawText: string | null;
  suggested: { id: string; name: string } | null;
  source: "ALIAS" | "PATTERN" | "NONE";
  /** Kurşun dışı çeşit özellikleri (brode deseni vb., D4-D1): özellik başına öneri. Böyle özellik yoksa / eski backend → yok. */
  variants?: Array<{
    propertyId: string;
    suggested: { id: string; name: string } | null;
    source: "ALIAS" | "PATTERN" | "NONE";
  }>;
}
/** Kurşun dışı çeşit kataloğu (D4-D1) — backend `helpers/process-choice-catalog.helper.ts` aynası. */
export interface ProcessChoiceGroup {
  propertyId: string;
  propertyCode: string;
  propertyName: string;
  options: Array<{ id: string; code: string; name: string }>;
}
export interface NoteMatchSuggestions {
  noteId: string;
  sender: MatchSuggestion;
  owner: MatchSuggestion;
  /** Eski backend göndermez → opsiyonel. */
  process?: ProcessSuggestion;
  /** Aktif kurşun gramaj çeşitleri (gelen-belge:read kapsamında; property:read gerekmez). Eski backend göndermez → panel çizilmez. */
  processOptions?: Array<{ id: string; name: string }>;
  /** Kurşun dışı çeşit katalogları (D4-D1); böyle özellik yoksa ya da eski backend → yok (panel yalnız kurşunu çizer). */
  processGroups?: ProcessChoiceGroup[];
  lines: Array<{
    lineId: string;
    lineNo: number;
    item: MatchSuggestion;
    color: MatchSuggestion;
    process?: ProcessSuggestion;
  }>;
  /** Sahibin ETKİN varsayılan ürünü (E4); eski backend göndermez → undefined (panel hüküm vermez). */
  defaultItem?: EffectiveDefaultItem;
}
/** Kaynak: CUSTOMER sahibin varsayılanı · FACTORY fabrika ayarı — backend `gelen-belge-varsayilan.service.ts` aynası. */
export type DefaultItemSource = "CUSTOMER" | "FACTORY";
export interface EffectiveDefaultItem {
  itemId: string | null;
  name: string | null;
  /** null: ne müşteri ne fabrika varsayılanı var (ürünsüz satır onayda 400). */
  source: DefaultItemSource | null;
  /** false + itemId dolu → onay 409 GELEN_BELGE_DEFAULT_ITEM_UNUSABLE (fabrikaya düşmez). */
  usable: boolean;
  problem: string | null;
}
/** Onayda PROCESS sözlüğüne öğretilecek gramaj seçimi; `lineId` null = başlığın işlem metni. */
export interface ProcessChoice {
  lineId: string | null;
  valueId: string;
}

export interface ApproveResult {
  note: DeliveryNoteDetail;
  summary: { entered: number; failed: number; skipped: number; replayed: number; rollIds: string[] };
  /** Yalnız fabrika ayarı açıkken (eski backend / ayar kapalı → yok). */
  autoWorkOrders?: AutoWorkOrderResult;
}

export interface ReaderStatus {
  service: "var" | "yok" | "erisilemiyor" | "gecersiz";
  engine: string | null;
  version: string | null;
}

/** Satır yazım gövdesi (backend `LineBody`; strictObject — fazla anahtar 400). */
export interface LineInput {
  lineKind?: "TOP" | "ARABA";
  blockNo?: number;
  senderRollNo?: string | null;
  meters: number;
  weightKg?: number | null;
  widthCm?: number | null;
  itemText?: string | null;
  itemId?: string | null;
  colorText?: string | null;
  colorId?: string | null;
  processText?: string | null;
  needsReview?: boolean;
}
export type LinePatch = Partial<LineInput> & { skip?: true };

/** Başlık yazımı (backend `Header`). */
export interface HeaderPatch {
  ownerCustomerId?: string | null;
  senderCustomerId?: string | null;
  senderText?: string | null;
  senderDocNo?: string | null;
  senderDocDate?: string | null;
  customerBatchNo?: string | null;
  processText?: string | null;
  pageCount?: number | null;
  declaredTopCount?: number | null;
}

/** E3 hizmet ekseni ayarları — backend `gelen-belge-ayar.service.ts` `IncomingDocSettings` aynası. */
export type UnreviewedApproval = "WARN" | "BLOCK";
export interface IncomingDocumentSettings {
  /** Ürünü seçilmemiş satırın onayda doğacağı ürün; null = ayar boş (bugünkü: satır ürün ister). */
  defaultItem: { id: string; code: string; name: string; problem: string | null } | null;
  unreviewedApproval: UnreviewedApproval;
  defaultUnreviewedApproval: UnreviewedApproval;
  /** Onaydan sonra net gruplara iş emri kendiliğinden; eski backend göndermez (undefined = kapalı). */
  autoWorkOrder?: boolean;
}

/** Gönderen şablonu (E2): dosyadaki motor şablonu + fabrikaya özgü bağ (`GET /sablonlar`). */
export interface SenderTemplateCustomer {
  id: string;
  code: string | null;
  name: string;
  isActive: boolean;
}
export interface SenderTemplateView {
  code: string;
  name: string;
  version: number;
  rowVersion: number | null;
  inEngine: boolean;
  id: string | null;
  isActive: boolean;
  hitCount: number;
  senderCustomer: SenderTemplateCustomer | null;
  defaultOwnerCustomer: SenderTemplateCustomer | null;
  updatedAt: string | null;
}
export interface SenderTemplatePatch {
  isActive?: boolean;
  senderCustomerId?: string | null;
  defaultOwnerCustomerId?: string | null;
}

/** Sahibe özel varsayılan ürün (E4, `gelen-belge:template`) — backend `CustomerDefaultView` aynası. */
export interface CustomerDefaultView {
  customerId: string;
  customer: { id: string; code: string; name: string; isActive: boolean };
  item: { id: string; code: string; name: string };
  /** null = top doğurabilir; dolu = onayda 409 verecek sebep. */
  problem: string | null;
  updatedAt: string;
}
