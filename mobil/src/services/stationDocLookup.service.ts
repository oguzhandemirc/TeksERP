// =============================================================================
// İstasyonda belgeden iş emri bulma (Gülkesim K17) — kurşun / tambur tableti istemcisi
// =============================================================================
// Eşleme okuması: fotoğraf ya da fiş/evrak/parti no → bağlı iş emri(leri). Sunucu HİÇBİR kayıt doğurmaz
// (yeni gelen belge/taslak yok). Kapı sunucuda: ayar `gelenBelge.stationDocLookup` + üretim modülü + istasyon izni.
// Eski backend uç bilmez (404) → durum sorgusu hata verir, düğme çizilmez.
// =============================================================================
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';

/** Fotoğraf 1–2 MB base64 + senkron OCR (≈8–12 sn); varsayılan 10 sn yetmez. */
const LOOKUP_TIMEOUT_MS = 60_000;

export interface StationLookupStatus {
  enabled: boolean;
  readerConfigured: boolean;
}

export type StationLookupOutcome = 'SINGLE' | 'MULTIPLE' | 'NO_WORK_ORDER' | 'NO_DOCUMENT' | 'NO_DOC_NO' | 'UNREADABLE';

export interface StationLookupWorkOrder {
  id: string;
  workOrderNumber: string;
  status: string;
  /** Ekranın mevcut kart çözümüne verilecek kod (aktif kart barkodu ya da İE no). */
  cardBarcode: string;
  batchNumbers: string[];
  documents: { noteNo: string; senderDocNo: string | null }[];
}

export interface StationLookupResult {
  outcome: StationLookupOutcome;
  source: 'SAME_PHOTO' | 'STORED_READ' | 'OCR' | 'SEARCH';
  read: { senderDocNo: string | null; ownerText: string | null; senderText: string | null } | null;
  workOrders: StationLookupWorkOrder[];
  /** Sunucunun Türkçe sonuç cümlesi. */
  message: string;
}

export const stationDocLookupService = {
  status: (): Promise<StationLookupStatus> =>
    apiClient.get<ApiResponse<StationLookupStatus>>('/gelen-belge/istasyon-okutma').then((r) => r.data.data),

  byPhoto: (contentBase64: string, sha256: string): Promise<StationLookupResult> =>
    apiClient
      .post<ApiResponse<StationLookupResult>>('/gelen-belge/istasyon-okutma', { contentBase64, sha256 }, { timeout: LOOKUP_TIMEOUT_MS })
      .then((r) => r.data.data),

  bySearch: (q: string): Promise<StationLookupResult> =>
    apiClient.post<ApiResponse<StationLookupResult>>('/gelen-belge/istasyon-okutma', { q }).then((r) => r.data.data),
};
