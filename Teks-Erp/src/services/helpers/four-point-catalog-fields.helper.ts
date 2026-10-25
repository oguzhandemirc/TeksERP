// K4P katalog alanları — BaseController gövdesinde skaler kolon otomatik yazılabilir; DB CHECK'ine
// düşmeden Türkçe 400 versin diye biçim burada daraltılır (hata türü `fixedPoints`/`sortOrder`, ürün `widthCm`).
import { AppError } from "../../utils/app-error";

function bad(message: string): AppError {
  return AppError.badRequest(message, { code: "VALIDATION_ERROR" });
}

export function normalizeDefectTypeFourPointBody(body: Record<string, unknown>): void {
  if ("fixedPoints" in body) {
    const v = body.fixedPoints;
    if (v === null || v === "") body.fixedPoints = null;
    else if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 4) throw bad("Sabit puan 1 ile 4 arasında tam sayı olmalı.");
  }
  if ("sortOrder" in body) {
    const v = body.sortOrder;
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 32767) throw bad("Sıra 0 ya da pozitif tam sayı olmalı.");
  }
}

export function normalizeItemWidthBody(body: Record<string, unknown>): void {
  if (!("widthCm" in body)) return;
  const v = body.widthCm;
  if (v === null || v === "") { body.widthCm = null; return; }
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d{1,2})?$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n >= 1_000_000) throw bad("Ürün eni (cm) sıfırdan büyük, en fazla 2 haneli sayı olmalı.");
}
