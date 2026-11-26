// Fatura KDV hariç neti — TEK okuyucu (devere fark bandı · boyahane bitim kontrolü · devere gerçek maliyeti).
// `subtotal` = Σ satır neti (`computeInvoiceTotals`): satır iskontosu ZATEN düşülmüştür; `discountTotal` yalnız
// bilgidir, nete bir daha karışmaz (çift düşüm ölçüldü 2026-11-26: 250 − %16 → subtotal 210, eski hesap 170).
import { Prisma } from "@prisma/client";

export function invoiceNetExVat(inv: { subtotal: Prisma.Decimal.Value }): Prisma.Decimal {
  return new Prisma.Decimal(inv.subtotal);
}
