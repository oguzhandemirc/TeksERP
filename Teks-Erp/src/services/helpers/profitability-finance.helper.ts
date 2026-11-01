// =============================================================================
// KÂRLILIK — FİNANS OKUMALARI (D4-G2a; DALGA4 §8.3 formül, §8.5)
// =============================================================================
// `profitability.helper` finans tablolarına (fatura, satır, kur) DOĞRUDAN dokunmaz: bu dosya yalnız
// `maliyet-bridge.helper` içinden, finans modülü açıkken DİNAMİK import edilir (maliyet.md köprü kuralı).
// Yalnız okur; hiçbir şey hesaplamaz — pay/tutar aritmetiği `profitability.helper`dadır.
// =============================================================================
import { Currency, InvoiceStatus, InvoiceType, Prisma, ServiceMeterBasis } from "@prisma/client";
import prisma from "../../lib/prisma";
import { resolveExchangeRateTx } from "./finance.helper";

export interface RevenueLinkRow {
  id: string;
  rollId: string;
  workOrderStepId: string | null;
  serviceItemId: string;
  billedMeters: Prisma.Decimal;
  meterBasis: ServiceMeterBasis;
  serviceAt: Date;
  machineId: string | null;
  /** D4-G2b: ölçüm okumasının anı (okuma yoksa makine günü `serviceAt`). */
  readingAt: Date | null;
  /** D4-G2b: okumanın adımı — iş anahtarı makine × top × adım (düzeltme zinciri ve fazlar tek iş). */
  readingStepId: string | null;
  /** D4-G2b: aynı okumaya bağlı sayılan hizmet kalemleri içinde bu kalemin sırası / sayısı (makine süresi tek sayım). */
  readingShareIndex: number;
  readingShareCount: number;
  ownerCustomerId: string | null;
}

export interface RevenueInvoiceRow {
  id: string;
  docNo: string;
  status: InvoiceStatus;
  exchangeRate: Prisma.Decimal;
  issueDate: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cariCustomerId: string | null;
  /** Kalem → satır net tutarları toplamı (belge para birimi; KDV/tevkifat hariç). */
  lineTotalByItem: Map<string, Prisma.Decimal>;
  /** Faturanın o anda geçerli bağları (bkz. `countedLinkWhere`). */
  links: RevenueLinkRow[];
}

/**
 * Onaylı/iptal faturada sayılan bağ: aktif ya da ONAYDAN SONRA damgalanmış (iptal damgası). Taslakken çıkarılan satırın
 * bağı (onaydan önce damgalı) sayılmaz. Taslakta yalnız aktif bağ.
 */
function countedLinks<T extends { revokedAt: Date | null }>(links: T[], confirmedAt: Date | null): T[] {
  return links.filter((l) => l.revokedAt === null || (confirmedAt !== null && l.revokedAt.getTime() >= confirmedAt.getTime()));
}

/**
 * TAMBUR + ETEK gibi aynı okumaya bağlı birden çok kalem makine süresini BÖLÜŞÜR (tek sayım, DALGA4 §8.3). Sayılan bağ:
 * aktif ya da onaydan sonra damgalı (taslaktan çıkarılan sayılmaz); kalemler belirlenimli sıralanır.
 */
function readingShare(itemId: string, siblings: Array<{ serviceItemId: string; revokedAt: Date | null; invoice: { confirmedAt: Date | null } }>): { readingShareIndex: number; readingShareCount: number } {
  const items = new Set([itemId]);
  for (const s of siblings) if (countedLinks([s], s.invoice.confirmedAt).length > 0) items.add(s.serviceItemId);
  const sorted = [...items].sort();
  return { readingShareIndex: sorted.indexOf(itemId), readingShareCount: sorted.length };
}

/**
 * Hizmet bağı taşıyan SATIŞ faturaları: [start, end) içinde fatura tarihli (onaylı/iptal ya da taslak) ya da
 * iptal anı bu aralıkta olanlar. Sıra belirlenimli (issueDate, id).
 */
