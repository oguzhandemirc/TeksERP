import apiClient from "@/services/apiClient";

// =============================================================================
// HAZIR SEBEP KATALOĞU — SERVİS (2026-08-19)
// =============================================================================
// Dört liste tek uçtan gelir. `createCrudService` KULLANILMADI: bu uç sayfalama
// döndürmüyor (liste onlarca satır, binlerce değil), silme YOK (gizleme var) ve
// "çoğalt" standart CRUD'da olmayan bir fiil.
// =============================================================================

export type ReasonPresetKind =
  | "ROLL_SCRAP"
  | "ROLL_RECORD_CORRECTION"
  | "ROLL_MANUAL_ENTRY"
  | "ROLL_CANCEL";

export interface ReasonPreset {
  id: string;
  kind: ReasonPresetKind;
  code: string;
  label: string;
  fullText: string | null;
  requiresText: boolean;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
  /** Eski adlar (salt-okunur, 2026-08-21) — etiket düzenlenince sunucu eski metni de koda çözsün diye tutulur. */
  legacyTexts?: string[];
}

/**
 * true olan listelerde kayda METİN de yazılır (`Roll.entryReason` / `Roll.cancelReason`
 * — görünen kayıt); 2026-08-21'den beri KOD da yazılır (`entryReasonCode` /
 * `cancelReasonCode` — rapor anahtarı, sunucu metinden türetir). Metni düzenlemek
 * geçmişi BÖLMEZ (kod sabit); eski kayıt eski metni taşımaya devam eder.
 * Sunucudaki `KIND_STORES_TEXT` ile birebir aynı tablo.
 */
export const KIND_STORES_TEXT: Record<ReasonPresetKind, boolean> = {
  ROLL_SCRAP: false,
  ROLL_RECORD_CORRECTION: false,
  ROLL_MANUAL_ENTRY: true,
  ROLL_CANCEL: true,
};

export const KIND_TABS: { kind: ReasonPresetKind; title: string; hint: string }[] = [
  {
    kind: "ROLL_SCRAP",
    title: "Fire",
    hint: "Tambur'da 'fire diye gir' kararının sebebi. Mal vardı, kullanılamaz — fire oranına girer.",
  },
  {
    kind: "ROLL_RECORD_CORRECTION",
    title: "Kayıt Düzeltmesi",
    hint: "'Bu metraj fiziksel olarak hiç yoktu' kararının sebebi. Fire DEĞİLDİR.",
  },
  {
    kind: "ROLL_MANUAL_ENTRY",
    title: "Elle Top Ekleme",
    hint: "Tambur Manuel Mod ve 'Manuel Top Ekle' — topun nereden geldiği.",
  },
  {
    kind: "ROLL_CANCEL",
    title: "Top İptali",
    hint: "KK1 / Depo / Tambur iptal ekranındaki hazır sebepler.",
  },
];

export const reasonPresetService = {
  list: (includeInactive = true): Promise<ReasonPreset[]> =>
    apiClient
      .get<ReasonPreset[]>(`/api/reason-presets${includeInactive ? "?includeInactive=true" : ""}`)
      .then((r) => r.data),

  create: (input: {
    kind: ReasonPresetKind;
    label: string;
    fullText?: string | null;
  }): Promise<ReasonPreset> =>
    apiClient.post<ReasonPreset>("/api/reason-presets", input).then((r) => r.data),

  update: (
    id: string,
    input: { label?: string; fullText?: string | null; isActive?: boolean },
  ): Promise<ReasonPreset> =>
    apiClient.patch<ReasonPreset>(`/api/reason-presets/${id}`, input).then((r) => r.data),

  duplicate: (id: string, label?: string): Promise<ReasonPreset> =>
    apiClient
      .post<ReasonPreset>(`/api/reason-presets/${id}/duplicate`, label ? { label } : {})
      .then((r) => r.data),

  reorder: (kind: ReasonPresetKind, ids: string[]): Promise<ReasonPreset[]> =>
    apiClient.patch<ReasonPreset[]>("/api/reason-presets/reorder", { kind, ids }).then((r) => r.data),
};
