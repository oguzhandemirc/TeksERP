import { apiClient } from './api';

// =============================================================================
// HAZIR SEBEP KATALOĞU — MOBİL SERVİS (2026-08-19)
// =============================================================================
// Dört liste tek uçtan gelir: fire · kayıt düzeltmesi · elle top ekleme · iptal.
// Öncesinde dördü de mobilde SABİTTİ; fabrika kendi sebebini ekleyemiyordu ve
// her değişiklik yeni APK gerektiriyordu.
//
// ⚠️ `code` rapor anahtarıdır ve DÜZENLENMEZ (sunucu da kabul etmez). Etiket
// serbestçe değişir; fire/kayıt-düzeltmesi satırları koda bağlı olduğu için
// etiketi değiştirmek geçmiş raporu BOZMAZ.
// =============================================================================

export type ReasonPresetKind =
  | 'ROLL_SCRAP'
  | 'ROLL_RECORD_CORRECTION'
  | 'ROLL_MANUAL_ENTRY'
  | 'ROLL_CANCEL';

export interface ReasonPreset {
  id: string;
  kind: ReasonPresetKind;
  code: string;
  label: string;
  /** Sunucuya GİDEN tam metin — yalnız metin saklayan listelerde dolu. */
  fullText: string | null;
  requiresText: boolean;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
}

/**
 * ⚠️ SÖZLEŞME FARKI — tek yerde yazılı (sunucu `constants/reason-presets.ts`
 * ile birebir aynı tablo). true olan listelerde satıra KOD değil METİN yazılır
 * (`Roll.entryReason` / `Roll.cancelReason`), dolayısıyla metni düzenlemek
 * GEÇMİŞ kayıtları eski metinle bırakır — düzenleme ekranı bunu operatöre söyler.
 */
export const KIND_STORES_TEXT: Record<ReasonPresetKind, boolean> = {
  ROLL_SCRAP: false,
  ROLL_RECORD_CORRECTION: false,
  ROLL_MANUAL_ENTRY: true,
  ROLL_CANCEL: true,
};

export const KIND_LABELS: Record<ReasonPresetKind, string> = {
  ROLL_SCRAP: 'Fire sebepleri',
  ROLL_RECORD_CORRECTION: 'Kayıt düzeltmesi sebepleri',
  ROLL_MANUAL_ENTRY: 'Elle top ekleme sebepleri',
  ROLL_CANCEL: 'Top iptal sebepleri',
};

export const reasonPresetService = {
  /** `includeInactive` yalnız düzenleme yüzeyi için — operatör ekranı aktifleri alır. */
  list: (includeInactive = false): Promise<ReasonPreset[]> =>
    apiClient
      .get<ReasonPreset[]>(`/reason-presets${includeInactive ? '?includeInactive=true' : ''}`)
      .then((r) => r.data),

  create: (input: {
    kind: ReasonPresetKind;
    label: string;
    fullText?: string | null;
    requiresText?: boolean;
  }): Promise<ReasonPreset> =>
    apiClient.post<ReasonPreset>('/reason-presets', input).then((r) => r.data),

  update: (
    id: string,
    input: { label?: string; fullText?: string | null; isActive?: boolean },
  ): Promise<ReasonPreset> =>
    apiClient.patch<ReasonPreset>(`/reason-presets/${id}`, input).then((r) => r.data),

  duplicate: (id: string, label?: string): Promise<ReasonPreset> =>
    apiClient
      .post<ReasonPreset>(`/reason-presets/${id}/duplicate`, label ? { label } : {})
      .then((r) => r.data),
};
