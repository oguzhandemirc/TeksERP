/** Hata raporları — backend `GET /api/hata-raporlari` yanıt şekli (`services/error-report.service.ts` getErrorReportOverview). */
export interface ErrorReportConsent {
  readonly acik: boolean;
  readonly degistiren: { readonly id: string; readonly fullName: string } | null;
  readonly degisimZamani: string | null;
}

export interface ErrorReportRow {
  readonly id: string;
  readonly source: "sunucu" | "panel" | "tablet";
  readonly version: string;
  readonly code: string;
  readonly errorClass: string;
  readonly component: string;
  readonly routeTemplate: string | null;
  readonly stackFrames: string[];
  readonly count: number;
  readonly firstAt: string;
  readonly lastAt: string;
  readonly sentAt: string | null;
  readonly lastErrorCode: string | null;
}

export interface ErrorReportOverview {
  readonly onay: ErrorReportConsent;
  readonly bekleyen: number;
  readonly gonderilen: number;
  readonly kayitlar: ErrorReportRow[];
}

export const ERROR_SOURCE_LABEL: Record<ErrorReportRow["source"], string> = { sunucu: "Sunucu", panel: "Panel", tablet: "Tablet" };
