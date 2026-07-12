// Backend enum kodlarını Türkçe etikete çevirir.
// Tek kaynak — tüm ekranlar buradan import eder.

export const WORK_ORDER_STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Planlandı',
  IN_PROGRESS: 'Devam Ediyor',
  COMPLETED: 'Tamamlandı',
  CANCELLED: 'İptal Edildi',
  PARTIAL_SHIPPED: 'Kısmen Sevk',
};

export const WORK_ORDER_TYPE_LABEL: Record<string, string> = {
  ORDER_PRODUCTION: 'Sipariş Üretimi',
  STOCK_PRODUCTION: 'Stoğa Üretim',
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Beklemede',
  APPROVED: 'Onaylandı',
  PARTIAL_SHIPPED: 'Kısmen Sevk',
  COMPLETED: 'Tamamlandı',
  CANCELLED: 'İptal Edildi',
};

export const ORDER_STATUS_COLOR: Record<string, string> = {
  PENDING: '#64748b',
  APPROVED: '#2563eb',
  PARTIAL_SHIPPED: '#f59e0b',
  COMPLETED: '#10b981',
  CANCELLED: '#ef4444',
};

export const STEP_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Beklemede',
  ACTIVE: 'Aktif',
  COMPLETED: 'Tamamlandı',
  SKIPPED: 'Atlandı',
  CANCELLED: 'İptal Edildi',
};

export const STATION_TYPE_LABEL: Record<string, string> = {
  PROCESS: 'İç İşlem',
  PROCESS_QC: 'Kalite Kontrol',
  EXTERNAL: 'Fason',
  WAREHOUSE: 'Depo',
};

export const ROLL_STATUS_LABEL: Record<string, string> = {
  STOCK: 'Ham',
  IN_PRODUCTION: 'Üretimde',
  AT_SUBCONTRACTOR: 'Fasonda',
  RETURNED_FROM_SUBCONTRACTOR: 'Fasondan Döndü',
  WAREHOUSE: 'Depo',
  SHIPPED: 'Sevk Edildi',
  DELIVERED: 'Teslim Edildi',
  PRODUCED: 'Üretildi',
  A1_STOCK: '2. Kalite',
  SCRAP: 'Fire',
  CANCELLED: 'İptal Edildi',
  // Tüketilmiş/emekli parent durumları (Tambur kesimi, fason açık-kumaş, kartela)
  TAMBUR_CONSUMED: 'Tamburda Bölündü',
  SUBCONTRACTOR_CONSUMED: 'Fasonda Tüketildi',
  AT_KARTELA: 'Kartelada',
  KARTELA_CONSUMED: 'Kartelada Tüketildi',
};

/**
 * "Tüketilmiş" / emekli top durumları — başka bir kayda dönüştüğü için (Tambur
 * kesimi, fason açık-kumaş, kartela) artık fiziksel olarak yok. İş emri "bağlı
 * toplar" gibi yerlerde gizlenir; karışıklık yaratmasın.
 */
export const RETIRED_ROLL_STATUSES = [
  'TAMBUR_CONSUMED',
  'SUBCONTRACTOR_CONSUMED',
  'KARTELA_CONSUMED',
  'CANCELLED',
];

export const isRetiredRoll = (status: string | null | undefined): boolean =>
  !!status && RETIRED_ROLL_STATUSES.includes(status);

// Status'lara renk verir — chip/badge için
export const WORK_ORDER_STATUS_COLOR: Record<string, string> = {
  PLANNED: '#3b82f6',
  IN_PROGRESS: '#10b981',
  COMPLETED: '#64748b',
  CANCELLED: '#ef4444',
  PARTIAL_SHIPPED: '#f59e0b',
};

export const trLabel = (map: Record<string, string>, key: string | undefined | null): string => {
  if (!key) return '—';
  return map[key] ?? key;
};

/**
 * Fason adımı not etiketi — istasyon adına duyarlı (örn. "Boyahane Talimatı").
 * İstasyon adı yoksa genel "Fason Talimatı" döner. Fason adımın `notes` alanı
 * o adımın fason talimatıdır; sevkin çeki listesine basılır.
 */
export const fasonNoteLabel = (stationName?: string | null): string =>
  stationName ? `${stationName} Talimatı` : 'Fason Talimatı';
