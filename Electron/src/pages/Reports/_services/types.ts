// Rapor API ortak tipleri. Backend `reportEnvelope` ile birebir.

export interface ReportRange {
  from: string;
  to: string;
}

export interface ReportResponse<T> {
  success: true;
  data: T;
  range: ReportRange;
}

export interface ReportDateParams {
  dateFrom?: string;
  dateTo?: string;
}
