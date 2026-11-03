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
  base?: { code: string; keep: Array<"tables" | "sections"> };
}

export interface SuggestPreview {
  matched: boolean;
  score: number;
  fields: Record<string, string | null>;
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
