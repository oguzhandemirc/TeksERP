// =============================================================================
// TeksERP - Global Error Handler Middleware
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/app-error";
import { AuditService } from "../services/audit.service";
import "../types/express-augment";

/**
 * Prisma P2003 FK kolonunu farklı versiyon formatlarından çıkarır.
 * Prisma versiyon/adapter'ına göre meta yapısı değişir:
 *
 *   v5 (eski adapter):   meta.field_name = "OrderLine_itemId_fkey (index)"
 *   v6 (engine):         meta.field_name = "orders_customerId_fkey"
 *   v7 + pg adapter:     meta.driverAdapterError.cause.originalMessage =
 *                        '... violates foreign key constraint "orders_customerId_fkey"'
 *
 * Çıkarımı yapamazsak null döner; çağıran generic fallback mesajına düşer.
 */
function extractFkColumn(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;

  // Aday string'ler: meta.field_name + driverAdapterError.cause.originalMessage
  const candidates: string[] = [];
  if (typeof meta.field_name === "string") candidates.push(meta.field_name);

  const driverErr = meta.driverAdapterError as
    | { cause?: { originalMessage?: unknown; constraint?: unknown } }
    | undefined;
  const cause = driverErr?.cause;
  if (cause && typeof cause.originalMessage === "string") {
    candidates.push(cause.originalMessage);
  }
  if (cause && typeof cause.constraint === "string") {
    candidates.push(cause.constraint);
  }

  for (const raw of candidates) {
    // "table_fieldName_fkey" veya "Model_fieldName_fkey (index)"
    const m = raw.match(/_([a-zA-Z][a-zA-Z0-9]*)_fkey/);
    if (m) return m[1];
  }

  // Son çare: meta.field_name sadece field adı içeriyor (örn. "itemId")
  if (
    typeof meta.field_name === "string" &&
    /^[a-zA-Z][a-zA-Z0-9]*$/.test(meta.field_name)
  ) {
    return meta.field_name;
  }
  return null;
}

/**
 * Prisma P2002 unique constraint kolon adını çıkarır.
 *   v6 engine:        meta.target = ["code"] veya "code"
 *   v7 + pg adapter:  meta.target boş; meta.driverAdapterError.cause
 *                     .originalMessage = '... violates unique constraint
 *                     "items_code_key"'
 *
 * Çoklu kolon (composite unique) için ilk kolonu döner; null/undefined varsa
 * çağıran "field" generic fallback'ine düşer.
 */
