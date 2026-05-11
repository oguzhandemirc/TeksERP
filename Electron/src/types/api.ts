export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

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

export interface CursorPaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
    limit: number;
    /** Sadece ilk fetch'te ?withTotal=true gönderilirse dolar. */
    totalEstimate?: number;
  };
}

export interface DateRange {
  /** ISO datetime — `dateField >= dateFrom` */
  dateFrom?: string;
  /** ISO datetime — `dateField <= dateTo` */
  dateTo?: string;
  /** Hangi tarih kolonu (createdAt / deadline / plannedStartDate / shippedAt vb.) */
  dateField?: string;
}

export interface QueryParams extends DateRange {
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: "asc" | "desc";
  filters: Record<string, string | string[]>;
  search?: string;
}

/**
 * Cursor pagination params — `useDataTable` cursor moduyla çalışırken kullanılır.
 * `cursor` opak token; `limit` sayfa başına satır; `withTotal` ilk fetch'te true.
 */
export interface CursorParams extends DateRange {
  cursor?: string | null;
  limit: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  filters: Record<string, string | string[]>;
  search?: string;
  withTotal?: boolean;
}
