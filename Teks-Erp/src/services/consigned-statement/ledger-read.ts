// =============================================================================
// EMANET EKSTRESİ — okuyucu sözleşmesi: açılış DB'de toplanır, satırlar dönemle sınırlı ve tavanlı okunur
// =============================================================================
// Müşterinin bütün geçmişi belleğe alınmaz: açılış `createdAt < fromAt` toplamıdır (groupBy), satırlar
// [fromAt, toAt]; her sorgu `limit + 1` satır çeker, aşım YÜKLEMEDEN önce 400 olur (eksik ekstre sessiz yanlıştır).
// =============================================================================
import { AppError } from "../../utils/app-error";
import type { LedgerEvent, OpeningBalance } from "./types";

/** Dönem satırı tavanı: belge kesilmez — aşımda 400, dönem daraltılır. */
export const STATEMENT_MAX_LINES = 20_000;

export interface LedgerRead {
  opening: OpeningBalance[];
  events: LedgerEvent[];
}

export function tooLarge(count: number | string): AppError {
  return AppError.badRequest(`Ekstre ${count} satır — en fazla ${STATEMENT_MAX_LINES}; dönemi daraltın.`, { code: "CONSIGNED_STATEMENT_TOO_LARGE" });
}

/** `take: limit + 1` ile okunan sorgunun tavan kontrolü. */
export function capRows<T>(rows: T[], limit: number): T[] {
  if (rows.length > limit) throw tooLarge(`${limit}+`);
  return rows;
}
