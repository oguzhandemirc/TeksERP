// =============================================================================
// İstasyonda belgeden iş emri bulma (Gülkesim K17) — kurşun / tambur tableti istemcisi
// =============================================================================
// Eşleme okuması: fotoğraf ya da fiş/evrak/parti no → bağlı iş emri(leri). Sunucu HİÇBİR kayıt doğurmaz
// (yeni gelen belge/taslak yok). Kapı sunucuda: ayar `gelenBelge.stationDocLookup` + üretim modülü + istasyon izni.
// Eski backend uç bilmez (404) → durum sorgusu hata verir, düğme çizilmez.
// =============================================================================
import { apiClient } from './api';
import type { ApiResponse } from '../types/api';
import type { ClientOcr } from './deviceOcr';
import type { PageBarcode } from './deviceBarcode';

/** Fotoğraf 1–2 MB base64 + senkron OCR (≈8–12 sn); varsayılan 10 sn yetmez. */
const LOOKUP_TIMEOUT_MS = 60_000;

export interface StationLookupStatus {
  enabled: boolean;
  /** Sunucu okuyucusu kullanılabilir ("Bilgisayarda ikinci okuma" açık + adres). */
  readerConfigured: boolean;
  /** Uç cihaz okumasını (`clientOcr`) kabul eder (2026-11-09; eski sunucu göndermez → undefined). */
  deviceOcrAccepted?: boolean;
}

/** Fotoğraf gövdesine eklenen cihaz okuması + barkodlar (eski sunucu 400 verir; çağıran alansız tekrarlar). */
export interface PhotoExtras {
  clientOcr?: ClientOcr;
  barcodes?: PageBarcode[];
}

/** UNVERIFIED: aday var ama hiçbiri doğrulama eşiğini geçmedi (2026-11-06; `unverifiedWorkOrders`). */
export type StationLookupOutcome = 'SINGLE' | 'MULTIPLE' | 'NO_WORK_ORDER' | 'NO_DOCUMENT' | 'NO_DOC_NO' | 'UNREADABLE' | 'UNVERIFIED';

/** Doğrulama bileşeni: ne tuttu / ne tutmadı (sunucu `station-scan-score.helper`). */
export interface VerifyComponent {
  key: string;
  label: string;
  weight: number;
  ratio: number;
  matched: boolean;
  detail: string;
}

/** Sunucunun adaya verdiği doğrulama; `passed` TEK kaynaktır (eşik karşılaştırması sunucuda). */
export interface WorkOrderVerification {
  score: number | null;
  passed: boolean;
  strongEvidence: boolean;
  threshold: number;
  components: VerifyComponent[];
  targetKey: string;
}

/** Tablet ne açtı: kendiliğinden · listeden seçildi · eşik altı, görevli onayladı. */
export type OpenedHow = 'AUTO' | 'CHOSEN' | 'CONFIRMED';

/** HERE = bu ekranın açık kart listesinde · NOT_YET · PASSED · NOT_ON_ROUTE (sunucu `station-open-step.helper`). */
/** STARTABLE_HERE: rotasız İE, okutunca adımı bu istasyona eklenir (açık listede "Sahada belirlenecek"). */
export type AtStation = 'HERE' | 'STARTABLE_HERE' | 'NOT_YET' | 'PASSED' | 'NOT_ON_ROUTE';

/** Hangi ekran soruyor: sunucu "burada bekliyor mu"yu o ekranın açık kart listesine göre cevaplar. */
export type LookupScreen = { screen: 'KURSUN_QC' } | { screen: 'TAMBUR'; stationId: string | null };

export interface StationLookupWorkOrder {
  id: string;
  workOrderNumber: string;
  status: string;
  /** Ekranın mevcut kart çözümüne verilecek kod (aktif kart barkodu ya da İE no). */
  cardBarcode: string;
  batchNumbers: string[];
  documents: { noteNo: string; senderDocNo: string | null; customerOrderNo?: string | null; customerBatchNo?: string | null }[];
  // Aşağıdakiler 2026-11-06 ek alanları — eski sunucu göndermez (undefined).
  processText?: string | null;
  rollCount?: number;
  meters?: number;
  locationText?: string;
  atStation?: AtStation | null;
  atStationText?: string | null;
  /** Fotoğraf okutmasında doğrulama (2026-11-06; eski sunucu göndermez). */
  verification?: WorkOrderVerification | null;
}

export interface StationLookupResult {
  outcome: StationLookupOutcome;
  source: 'SAME_PHOTO' | 'STORED_READ' | 'DEVICE' | 'OCR' | 'SEARCH';
  read: { senderDocNo: string | null; ownerText: string | null; senderText: string | null } | null;
  workOrders: StationLookupWorkOrder[];
  /** Sunucunun Türkçe sonuç cümlesi. */
  message: string;
  station?: { screen: string; label: string } | null;
  /** Eşiği geçemeyen adaylar — kendiliğinden açılmaz, görevli onaylarsa açılır (eski sunucu göndermez). */
  unverifiedWorkOrders?: StationLookupWorkOrder[];
  /** `bestStrong`: en iyi adayda top listesi karşılaştırılabildi mi (değilse "doğrulanamadı"). */
  verification?: { threshold: number; bestScore: number | null; bestStrong?: boolean } | null;
  /** Okutma izi kimliği: açılan İE bununla bildirilir. */
  checkId?: string | null;
}

/** Ekran bilgisi SORGU dizgisinde: eski sunucu sorguyu yok sayar (gövde katı şemadır, ek alan 400 olurdu). */
function screenParams(s?: LookupScreen): Record<string, string> | undefined {
  if (!s) return undefined;
  return s.screen === 'TAMBUR' && s.stationId ? { screen: s.screen, stationId: s.stationId } : { screen: s.screen };
}

export const stationDocLookupService = {
  status: (): Promise<StationLookupStatus> =>
    apiClient.get<ApiResponse<StationLookupStatus>>('/gelen-belge/istasyon-okutma').then((r) => r.data.data),

  byPhoto: (contentBase64: string, sha256: string, screen?: LookupScreen, extras: PhotoExtras = {}): Promise<StationLookupResult> =>
    apiClient
      .post<ApiResponse<StationLookupResult>>('/gelen-belge/istasyon-okutma', { contentBase64, sha256, ...extras }, { timeout: LOOKUP_TIMEOUT_MS, params: screenParams(screen) })
      .then((r) => r.data.data),

  /** Okutma izine açılan İE (TELEMETRİ, best-effort — hata yutulur, açmayı etkilemez). */
  reportOpened: (checkId: string, workOrderNumber: string, how: OpenedHow): Promise<void> =>
    apiClient
      .post(`/gelen-belge/istasyon-okutma/${checkId}/acilan`, { workOrderNumber, how })
      .then(() => undefined, () => undefined),

  bySearch: (q: string, screen?: LookupScreen): Promise<StationLookupResult> =>
    apiClient
      .post<ApiResponse<StationLookupResult>>('/gelen-belge/istasyon-okutma', { q }, { params: screenParams(screen) })
      .then((r) => r.data.data),
};