function extractUniqueColumn(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;

  const target = meta.target;
  if (Array.isArray(target) && target.length > 0 && typeof target[0] === "string") {
    return target[0] as string;
  }
  if (typeof target === "string" && target.length > 0) {
    return target;
  }

  // pg adapter: constraint adından çek ("items_code_key" → "code")
  const driverErr = meta.driverAdapterError as
    | { cause?: { originalMessage?: unknown; constraint?: unknown } }
    | undefined;
  const cause = driverErr?.cause;
  const candidates: string[] = [];
  if (cause && typeof cause.originalMessage === "string") {
    candidates.push(cause.originalMessage);
  }
  if (cause && typeof cause.constraint === "string") {
    candidates.push(cause.constraint);
  }
  for (const raw of candidates) {
    const m = raw.match(/_([a-zA-Z][a-zA-Z0-9]*)_key/);
    if (m) return m[1];
  }
  return null;
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Known operational errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  // JSON parse errors (malformed request body)
  if (err instanceof SyntaxError && "status" in err && (err as SyntaxError & { status: number }).status === 400) {
    res.status(400).json({
      success: false,
      message: "Geçersiz JSON formatı. İstek gövdesini kontrol edin.",
    });
    return;
  }

  // Prisma known request errors
  if (err.constructor.name === "PrismaClientKnownRequestError") {
    const prismaErr = err as Error & { code: string; meta?: Record<string, unknown> };

    if (prismaErr.code === "P2002") {
      const col = extractUniqueColumn(prismaErr.meta);
      if (!col) {
        // Bilinmeyen format — debug için audit log
        console.warn(
          `[error.middleware] P2002 column extract failed. meta=`,
          prismaErr.meta
        );
      }
      const label = col ?? "field";
      res.status(409).json({
        success: false,
        message: `Bu '${label}' değeri zaten mevcut (unique constraint).`,
      });
      return;
    }

    if (prismaErr.code === "P2025") {
      res.status(404).json({
        success: false,
        message: "Kayıt bulunamadı.",
      });
      return;
    }

    // P2003 — Foreign key constraint failed.
    // meta.field_name format Prisma versiyonuna göre değişir:
    //   - "OrderLine_itemId_fkey (index)"  → eski
    //   - "orders_customerId_fkey"          → yeni
    //   - "itemId"                          → bazen sade
    // Generic kullanıcı için: "X alanı için belirtilen kayıt bulunamadı."
    // Service-level explicit existence check (örn. OrderService.validateCustomer)
    // varsa zaten 404/400 dönüyor; buraya düşen FK ihlali = client geçersiz UUID
    // göndermiş ve service o FK için validation yazmamış.
    if (prismaErr.code === "P2003") {
      const field = extractFkColumn(prismaErr.meta);
      const fieldLabel = field ?? "ilişkili alan";
      if (!field) {
        // Prisma versiyonu bilinmeyen bir format gönderdi — debug için logla.
        console.warn(
          `[error.middleware] P2003 field extract failed. meta=`,
          prismaErr.meta
        );
      }
      res.status(400).json({
        success: false,
        message: `Geçersiz referans: '${fieldLabel}' için belirtilen kayıt bulunamadı veya silinmiş.`,
      });
      return;
    }

    // P2020 — Value out of range for the type.
    // Yüksek sayı, taşmış decimal, geçersiz tarih vb.
    if (prismaErr.code === "P2020") {
      res.status(400).json({
        success: false,
        message: "Sayısal değer izin verilen aralık dışında. Daha küçük bir değer deneyin.",
      });
      return;
    }

    // P2022 — Column not found (schema drift).
    // DB'ye migration uygulanmamış; STARTUP audit hatası gibi durumlar.
    // 5xx olarak işaretle ve audit'e düşür — client'ı yanıltmayalım.
    if (prismaErr.code === "P2022") {
      console.error("[error.middleware] Schema drift detected (P2022):", prismaErr.meta);
      res.status(500).json({
        success: false,
        message: "Sunucu yapılandırma hatası. Lütfen yöneticiyle iletişime geçin.",
      });
      return;
    }

    // P2014 — Required relation change violated.
    if (prismaErr.code === "P2014") {
      res.status(400).json({
        success: false,
        message: "İlişki kuralı ihlali: zorunlu bağlı kayıt değiştirilemez.",
      });
      return;
    }

    // Diğer Prisma known error'lar — code'u sızdırmadan generic 400 dön.
    // Detay server log'una düşer (Prisma kendisi yazıyor); SYSTEM/ERROR audit'i
    // alta düşmesin diye buradan return ediyoruz.
    console.error(`[error.middleware] Unhandled Prisma code ${prismaErr.code}:`, prismaErr.meta);
    res.status(400).json({
      success: false,
      message: "İstek işlenemedi. Gönderilen veriyi kontrol edin.",
    });
    return;
  }

  // Prisma validation errors (wrong data shape for model)
  if (err.constructor.name === "PrismaClientValidationError") {
    res.status(400).json({
      success: false,
      message: "Geçersiz veri yapısı. Gönderilen alanları ve tipleri kontrol edin.",
    });
    return;
  }

  // Zod validation errors
  if (err.constructor.name === "ZodError") {
    const zodErr = err as Error & { issues: Array<{ path: (string | number)[]; message: string }> };
    res.status(400).json({
      success: false,
      message: "Validasyon hatası",
      errors: zodErr.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
    return;
  }

  // Unknown / unexpected errors → SystemLog'a SYSTEM/ERROR yaz.
  // AppError ve bilinen validation/Prisma error'ları yukarıda 4xx olarak
  // dönmüş; buraya düşen her şey gerçek 5xx olarak değerlendirilir.
  console.error("Unhandled Exception:", err);

  void AuditService.logEvent({
    category: "SYSTEM",
    action: "ERROR",
    userId: req.user?.userId,
    recordId: err.name || "UnhandledException",
    ipAddress: req.ip ?? null,
    payload: {
      message: err.message,
      stack: err.stack?.split("\n").slice(0, 8).join("\n"),
      method: req.method,
      path: req.originalUrl,
    },
  });

  res.status(500).json({
    success: false,
    message: "Sunucu hatası oluştu.",
  });
};
