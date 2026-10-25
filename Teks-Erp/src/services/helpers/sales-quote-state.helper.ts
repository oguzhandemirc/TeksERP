// =============================================================================
// SATIŞ TEKLİFİ DURUM MAKİNESİ — tek kaynak (MAL-4; plan §3.3)
// =============================================================================
// Her geçiş ATOMİK CLAIM: `updateMany WHERE {id, status IN beklenen}` + count 0 → 409. "Süresi doldu"
// DURUM DEĞİL türetilmiş bayraktır (SENT ∧ validUntil < fabrika günü); bellek-içi yüklem
// `isQuoteExpired` ile Prisma parçası `quoteExpiredWhere` boğaz-ikizdir (`test_teklif_durum` §3).
// =============================================================================
import { Prisma, type SalesQuoteStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { factoryDayKeyUtcMidnight } from "../../constants/time";

/** Ölü teklif kümesi — bu durumlardan hiçbir geçiş çıkmaz (revizyon REJECTED/SENT'ten). */
export const QUOTE_DEAD_STATUSES: readonly SalesQuoteStatus[] = ["CANCELLED", "CONVERTED", "SUPERSEDED"];

/** Geçiş tablosu (plan §3.3) — servis ve bekçi aynı tablodan okur. */
export const QUOTE_TRANSITIONS = {
  send: { from: ["DRAFT"], to: "SENT" },
  accept: { from: ["SENT"], to: "ACCEPTED" },
  reject: { from: ["SENT"], to: "REJECTED" },
  cancel: { from: ["DRAFT", "SENT"], to: "CANCELLED" },
  unaccept: { from: ["ACCEPTED"], to: "SENT" },
  revise: { from: ["SENT", "REJECTED"], to: "SUPERSEDED" },
  convert: { from: ["ACCEPTED"], to: "CONVERTED" },
} as const satisfies Record<string, { from: readonly SalesQuoteStatus[]; to: SalesQuoteStatus }>;
export type QuoteTransition = keyof typeof QUOTE_TRANSITIONS;

/** Fabrika günü @db.Date karşılaştırma değeri (UTC gece yarısı; dilim `constants/time.ts`ten). */
export function quoteToday(at: Date = new Date()): Date {
  return factoryDayKeyUtcMidnight(at);
}

/** Bellek-içi yüklem — `quoteExpiredWhere` ile ikiz. */
export function isQuoteExpired(q: { status: SalesQuoteStatus; validUntil: Date }, today: Date = quoteToday()): boolean {
  return q.status === "SENT" && q.validUntil.getTime() < today.getTime();
}

/** Prisma parçası — `isQuoteExpired` ile ikiz (liste süzgeci `suresiDoldu`). */
export function quoteExpiredWhere(today: Date = quoteToday()): Prisma.SalesQuoteWhereInput {
  return { status: "SENT", validUntil: { lt: today } };
}

export const quoteStatusConflict = (status?: SalesQuoteStatus): AppError =>
  AppError.conflict("Teklifin durumu bu işleme uygun değil ya da aynı anda değişti; sayfayı yenileyin.", {
    code: "QUOTE_STATUS_CONFLICT",
    ...(status ? { status } : {}),
  });

/** Claim düşünce NEDEN düştüğünü söyler: yok → 404, süresi dolmuş SENT → QUOTE_EXPIRED, diğer → durum çakışması. */
export async function quoteClaimError(db: Prisma.TransactionClient, id: string, transition?: QuoteTransition): Promise<AppError> {
  const q = await db.salesQuote.findUnique({ where: { id }, select: { status: true, validUntil: true } });
  if (!q) return AppError.notFound("Teklif bulunamadı.");
  if (transition === "accept" && isQuoteExpired(q)) {
    return AppError.conflict("Teklifin geçerlilik süresi dolmuş; kabul edilemez. Revizyon açıp yeni geçerlilik tarihi verin.", { code: "QUOTE_EXPIRED" });
  }
  return quoteStatusConflict(q.status);
}

/**
 * Atomik claim: beklenen durumdaki teklifi tek ifadede geçirir; count 0 → nedenli hata.
 * `extra` WHERE'e eklenir (ör. kabulde süre, dönüştürmede bağ yokluğu).
 */
export async function claimQuoteTx(
  tx: Prisma.TransactionClient,
  id: string,
  transition: QuoteTransition,
  claim: { data: Prisma.SalesQuoteUncheckedUpdateManyInput; extra?: Prisma.SalesQuoteWhereInput },
): Promise<void> {
  const { data, extra = {} } = claim;
  const t = QUOTE_TRANSITIONS[transition];
  const r = await tx.salesQuote.updateMany({ where: { ...extra, id, status: { in: [...t.from] } }, data: { ...data, status: t.to } });
  if (r.count === 0) throw await quoteClaimError(tx, id, transition);
}

/** DRAFT kilidi: kalem/başlık düzenlemesinden ÖNCE tx'in başında — SENT teklif değişmez. */
export async function claimDraftQuoteTx(tx: Prisma.TransactionClient, id: string, userId: string | undefined): Promise<void> {
  const r = await tx.salesQuote.updateMany({ where: { id, status: "DRAFT" }, data: { updatedById: userId ?? null, updatedAt: new Date() } });
  if (r.count === 0) throw await quoteClaimError(tx, id);
}
