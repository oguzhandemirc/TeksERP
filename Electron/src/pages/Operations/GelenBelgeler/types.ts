// Gelen belge (Gülkesim OCR D5) — backend `/api/gelen-belge/*` sözleşmesinin AYNASI.
// Kaynak: `Teks-Erp/src/services/gelen-belge-{note,line,scan,eslestirme,onay}.service.ts` select/dönüş şekilleri.
// Prisma Decimal JSON'da metindir (`meters`/`weightKg`/`widthCm`); hesap `totals.ts`te sayıya çevrilir.

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
  cursor?: string;
  limit?: number;
}

export interface MatchCandidate extends NamedRef {
  score: number;
}
export interface MatchSuggestion {
  rawText: string | null;
  suggested: MatchCandidate | null;
  source: "ALIAS" | "SIMILARITY" | "NONE";
  list: MatchCandidate[];
}
export interface NoteMatchSuggestions {
  noteId: string;
  sender: MatchSuggestion;
  owner: MatchSuggestion;
  lines: Array<{ lineId: string; lineNo: number; item: MatchSuggestion; color: MatchSuggestion }>;
}

export interface ApproveResult {
  note: DeliveryNoteDetail;
  summary: { entered: number; failed: number; skipped: number; replayed: number; rollIds: string[] };
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
}
