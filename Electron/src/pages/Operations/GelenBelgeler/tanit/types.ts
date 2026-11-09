// Belge tipi tanıtma (S1b) — backend `gelen-belge-tanitma.service` + `gelen-belge-ozel-sablon.service` yanıt aynaları.
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `GET /gelen-belge/taramalar/:id/kelimeler` kelimesi: `rect` OCR (dik) çerçevesi, `photoRect` saklanan fotoğraf çerçevesi. */
export interface ScanWord {
  text: string;
  rect: Rect;
  photoRect: Rect;
  lineNo: number;
  confidence: number | null;
}
export interface ScanWords {
  imageWidth: number;
  imageHeight: number;
  rotation: number;
  words: ScanWord[];
}

export type TemplateJson = Record<string, unknown>;

/** `POST /gelen-belge/sablonlar/oneri` gövdesi (backend `SuggestBody` aynası — strictObject). */
export interface SuggestBody {
  scanId: string;
  name: string;
  assignments: Array<{ field: string; rect: Rect; section?: boolean }>;
  identifiers: string[];
  table?: { columns: Array<{ key: string; header: string }>; totalsLabel?: string | null };
  sectionStartLabel?: string | null;
  /** Güncelle kipi: sunucu bu kullanıcı şablonuyla birleştirip önizler; dönen `template` aynen kaydedilir. */
  base?: { code: string; keep: Array<"tables" | "sections">; drop?: string[] };
  /** ③ Kurallar; yoksa fabrika ayarı (güncellemede kayıtlı kural korunur, `multiParty: null` kaldırır). */
  rules?: { multiParty?: MultiPartyRule | null };
}

export interface SuggestPreview {
  matched: boolean;
  score: number;
  fields: Record<string, string | null>;
  /** Okunan değerin kutusu (OCR çerçevesi; eski sunucuda yok) — güncellemede eski şablonun alanları belge üstünde işaretlenir. */
  fieldRects?: Record<string, Rect>;
  /** Bölüm (parti) başına beyan: yazan top adedi `count`/`topCount`, parti no `batchNo`. */
  blocks?: Array<{ blockNo: number; count?: string | null; m?: string | null; batchNo?: string | null; orderNo?: string | null; topCount?: number | null }>;
  lineCount: number;
  warnings: string[];
}
export interface SuggestResult {
  template: TemplateJson;
  explain: Array<{ field: string; strategy: "anchor" | "roi"; label: string | null; direction: string | null }>;
  errors: string[];
  preview: SuggestPreview | null;
  /** K30-T B4: bu taramada kimlik eşiğini geçen MEVCUT kullanıcı şablonları (güncellenen hariç); eski sunucuda yok. */
  benzerSablonlar?: SimilarTemplate[];
}
export interface SimilarTemplate {
  kod: string;
  ad: string;
  skor: number;
}

export interface UserTemplateView {
  id: string;
  code: string;
  name: string;
  version: number;
  isActive: boolean;
  template: TemplateJson;
  updatedAt: string;
}
export interface UserTemplateDetail extends UserTemplateView {
  versions: Array<{ version: number; createdAt: string; createdById: string | null }>;
}

/** Şablon kuralı `rules.multiParty` (backend `MULTI_PARTY_RULES`); null = kural yok (fabrika ayarı). */
export type MultiPartyRule = "SINGLE" | "PER_PARTY";

/** `PATCH /sablonlar/ozel/:code/tanim` gövdesi (backend `EditBody` aynası — strictObject; verilmeyen parça değişmez). */
export interface TemplateEditBody {
  expectedVersion: number;
  name?: string;
  identifiers?: string[];
  dropFields?: string[];
  rules?: { multiParty: MultiPartyRule | null };
  /** "Barkoddan al" işaretli alanların TAM listesi (fotoğraftaki barkod kesin değer olur); verilmezse dokunulmaz. */
  barcodeFields?: string[];
}
export interface TemplateEditResult extends UserTemplateView {
  changes: Record<string, unknown>;
  warnings: string[];
}

/** `GET /sablonlar/ozel/sifirla-onizleme` satırı (yazmaz). */
export interface TemplateResetPreviewItem {
  code: string;
  name: string;
  version: number;
  isActive: boolean;
  hitCount: number;
  lastReadAt: string | null;
  notesByStatus: Partial<Record<string, number>>;
  drafts: Array<{ id: string; documentNo: string; senderDocNo: string | null; createdAt: string }>;
  draftsTotal: number;
  sender: { id: string; code: string; name: string } | null;
}
export type TemplateResetFailReason = "NOT_FOUND" | "ALREADY_INACTIVE" | "VERSION_CHANGED";
export interface TemplateResetFailure {
  code: string;
  reason: TemplateResetFailReason;
  message: string;
}
export interface TemplateResetPreview {
  items: TemplateResetPreviewItem[];
  failed: TemplateResetFailure[];
}
export interface TemplateResetResult {
  done: Array<{ code: string; version: number }>;
  failed: TemplateResetFailure[];
}
