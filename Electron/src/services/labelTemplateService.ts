import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";

export const LabelKind = {
  ROLL_RAW: "ROLL_RAW",
  ROLL_FINISHED: "ROLL_FINISHED",
  SWATCH: "SWATCH",
} as const;
export type LabelKind = (typeof LabelKind)[keyof typeof LabelKind];

export const labelKindLabels: Record<LabelKind, string> = {
  ROLL_RAW: "Ham Kumaş Etiketi",
  ROLL_FINISHED: "Bitmiş Kumaş Etiketi",
  SWATCH: "Kartela Etiketi",
};

export type FieldType = "text" | "number" | "date" | "qr" | "barcode" | "table";

// Uzman raw-code: yazıcı dili → kod. Anahtarlar backend PrinterLanguage ile birebir.
export const RawCodeLang = {
  PPLA: "PPLA",
  PPLB: "PPLB",
  ZPL: "ZPL",
  RASTER_HTML: "RASTER_HTML",
} as const;
export type RawCodeLang = (typeof RawCodeLang)[keyof typeof RawCodeLang];
export type RawCodeMap = Partial<Record<RawCodeLang, string>>;

export const rawCodeLangLabels: Record<RawCodeLang, string> = {
  PPLA: "PPLA (Argox/Datamax)",
  PPLB: "PPLB (Eltron/EPL)",
  ZPL: "ZPL (Zebra)",
  RASTER_HTML: "HTML (raster)",
};

export interface TemplateField {
  key: string;
  label: string;
  order: number;
  isVisible: boolean;
  isBold?: boolean;
  fontSize?: "sm" | "md" | "lg" | "xl";
}

