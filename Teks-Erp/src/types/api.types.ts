// =============================================================================
// TeksERP - Shared API Types
// =============================================================================

/** Standard API response wrapper */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  /**
   * Engel OLMAYAN notlar — istek başarıyla yazıldı ama kullanıcının görmesi
   * gereken bir durum var (örn. "rotada renk veren adım yok"). İstemci toast
   * basar; eski istemciler alanı tanımıyorsa sessizce yok sayar.
   */
  warnings?: string[];
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
  /** Login anındaki User.tokenVersion — verifyToken her istekte DB'yle karşılaştırır
   *  (yetki/şifre değişince bump → eski token geçersiz). Eski (sürümsüz) tokenlar
   *  deploy sonrası bir kez re-login gerektirir. */
  tokenVersion: number;
  /** JWT jti claim — Session registry satırının anahtarı (jwt.sign jwtid). Login'de
   *  üretilir; auth.middleware her istekte Session.revokedAt kontrol eder → oturum
   *  iptal edilince eski token 401 alır. Eski (jti'siz) tokenlar deploy sonrası bir
   *  kez re-login gerektirir (fail-closed). */
  jti: string;
}
