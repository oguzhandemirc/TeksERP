// =============================================================================
// FİNANS ÖZETİ — gün sonu (S4) + haftalık (S5a), geniş katalog 2026-11-14
// =============================================================================
// Sayılar belgelerin kendi damgalarından (SystemLog'dan türetilmez): kaydedilen tahsilat/ödeme `payments.createdAt`
// (sonradan iptal edilen de o gün kaydedilmiştir — "ne oldu"), onaylanan fatura `confirmedAt`, onaylıyken iptal edilen
// `cancelledAt`. TUTAR YOK (gelen kutusu kasa defteri değil). Hepsi sıfırsa pencere bildirimsiz geçer.
// =============================================================================
import { PaymentDirection, type Prisma } from "@prisma/client";
import { registerDigestSource, type DigestWindow } from "../../jobs/notification-digest.job";

export function registerFinanceDigestSources(): void {
  // Günlük ve haftalık finans özeti AYNI sayımı yapar; yalnız pencere ve etiket alanı (`gun` / `hafta`) farklıdır.
  registerDigestSource({ kind: "finans.gunluk-ozet", compute: async (tx, w) => financeCounts(tx, w, "gun") });
  registerDigestSource({ kind: "finans.haftalik-ozet", compute: async (tx, w) => financeCounts(tx, w, "hafta") });
}

async function financeCounts(tx: Prisma.TransactionClient, w: DigestWindow, labelKey: "gun" | "hafta"): Promise<Record<string, unknown> | null> {
  const createdAt = { gte: w.from, lt: w.to };
  const tahsilat = await tx.payment.count({ where: { direction: PaymentDirection.IN, createdAt } });
  const odeme = await tx.payment.count({ where: { direction: PaymentDirection.OUT, createdAt } });
  const fatura = await tx.invoice.count({ where: { confirmedAt: createdAt } });
  const iptal = await tx.invoice.count({ where: { cancelledAt: createdAt, confirmedAt: { not: null } } });
  if (tahsilat + odeme + fatura + iptal === 0) return null;
  return { [labelKey]: w.label, tahsilat, odeme, fatura, iptal };
}
