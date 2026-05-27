// =============================================================================
// TeksERP - Custom AppError
// =============================================================================

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  /**
   * Opsiyonel yapılandırılmış payload — error response body'sine eklenir.
   * Client tarafı `code` field'ı ile özel handling yapabilir (örn. modal
   * gösterme, retry-with-override flow). Yapı:
   *   { code: 'ITEM_MISMATCH', mismatchedRolls: [...], expectedItemId: '...' }
   * `code` opsiyonel ama kullanılması önerilir — message string match'inden
   * sağlam dedektör için.
   */
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    isOperational = true,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message: string, details?: Record<string, unknown>): AppError {
    return new AppError(message, 400, true, details);
  }

  static unauthorized(message: string = "Yetkisiz erişim"): AppError {
    return new AppError(message, 401);
  }

  static forbidden(message: string = "Bu işlem için yetkiniz yok"): AppError {
    return new AppError(message, 403);
  }

  static notFound(message: string = "Kayıt bulunamadı"): AppError {
    return new AppError(message, 404);
  }

  static conflict(message: string, details?: Record<string, unknown>): AppError {
    return new AppError(message, 409, true, details);
  }

  static internal(message: string = "Sunucu hatası"): AppError {
    return new AppError(message, 500, false);
  }
}
