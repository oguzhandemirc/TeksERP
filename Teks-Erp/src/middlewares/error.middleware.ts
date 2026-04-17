// =============================================================================
// TeksERP - Global Error Handler Middleware
// =============================================================================

import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/app-error";

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  // Known operational errors
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
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
      const target = (prismaErr.meta?.target as string[])?.join(", ") || "field";
      res.status(409).json({
        success: false,
        message: `Bu ${target} değeri zaten mevcut (unique constraint).`,
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

    // Other Prisma known errors
    res.status(400).json({
      success: false,
      message: `Veritabanı hatası (${prismaErr.code}).`,
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

  // Unknown / unexpected errors
  console.error("Unhandled Exception:", err);
  res.status(500).json({
    success: false,
    message: "Sunucu hatası oluştu.",
  });
};
