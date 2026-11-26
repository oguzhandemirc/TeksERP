// =============================================================================
// DEVERE GERÇEK MALİYETİ — FİNANS OKUMASI (devere maliyet dilim 1; plan PLAN-devere-maliyet-1126 §2.2)
// =============================================================================
// Yalnız `maliyet-bridge.helper` içinden, finans açıkken DİNAMİK import edilir (maliyet.md köprü kuralı).
// Kabul anahtarlarına bağlı ONAYLI alış faturası: net = `subtotal` (Σ satır neti — satır iskontosu ZATEN düşülmüş,
// KDV/tevkifat hariç; `computeInvoiceTotals`) × belge kuru. Taslak ve iptal (storno) okunmaz. Paylaştırma YAPILMAZ.
// =============================================================================
import { InvoiceStatus, InvoiceType, Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { invoiceNetExVat } from "./invoice-net.helper";

type Db = Prisma.TransactionClient | typeof prisma;

export interface WarpingReceiptInvoice {
  invoiceId: string;
  /** KDV hariç net × belge kuru (TL). */
  netTry: Prisma.Decimal;
  /** Faturanın kapsadığı BÜTÜN kabul anahtarları (yalnız sorulanlar değil) — paylaştırma tabanı. */
  receiptKeys: string[];
}

/** Verilen kabullerden en az birine bağlı onaylı alış faturaları (kabul başına en çok bir iptal edilmemiş fatura). */
export async function readWarpingReceiptInvoices(db: Db, receiptKeys: string[]): Promise<WarpingReceiptInvoice[]> {
  if (receiptKeys.length === 0) return [];
  const rows = await db.invoice.findMany({
    where: {
      type: InvoiceType.PURCHASE,
      status: InvoiceStatus.CONFIRMED,
      warpingReceiptLinks: { some: { warpingReceiptKey: { in: receiptKeys } } },
    },
    select: { id: true, subtotal: true, exchangeRate: true, warpingReceiptLinks: { select: { warpingReceiptKey: true } } },
    orderBy: { id: "asc" },
  });
  return rows.map((r) => ({
    invoiceId: r.id,
    netTry: invoiceNetExVat(r).mul(r.exchangeRate),
    receiptKeys: [...new Set(r.warpingReceiptLinks.map((l) => l.warpingReceiptKey))].sort(),
  }));
}
