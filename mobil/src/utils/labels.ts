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
  STOCK: 'Stok',
  IN_PRODUCTION: 'Üretimde',
  AT_SUBCONTRACTOR: 'Fasonda',
  RETURNED_FROM_SUBCONTRACTOR: 'Fasondan Döndü',
  WAREHOUSE: 'Depoda',
  READY_FOR_SHIP: 'Sevke Hazır',
  SHIPPED: 'Sevk Edildi',
  DELIVERED: 'Teslim Edildi',
  PRODUCED: 'Üretildi',
  SCRAP: 'Fire',
  CANCELLED: 'İptal Edildi',
};

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
