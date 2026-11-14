// =============================================================================
// FİNANS ÖZETİ — gün sonu (S4, geniş katalog 2026-11-14)
// =============================================================================
// Sayılar belgelerin kendi damgalarından (SystemLog'dan türetilmez): kaydedilen tahsilat/ödeme `payments.createdAt`
// (sonradan iptal edilen de o gün kaydedilmiştir — "ne oldu"), onaylanan fatura `confirmedAt`, onaylıyken iptal edilen
// `cancelledAt`. TUTAR YOK (gelen kutusu kasa defteri değil). Hepsi sıfırsa pencere bildirimsiz geçer.
// =============================================================================
import { PaymentDirection } from "@prisma/client";
import { registerDigestSource } from "../../jobs/notification-digest.job";

export function registerFinanceDigestSources(): void {
  registerDigestSource({
    kind: "finans.gunluk-ozet",
    compute: async (tx, w) => {
      const createdAt = { gte: w.from, lt: w.to };
      const tahsilat = await tx.payment.count({ where: { direction: PaymentDirection.IN, createdAt } });
      const odeme = await tx.payment.count({ where: { direction: PaymentDirection.OUT, createdAt } });
      const fatura = await tx.invoice.count({ where: { confirmedAt: createdAt } });
      const iptal = await tx.invoice.count({ where: { cancelledAt: createdAt, confirmedAt: { not: null } } });
      if (tahsilat + odeme + fatura + iptal === 0) return null;
      return { gun: w.label, tahsilat, odeme, fatura, iptal };
    },
  });
}
