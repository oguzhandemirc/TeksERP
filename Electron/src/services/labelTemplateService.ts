import apiClient from "./apiClient";
import type { ApiResponse } from "@/types/api";
import type { CanvasLayout } from "@/types/label-canvas";

// ⚠️ Bu liste Prisma `LabelKind` enum'undan BAĞIMSIZ (kendi const'u) — backend
// enum'una değer eklemek burayı DERLEME HATASIYLA UYARMAZ. Yeni bağlam eklerken
// bu dosya + KINDS dizileri + PeripheralDevices tipleri elle güncellenmeli.
export const LabelKind = {
  ROLL_RAW: "ROLL_RAW",
  ROLL_FINISHED: "ROLL_FINISHED",
  SWATCH: "SWATCH",
  SACK: "SACK",
} as const;
export type LabelKind = (typeof LabelKind)[keyof typeof LabelKind];

export const labelKindLabels: Record<LabelKind, string> = {
  ROLL_RAW: "Ham Kumaş Etiketi",
  ROLL_FINISHED: "Bitmiş Kumaş Etiketi",
  SWATCH: "Kartela Etiketi",
  SACK: "Çuval Etiketi",
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
  /** TEK HAVUZ (v2): kimlik değil legacy bilgi — yeni havuz şablonları null. */
  kind: LabelKind | null;
  /** DEPRECATED — tek doğru kaynak bağlam varsayılanları (context-defaults). */
  isDefault: boolean;
  isActive: boolean;
  /** Serbest etiket — hiçbir bağlama atanamaz, barkodsuz kaydedilebilir, yalnız
   *  baskı seçicide görünür (rulo/kartela bağı yok). standalone → kind null. */
  standalone: boolean;
  fields: TemplateField[];
  /** Uzman raw-code override (dil→kod). Boş/yok → o dilde otomatik üretim. */
  rawCode?: RawCodeMap | null;
  /** Yerleşim (şablon-başına, opsiyonel). Boş → font-türevli/varsayılan. */
  lineStepMm?: number | null;
  qrScale?: number | null;
  /** Sağ kenar dikey metraj bandı (siyah zemin/beyaz değer). */
  lengthBanner?: boolean | null;
  /** Liste ucunda gelen varyant özeti (boyut rozetleri). */
  variants?: Array<{ id: string; name: string; widthMm: number | string; heightMm: number | string; isPrimary: boolean }>;
  createdAt: string;
  updatedAt: string;
}

/** Boyut varyantı — tuval (mm) + kanvas eleman yerleşimi. Prisma Decimal JSON'da
 *  string gelir → normalizeVariant Number()'a çevirir. */
export interface LabelTemplateVariant {
  id: string;
  templateId: string;
  name: string;
  widthMm: number;
  heightMm: number;
  isPrimary: boolean;
  elements: CanvasLayout;
  createdAt: string;
  updatedAt: string;
}

function normalizeVariant(v: LabelTemplateVariant): LabelTemplateVariant {
  return { ...v, widthMm: Number(v.widthMm), heightMm: Number(v.heightMm) };
}

export interface ContextDefaultRow {
  kind: LabelKind;
  templateId: string;
  templateName: string;
}

