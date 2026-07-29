import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

// =============================================================================
// Serbest (standalone) etiket şablonları — mobil. Bir topa/kartelaya bağlı
// OLMAYAN, tek başına basılabilen bakım/uyarı etiketi şablonları. İstasyon
// yazıcısı device bağlamından (x-device-id) backend'de çözülür — peripheralId
// gönderilmez; dil/rasterMode cihaz kaydından gelir (label.service.getRollNative
// ile AYNI sözleşme).
// =============================================================================

/** Şablon varyantı — etiket boyutu (mm). isPrimary → backend default seçimi. */
export interface StandaloneTemplateVariant {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  isPrimary: boolean;
}

/** Aktif serbest etiket şablonu (yalnız aktifler listelenir). */
export interface StandaloneTemplate {
  id: string;
  name: string;
  variants: StandaloneTemplateVariant[];
}

export const labelTemplateService = {
  /** Aktif serbest etiket şablonlarını döner. */
  listStandalone: (): Promise<StandaloneTemplate[]> =>
    apiClient
      .get<ApiResponse<StandaloneTemplate[]>>('/labels/standalone-templates')
      .then((r) => r.data?.data ?? []),

  /**
   * Şablonun etiketi SEÇİLİ dilde (cihaz kaydının dili: PPLA/PPLB/ZPL veya
   * RASTER_HTML). Bluetooth yazıcıya ham gönderim için içerik + dil döner. Dil
   * X-Label-Language header'ından okunur (cihaz kaydı yoksa global/model). copies
   * server-side native döngüde (P/^PQ/Q) uygulanır — N kez gönderim YOK.
   * label.service.getRollNative'i BİREBİR yansıtır; variant backend'de
   * primary→ilk seçilir (variantId gönderilmez).
   */
  getStandaloneNative: (
    templateId: string,
    copies: number,
    rasterCapable?: boolean,
  ): Promise<{ content: string; encoding: 'text' | 'base64'; language: string }> => {
    // rasterCapable (mobileRasterEnabled) → encoding=b64: backend cihazın
    // rasterMode'unu ONURLANDIRIR → raster GW bitmap (ya da komut), ikisi de
    // base64 byte olarak JSON döner. false → eski ham-text komut yolu (latin1).
    if (rasterCapable) {
      return apiClient
        .get<{ success: boolean; data: { content: string; encoding: string; language: string } }>(
          `/labels/templates/${templateId}/native`,
          { params: { copies, encoding: 'b64' } },
        )
        .then((r) => ({
          content: r.data?.data?.content ?? '',
          encoding: 'base64' as const,
          language: String(r.data?.data?.language ?? 'PPLA'),
        }));
    }
    return apiClient
      .get<string>(`/labels/templates/${templateId}/native`, {
        params: { copies },
        responseType: 'text',
        transformResponse: [(d) => d],
      })
      .then((r) => ({
        content: String(r.data ?? ''),
        encoding: 'text' as const,
        language: String((r.headers?.['x-label-language'] as string | undefined) ?? 'PPLA'),
      }));
  },

  /** Şablonun etiketi hazır HTML olarak (expo-print fallback). copies server-side. */
  getStandaloneHtml: (templateId: string, copies: number): Promise<string> =>
    apiClient
      .get<string>(`/labels/templates/${templateId}/html`, {
        params: { copies },
        responseType: 'text',
        transformResponse: [(d) => d],
      })
      .then((r) => String(r.data ?? '')),
};
