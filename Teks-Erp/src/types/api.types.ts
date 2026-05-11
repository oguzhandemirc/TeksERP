// =============================================================================
// TeksERP - Shared API Types
// =============================================================================

/** Standard API response wrapper */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** Paginated list response */
export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/** Query parameters parsed from request */
export interface QueryParams {
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
  filters: Record<string, string | string[]>;
  search?: string;
  /** ISO datetime — kayıt aralığı sorgusu (`dateField >= dateFrom`) */
  dateFrom?: Date;
  /** ISO datetime — kayıt aralığı sorgusu (`dateField <= dateTo`) */
  dateTo?: Date;
  /** Hangi tarih kolonu üzerinden filtre. Whitelist service'te. */
  dateField?: string;
}

/** JWT payload stored in token */
export interface JwtPayload {
  userId: string;
  username: string;
  permissions: string[];
}