export async function readServiceRevenueInvoices(start: Date, end: Date): Promise<RevenueInvoiceRow[]> {
  const rows = await prisma.invoice.findMany({
    where: {
      type: InvoiceType.SALES,
      serviceBillingLinks: { some: {} },
      OR: [
        { issueDate: { gte: start, lt: end }, OR: [{ status: InvoiceStatus.DRAFT }, { confirmedAt: { not: null } }] },
        { cancelledAt: { gte: start, lt: end }, confirmedAt: { not: null } },
      ],
    },
    select: {
      id: true, docNo: true, status: true, exchangeRate: true, issueDate: true, confirmedAt: true, cancelledAt: true,
      cari: { select: { customerId: true } },
      lines: { select: { itemId: true, lineTotal: true } },
      serviceBillingLinks: {
        select: {
          id: true, rollId: true, workOrderStepId: true, serviceItemId: true, billedMeters: true, meterBasis: true, serviceAt: true, revokedAt: true,
          reading: {
            select: {
              machineId: true, createdAt: true, workOrderStepId: true,
              billingLinks: { select: { serviceItemId: true, revokedAt: true, invoice: { select: { confirmedAt: true } } } },
            },
          },
          roll: { select: { ownerCustomerId: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
    orderBy: [{ issueDate: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => {
    const lineTotalByItem = new Map<string, Prisma.Decimal>();
    for (const l of r.lines) if (l.itemId) lineTotalByItem.set(l.itemId, (lineTotalByItem.get(l.itemId) ?? new Prisma.Decimal(0)).plus(l.lineTotal));
    const links = r.status === InvoiceStatus.DRAFT ? r.serviceBillingLinks.filter((l) => l.revokedAt === null) : countedLinks(r.serviceBillingLinks, r.confirmedAt);
    return {
      id: r.id, docNo: r.docNo, status: r.status, exchangeRate: r.exchangeRate, issueDate: r.issueDate, confirmedAt: r.confirmedAt, cancelledAt: r.cancelledAt,
      cariCustomerId: r.cari.customerId, lineTotalByItem,
      links: links.map((l) => ({
        id: l.id, rollId: l.rollId, workOrderStepId: l.workOrderStepId, serviceItemId: l.serviceItemId, billedMeters: l.billedMeters,
        meterBasis: l.meterBasis, serviceAt: l.serviceAt, machineId: l.reading?.machineId ?? null, readingAt: l.reading?.createdAt ?? null, ownerCustomerId: l.roll.ownerCustomerId,
        readingStepId: l.reading?.workOrderStepId ?? null, ...readingShare(l.serviceItemId, l.reading?.billingLinks ?? []),
      })),
    };
  });
}

/** Sarf kaleminin onaylı alış faturası satırları (SON_ALIS_FATURASI): net birim TL = lineTotal / qty × belge kuru. */
export async function readConsumablePurchaseLines(itemIds: string[]): Promise<Array<{ itemId: string; issueDate: Date; unitTry: Prisma.Decimal }>> {
  if (itemIds.length === 0) return [];
  const rows = await prisma.invoiceLine.findMany({
    where: { itemId: { in: itemIds }, qty: { gt: 0 }, invoice: { type: InvoiceType.PURCHASE, status: InvoiceStatus.CONFIRMED } },
    select: { itemId: true, qty: true, lineTotal: true, createdAt: true, id: true, invoice: { select: { issueDate: true, exchangeRate: true } } },
    orderBy: [{ invoice: { issueDate: "asc" } }, { createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({ itemId: r.itemId!, issueDate: r.invoice.issueDate, unitTry: r.lineTotal.div(r.qty).mul(r.invoice.exchangeRate) }));
}

/** Fason makbuzlarının ONAYLI alış (fason) faturası tutarı, TL (KDV hariç net satır toplamı × belge kuru). */
export async function readSubcontractInvoiceTotals(receiptIds: string[]): Promise<Map<string, Prisma.Decimal>> {
  const out = new Map<string, Prisma.Decimal>();
  if (receiptIds.length === 0) return out;
  const rows = await prisma.invoice.findMany({
    where: { subcontractorReceiptId: { in: receiptIds }, type: InvoiceType.PURCHASE, status: InvoiceStatus.CONFIRMED },
    select: { subcontractorReceiptId: true, exchangeRate: true, lines: { select: { lineTotal: true } } },
    orderBy: [{ issueDate: "asc" }, { id: "asc" }],
  });
  for (const r of rows) {
    const net = r.lines.reduce((a, l) => a.plus(l.lineTotal), new Prisma.Decimal(0)).mul(r.exchangeRate);
    out.set(r.subcontractorReceiptId!, (out.get(r.subcontractorReceiptId!) ?? new Prisma.Decimal(0)).plus(net));
  }
  return out;
}

/** Kur (1 döviz kaç TL) — finansın tek çözücüsü; yoksa null (asla 1 varsayılmaz). */
export function readFxRate(currency: Currency, at: Date): Promise<Prisma.Decimal | null> {
  return resolveExchangeRateTx(prisma as unknown as Prisma.TransactionClient, currency, at);
}

/**
 * D4-G2b: kasa masrafları kategori × fabrika ayı TL (genel gider / işçilik havuzu). Evren ve kategori anahtarı TEK
 * kaynaktan (`expense-summary.helper` — asıl satır `txnDate` ayında +, iptal `cancelledAt` ayında −); burada toplanmaz.
 * `classNames` (ayardaki kategori adları) aynı `cashCategoryKey` ile eşlenir → hücrenin `className`i.
 */
export async function readExpenseCells(start: Date, end: Date, classNames: string[]): Promise<Array<{ key: string; label: string; className: string | null; month: string; amountTry: Prisma.Decimal }>> {
  const { getExpenseSummary, cashCategoryKey } = await import("./expense-summary.helper");
  const byKey = new Map(classNames.map((n) => [cashCategoryKey(n).key, n]));
  const sum = await getExpenseSummary({ range: { from: start, to: new Date(end.getTime() - 1) } });
  return sum.categories.flatMap((c) => c.cells.map((cell) => ({
    key: c.key, label: c.label, className: byKey.get(c.key) ?? null, month: cell.month, amountTry: new Prisma.Decimal(cell.amountTry),
  })));
}

/** D4-G2c: masraf bağı parçası (işaretli TL); türü ve aritmetiği `profitability-allocation.helper`dadır. */
export interface ExpenseAllocationPiece {
  kind: "AS_OF" | "LATE_ADJUSTMENT" | "CANCEL_REVERSAL";
  cashTransactionId: string;
  docNo: string | null;
  className: string | null;
  machineId: string | null;
  workOrderId: string | null;
  serviceItemId: string | null;
  sharePct: Prisma.Decimal;
  amountTry: Prisma.Decimal;
}

const ALLOCATION_EPOCH = new Date(Date.UTC(1970, 0, 1));

/**
 * D4-G2c: `[start, end)` ayının masraf bağları — YALNIZ as-of okuyucudan (`listExpenseAllocationsAsOf`; "aktif bağ"
 * okuması yasak). AS_OF: ay masrafının ay sonunda geçerli bağı · LATE_ADJUSTMENT: önceki ay masraflarına bu ay yapılan
 * bağ olayları (iptali önceki ayda kalmış masrafınki hariç — iptal ayında ters çevrildi) · CANCEL_REVERSAL: bu ay iptal
 * edilen masrafın ay sonundaki bağları eksiyle (masraf özetinin iptal ayı eksisinin doğrudan payı).
 */
export async function readExpenseAllocationPieces(start: Date, end: Date, classNames: string[]): Promise<ExpenseAllocationPiece[]> {
  const { listExpenseAllocationsAsOf } = await import("./expense-allocation.helper");
  const { cashCategoryKey } = await import("./expense-summary.helper");
  const byKey = new Map(classNames.map((n) => [cashCategoryKey(n).key, n]));
  const month = await listExpenseAllocationsAsOf(prisma, { start, end });
  const upToEnd = await listExpenseAllocationsAsOf(prisma, { start: ALLOCATION_EPOCH, end });
  type Row = (typeof month.atPeriodEnd)[number];
  const piece = (kind: ExpenseAllocationPiece["kind"], r: Row, sign: 1 | -1): ExpenseAllocationPiece => ({
    kind, cashTransactionId: r.cashTransactionId, docNo: r.docNo, className: byKey.get(cashCategoryKey(r.category).key) ?? null,
    machineId: r.machineId, workOrderId: r.workOrderId, serviceItemId: r.serviceItemId, sharePct: r.sharePct,
    amountTry: sign === 1 ? r.allocatedTry : r.allocatedTry.neg(),
  });
  const cancelledIn = (r: Row, from: Date, to: Date) => r.status === "CANCELLED" && r.cancelledAt !== null && r.cancelledAt >= from && r.cancelledAt < to;
  return [
    ...month.atPeriodEnd.map((r) => piece("AS_OF", r, 1)),
    ...month.lateEvents.filter((r) => !cancelledIn(r, ALLOCATION_EPOCH, start)).map((r) => piece("LATE_ADJUSTMENT", r, 1)),
    ...upToEnd.atPeriodEnd.filter((r) => cancelledIn(r, start, end)).map((r) => piece("CANCEL_REVERSAL", r, -1)),
  ];
}