/** Birleşik katalog alanı — kinds: bu alanın değer ürettiği bağlamlar. */
export interface UnifiedCatalogField extends CatalogField {
  kinds: LabelKind[];
  /** Bağlama özel başlık — yalnız jenerik addan FARKLI olanlar için dolu
   *  (ör. `weightKg` → SACK: "Brüt Ağırlık (kg)"). Palet seçili bağlamda bunu gösterir. */
  labelByKind?: Partial<Record<LabelKind, string>>;
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

/** Bakım sembolü kategorisi (backend config/label-icons.ts aynası). */
export interface LabelIconCategory {
  key: string;
  label: string;
}

/** Bakım sembolü — svg: backend'in ürettiği standalone `<svg viewBox="0 0 100 100">`
 *  (stroke="currentColor" — tema rengine uyar; kanvasta siyaha sabitlenir). */
export interface LabelIconInfo {
  key: string;
  label: string;
  category: string;
  svg: string;
}

/** Taşınabilir şablon zarfı (dışa/içe aktar) — backend TemplateEnvelope aynası.
 *  elements = kanvas layout JSON (backend validateCanvasLayout ile doğrular). */
export interface TemplateEnvelope {
  template: {
    name: string;
    kind: LabelKind | null;
    standalone?: boolean;
    fields?: TemplateField[];
    rawCode?: RawCodeMap;
    lineStepMm?: number | null;
    qrScale?: number | null;
    lengthBanner?: boolean | null;
  };
  variants: Array<{ name?: string; widthMm: number; heightMm: number; isPrimary?: boolean; elements: unknown }>;
}

export const labelTemplateService = {
  /** Havuz listesi. `assignable` → serbest etiketleri gizler (atama seçicileri);
   *  `standalone` → yalnız serbest etiketler (baskı seçicisi). */
  list: (opts?: {
    kind?: LabelKind;
    assignable?: boolean;
    standalone?: boolean;
  }): Promise<ApiResponse<LabelTemplate[]>> => {
    const params = new URLSearchParams();
    if (opts?.kind) params.set("kind", opts.kind);
    if (opts?.assignable) params.set("assignable", "true");
    if (opts?.standalone) params.set("standalone", "true");
    const q = params.toString();
    return apiClient
      .get<ApiResponse<LabelTemplate[]>>(`/api/label-templates${q ? `?${q}` : ""}`)
      .then((r) => r.data);
  },

  /**
   * Serbest Baskı seçicisi — GET /api/labels/standalone-templates. `customerId`
   * verilirse o müşteriye BAĞLI ∪ hiç müşteri bağı olmayan (genel) serbest
   * etiketler döner; verilmezse tüm aktif serbest etiketler. Yanıt {id,name,variants}
   * (LabelTemplate alt kümesi) — baskı diyaloğu yalnız id/ad/varyant/kind okur,
   * standalone şablonda kind zaten null → baskıda default'a düşülür.
   */
  standalonePrintList: (customerId?: string): Promise<ApiResponse<LabelTemplate[]>> => {
    const q = customerId ? `?customerId=${encodeURIComponent(customerId)}` : "";
    return apiClient
      .get<ApiResponse<LabelTemplate[]>>(`/api/labels/standalone-templates${q}`)
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
    /** Serbest etikette null (bağlam bağı yok). */
    kind: LabelKind | null;
    fields: TemplateField[];
    isDefault?: boolean;
    /** true → serbest etiket (atama dışı, barkodsuz kaydedilebilir). */
    standalone?: boolean;
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

  /** Şablonu taşınabilir JSON zarfı olarak dışa aktar (şablon + varyantlar). */
  exportTemplate: (id: string): Promise<TemplateEnvelope> =>
    apiClient
      .get<ApiResponse<TemplateEnvelope>>(`/api/label-templates/${id}/export`)
      .then((r) => r.data.data),

  /** JSON zarfını yeni şablon olarak içe aktar (ad çakışması backend'de dedup). */
  importTemplate: (env: TemplateEnvelope): Promise<ApiResponse<LabelTemplate>> =>
    apiClient
      .post<ApiResponse<LabelTemplate>>(`/api/label-templates/import`, env)
      .then((r) => r.data),

  /** Şablonu komple çoğalt — "… (kopya)" adıyla (isDefault/atamalar taşınmaz). */
  duplicate: (id: string): Promise<ApiResponse<LabelTemplate>> =>
    apiClient
      .post<ApiResponse<LabelTemplate>>(`/api/label-templates/${id}/duplicate`)
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

  // ==========================================================================
  // ETİKET STÜDYOSU v2 — kanvas / varyant / atama uçları
  // ==========================================================================

  /** KANVAS canlı önizlemesi — kaydedilmemiş tuval+elemanlar WYSIWYG (backend
   *  render: native dil → SVG "önizleme = baskı"; dil verilmezse aktif dil). */
  canvasPreview: (body: {
    kind: LabelKind;
    widthMm: number;
    heightMm: number;
    elements: CanvasLayout;
    language?: RawCodeLang;
    /** "Bu Bilgisayar"da seçili Cihaz Kaydı yazıcısı — dil/medya bu cihazdan çözülür. */
    peripheralId?: string;
    /** Baskı adedi — yalnız verilirse gövdeye eklenir (test baskısı çoğaltma). */
    copies?: number;
  }): Promise<{ mode: "svg" | "html" | "text"; language: string; content: string; native: string; nativeB64?: string }> =>
    apiClient
      .post<
        ApiResponse<{ mode: "svg" | "html" | "text"; language: string; content: string; native: string; nativeB64?: string }>
      >("/api/label-templates/preview", body)
      .then((r) => r.data.data),

  /** BİRLEŞİK alan kataloğu (tek havuz) — eleman paleti buradan beslenir. */
  unifiedCatalog: (): Promise<UnifiedCatalogField[]> =>
    apiClient
      .get<ApiResponse<{ fields: UnifiedCatalogField[] }>>("/api/label-templates/catalog")
      .then((r) => r.data.data.fields),

  /** Bakım sembolü kataloğu (kategoriler + inline SVG) — palet + kanvas görseli. */
  iconCatalog: (): Promise<{ categories: LabelIconCategory[]; icons: LabelIconInfo[] }> =>
    apiClient
      .get<ApiResponse<{ categories: LabelIconCategory[]; icons: LabelIconInfo[] }>>(
        "/api/label-templates/icons",
      )
      .then((r) => r.data.data),

  listVariants: (templateId: string): Promise<LabelTemplateVariant[]> =>
    apiClient
      .get<ApiResponse<LabelTemplateVariant[]>>(`/api/label-templates/${templateId}/variants`)
      .then((r) => r.data.data.map(normalizeVariant)),

  /** Yeni boyut varyantı — copyFromVariantId (kopyala-başla; BAŞKA şablondan da
   *  olabilir) veya elements. Otomatik ölçekleme YOK; elle düzeltilir/teyit edilir. */
  createVariant: (
    templateId: string,
    body: {
      name?: string;
      widthMm: number;
      heightMm: number;
      copyFromVariantId?: string | null;
      elements?: CanvasLayout;
    },
  ): Promise<LabelTemplateVariant> =>
    apiClient
      .post<ApiResponse<LabelTemplateVariant>>(`/api/label-templates/${templateId}/variants`, body)
      .then((r) => normalizeVariant(r.data.data)),

  updateVariant: (
    variantId: string,
    body: Partial<{
      name: string;
      widthMm: number;
      heightMm: number;
      elements: CanvasLayout;
    }>,
  ): Promise<LabelTemplateVariant> =>
    apiClient
      .patch<ApiResponse<LabelTemplateVariant>>(`/api/label-templates/variants/${variantId}`, body)
      .then((r) => normalizeVariant(r.data.data)),

  /** Primary yalnız SON varyantsa silinebilir (akış-moduna dönüş mekanizması). */
  deleteVariant: (variantId: string): Promise<void> =>
    apiClient.delete(`/api/label-templates/variants/${variantId}`).then(() => undefined),

  setPrimaryVariant: (variantId: string): Promise<LabelTemplateVariant> =>
    apiClient
      .post<ApiResponse<LabelTemplateVariant>>(`/api/label-templates/variants/${variantId}/set-primary`)
      .then((r) => normalizeVariant(r.data.data)),

  /** Bağlam (kind) → varsayılan şablon atamaları. */
  listContextDefaults: (): Promise<ContextDefaultRow[]> =>
    apiClient
      .get<ApiResponse<ContextDefaultRow[]>>("/api/label-templates/context-defaults")
      .then((r) => r.data.data),

  /** Bağlam varsayılanını ata/kaldır (templateId null → bağlam default'suz). */
  setContextDefault: (kind: LabelKind, templateId: string | null): Promise<void> =>
    apiClient
      .put("/api/label-templates/context-defaults", { kind, templateId })
      .then(() => undefined),
};

// =============================================================================
// Müşteriye özel şablon atamaları (CustomerTemplateRoute)
// =============================================================================

export interface CustomerTemplateRouteRow {
  kind: LabelKind;
  templateId: string;
  templateName: string;
  templateActive: boolean;
}

export const customerTemplateRouteService = {
  list: (customerId: string): Promise<CustomerTemplateRouteRow[]> =>
    apiClient
      .get<ApiResponse<CustomerTemplateRouteRow[]>>(`/api/customers/${customerId}/template-routes`)
      .then((r) => r.data.data),

  /** Atama upsert/kaldır — çözüm zinciri: explicit > MÜŞTERİ > cihaz > bağlam default. */
  set: (customerId: string, kind: LabelKind, templateId: string | null): Promise<void> =>
    apiClient
      .put(`/api/customers/${customerId}/template-routes`, { kind, templateId })
      .then(() => undefined),
};
