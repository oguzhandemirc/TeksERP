// Rapor API ortak tipleri. Backend `reportEnvelope` ile birebir.

export interface ReportRange {
  from: string;
  to: string;
}

export interface ReportResponse<T> {
  success: true;
  data: T;
  range: ReportRange;
  /** Yalnız karşılaştırma istendiyse dolar — varlığına bakarak Δ çizilir. */
  compareRange?: ReportRange;
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