export interface LabelTemplate {
  id: string;
  name: string;
  kind: LabelKind;
  isDefault: boolean;
  isActive: boolean;
  fields: TemplateField[];
  /** Uzman raw-code override (dil→kod). Boş/yok → o dilde otomatik üretim. */
  rawCode?: RawCodeMap | null;
  /** Yerleşim (şablon-başına, opsiyonel). Boş → font-türevli/varsayılan. */
  lineStepMm?: number | null;
  qrScale?: number | null;
  /** Sağ kenar dikey metraj bandı (siyah zemin/beyaz değer). */
  lengthBanner?: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogField {
  key: string;
  defaultLabel: string;
  type: FieldType;
  required?: boolean;
}

export interface CatalogResponse {
  kind: LabelKind;
  fields: CatalogField[];
}

export const labelTemplateService = {
  list: (kind?: LabelKind): Promise<ApiResponse<LabelTemplate[]>> => {
    const q = kind ? `?kind=${kind}` : "";
    return apiClient
      .get<ApiResponse<LabelTemplate[]>>(`/api/label-templates${q}`)
      .then((r) => r.data);
  },

  getById: (id: string): Promise<ApiResponse<LabelTemplate>> =>
    apiClient
      .get<ApiResponse<LabelTemplate>>(`/api/label-templates/${id}`)
      .then((r) => r.data),

  getCatalog: (kind: LabelKind): Promise<ApiResponse<CatalogResponse>> =>
    apiClient
      .get<ApiResponse<CatalogResponse>>(`/api/label-templates/catalog/${kind}`)
      .then((r) => r.data),

  /** "Varsayılana dön" — bu tür için önerilen alanlar + yerleşim (metraj bandı dahil). */
  getDefaults: (
    kind: LabelKind,
  ): Promise<{ fields: TemplateField[]; lineStepMm: number; qrScale: number; lengthBanner: boolean }> =>
    apiClient
      .get<
        ApiResponse<{ fields: TemplateField[]; lineStepMm: number; qrScale: number; lengthBanner: boolean }>
      >(`/api/label-templates/defaults/${kind}`)
      .then((r) => r.data.data),

  create: (body: {
    name: string;
    kind: LabelKind;
    fields: TemplateField[];
    isDefault?: boolean;
  }): Promise<ApiResponse<LabelTemplate>> =>
    apiClient
      .post<ApiResponse<LabelTemplate>>(`/api/label-templates`, body)
      .then((r) => r.data),

  update: (
    id: string,
    body: Partial<{
      name: string;
      fields: TemplateField[];
      isDefault: boolean;
      isActive: boolean;
      rawCode: RawCodeMap;
      lineStepMm: number | null;
      qrScale: number | null;
      lengthBanner: boolean | null;
    }>,
  ): Promise<ApiResponse<LabelTemplate>> =>
    apiClient
      .patch<ApiResponse<LabelTemplate>>(`/api/label-templates/${id}`, body)
      .then((r) => r.data),

  setDefault: (id: string): Promise<ApiResponse<LabelTemplate>> =>
    apiClient
      .post<ApiResponse<LabelTemplate>>(`/api/label-templates/${id}/set-default`)
      .then((r) => r.data),

  remove: (id: string): Promise<ApiResponse<void>> =>
    apiClient
      .delete<ApiResponse<void>>(`/api/label-templates/${id}`)
      .then((r) => r.data),

  /** KALICI sil (deletedAt damgası) — listeden tamamen gizlenir, geri getirilemez. */
  hardRemove: (id: string): Promise<ApiResponse<void>> =>
    apiClient
      .delete<ApiResponse<void>>(`/api/label-templates/${id}/permanent`)
      .then((r) => r.data),

  /**
   * Şablon düzenleme önizleme HTML'i — backend mock payload + verilen field
   * listesi ile tam HTML üretir. Iframe srcDoc kaynağı; mobil ve Electron
   * preview tek doğru renderdan beslenir.
   */
  previewHtml: (
    kind: LabelKind,
    fields: TemplateField[],
  ): Promise<string> =>
    apiClient
      .post<string>(
        "/api/labels/preview/html",
        { kind, fields },
        { responseType: "text", transformResponse: [(d) => d] },
      )
      .then((r) => r.data),

  /**
   * Native (PPLA/ZPL) metin-zone önizlemesi — şablona göre sıralı satırlar.
   * Termal yazıcı çıktısının yaklaşık hali (sol QR+barkod tarama kolonu hariç).
   */
  previewNativeText: (
    kind: LabelKind,
    fields: TemplateField[],
  ): Promise<{ lines: { text: string; size: string; bold: boolean }[] }> =>
    apiClient
      .post<ApiResponse<{ lines: { text: string; size: string; bold: boolean }[] }>>(
        "/api/labels/preview/native-text",
        { kind, fields },
      )
      .then((r) => r.data.data),

  /**
   * Uzman raw-code önizlemesi — verilen kodu sahte payload ile ikame edip ham
   * çıktıyı döner (native diller düz metin, RASTER_HTML tam HTML). Boş kod → boş.
   */
  previewRaw: (
    kind: LabelKind,
    language: RawCodeLang,
    code: string,
  ): Promise<string> =>
    apiClient
      .post<string>(
        "/api/label-templates/preview-raw",
        { kind, language, code },
        { responseType: "text", transformResponse: [(d) => d] },
      )
      .then((r) => r.data),

  /** Bu tür+dil için otomatik üretilen kodu {{}} yer-tutuculu (düzenlenebilir) döner. */
  defaultCode: (kind: LabelKind, language: RawCodeLang): Promise<string> =>
    apiClient
      .get<ApiResponse<{ code: string }>>("/api/label-templates/default-code", {
        params: { kind, language },
      })
      .then((r) => r.data.data.code),

  /** "Alanlar" canlı önizlemesi — verilen alanları AKTİF DİLDE (WYSIWYG) + ham kod.
   *  layout (satır aralığı + QR boyutu) verilirse önizleme onu yansıtır (kaydetmeden). */
  fieldsPreview: (
    kind: LabelKind,
    fields: TemplateField[],
    layout?: { lineStepMm?: number | null; qrScale?: number | null; lengthBanner?: boolean | null },
  ): Promise<{ mode: "svg" | "html" | "text"; language: string; content: string; native: string }> =>
    apiClient
      .post<
        ApiResponse<{
          mode: "svg" | "html" | "text";
          language: string;
          content: string;
          native: string;
        }>
      >("/api/label-templates/preview", { kind, fields, ...layout })
      .then((r) => r.data.data),
};
