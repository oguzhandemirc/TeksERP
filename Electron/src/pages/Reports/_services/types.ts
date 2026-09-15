// Rapor API ortak tipleri. Backend `reportEnvelope` ile birebir.

export interface ReportRange {
  from: string;
  to: string;
}

/** Eksen seçeneği — `id`/`code` + görünen ad; seçici listesi bundan kurulur. */
export interface ReportAxisOption {
  id?: string;
  code?: string;
  ad: string;
  kod?: string;
}

/**
 * Süzgeç seçenekleri (R5b-c): PENCEREDE GEÇEN değerler, eksen başına ≤200, `tr`
 * sıralı ve **SÜZGEÇTEN BAĞIMSIZ** — süzgeçli yanıtta da tam liste döner.
 * ⚠️ Bu yüzden panel ikinci bir "süzgeçsiz" sorgu AÇMAZ: dokuma raporlarında
 * gereken iki-sorgu kalıbı burada gereksizdir, çünkü daralma riski sunucuda
 * kapatılmıştır. Liste `customer:read` gibi ayrı izin isteyen uçlardan değil
 * raporun KENDİ yanıtından gelir (rapor kitlesinde 403 riski yok).
 */
export interface ReportSecenekler {
  /** Finans ekseni (R5b-d): cari kimliği — müşteri ve fasoncu aynı listede. */
  cariId?: ReportAxisOption[];
  /** Kasa/banka hesabı (kasa defteri) — kod + ad. */
  accountId?: ReportAxisOption[];
  /** KDV oranı: `code` sorgu biçimi ("20.00"), `ad` gösterim ("%20"). */
  oran?: ReportAxisOption[];
  /** Cari ekstre belge tipi: `code` HAM ENUM, Türkçe etiket panelde. */
  belgeTipi?: ReportAxisOption[];
  customerId?: ReportAxisOption[];
  itemId?: ReportAxisOption[];
  colorId?: ReportAxisOption[];
  subcontractorId?: ReportAxisOption[];
  reasonCode?: ReportAxisOption[];
}

/** Süzgeç yankısı: sunucunun UYGULADIĞI süzgeç + kaç satırın elendiği. */
export interface ReportSuzgec {
  cariId?: string[];
  accountId?: string;
  oran?: string;
  belgeTipi?: string;
  kategori?: string;
  yon?: string;
  customerId?: string[];
  itemId?: string[];
  colorId?: string[];
  subcontractorId?: string[];
  reasonCode?: string[];
  destination?: "DOMESTIC" | "EXPORT";
  /** Süzgecin kaç satır kestiği — "rapor boş" ile "süzgeç kesti" ayrı şeylerdir. */
  dusenSatir?: number;
}

export interface ReportResponse<T> {
  success: true;
  data: T;
  range: ReportRange;
  /** Yalnız karşılaştırma istendiyse dolar — varlığına bakarak Δ çizilir. */
  compareRange?: ReportRange;
  /** Seçici kaynağı (R5b-c) — yalnız eksen taşıyan raporlarda. */
  meta?: { secenekler?: ReportSecenekler };
  /** Yalnız süzgeç VERİLDİYSE döner; verilmeyen anahtar YOK (null değil). */
  suzgec?: ReportSuzgec;
}

export interface ReportDateParams {
  dateFrom?: string;
  dateTo?: string;
}

/** Dönem karşılaştırmasını DESTEKLEYEN raporların parametreleri. */
export interface ReportCompareParams extends ReportDateParams {
  compare?: "prev" | "prevYear" | "custom";
  compareFrom?: string;
  compareTo?: string;
}
