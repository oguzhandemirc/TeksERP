// =============================================================================
// TEKLİF BEKÇİ FİKSTÜRÜ (MAL-4) — müşteri rollü cari + doğrudan teklif satırı; sonda siler
// =============================================================================
// `test_teklif_durum`, `test_teklif_siparis`, `test_teklif_gorunurluk`, `test_teklif_uc`
// ortak kullanır. Yalnız test DB (çağıran `assertGelistirmeVeritabani` + burada `hedefDbEngeli`).
// `teklifYaz` durum makinesini ATLAYARAK istenen durumda satır kurar — geçiş matrisi her başlangıç
// durumunu ölçebilsin diye; servis yolunu ölçen testler servis fonksiyonlarını çağırır.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma, type SalesQuoteStatus } from "@prisma/client";
import prisma from "../../src/lib/prisma";
import { hedefDbEngeli } from "./hedef-db-kapisi";
import { quoteToday } from "../../src/services/helpers/sales-quote-state.helper";

function kapi(ne: string): void {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`teklif fikstürü ${ne} durduruldu — ${engel}`);
}

const D = (v: string | number): Prisma.Decimal => new Prisma.Decimal(v);
const DAY = 86_400_000;

export interface TeklifFikstur {
  tag: string;
  customerId: string;
  quoteIds: string[];
}

export async function teklifFiksturKur(tagPrefix: string): Promise<TeklifFikstur> {
  kapi("kurulumu");
  const tag = `${tagPrefix}${Date.now().toString(36).toUpperCase()}`;
  const c = await prisma.customer.create({ data: { code: `${tag}-M`.slice(0, 32), name: `${tag} müşteri`, isCustomerRole: true }, select: { id: true } });
  return { tag, customerId: c.id, quoteIds: [] };
}

/** İstenen durumda teklif (+1 kalem) — durum makinesini atlar (yalnız bekçi). */
export async function teklifYaz(
  f: TeklifFikstur,
  status: SalesQuoteStatus,
  opts: { validDays?: number; lines?: number; convertedOrderId?: string; itemId?: string | null } = {},
): Promise<string> {
  kapi("yazımı");
  const today = quoteToday();
  const lines = opts.lines ?? 1;
  const q = await prisma.salesQuote.create({
    data: {
      quoteNo: `${f.tag}-${f.quoteIds.length + 1}`.slice(0, 32),
      clientToken: randomUUID(),
      customerId: f.customerId,
      quoteDate: new Date(today.getTime() - 10 * DAY),
      validUntilDate: new Date(today.getTime() + (opts.validDays ?? 30) * DAY),
      currency: "USD",
      fxRate: D(34),
      fxRateSource: "MANUAL",
      status,
      ...(status === "SUPERSEDED" ? { supersededAt: new Date() } : {}),
      ...(status === "CONVERTED" ? { convertedOrderId: opts.convertedOrderId } : {}),
      totalAmount: D(lines * 250),
      totalCostTry: D(lines * 7704),
      internalNote: "iç not",
      lines: {
        create: Array.from({ length: lines }, (_, i) => ({
          lineNo: i + 1,
          itemId: opts.itemId ?? null,
          description: `${f.tag} kalem ${i + 1}`,
          quantity: D(100),
          costPerMTry: D("77.0395"),
          costSnapshot: { schemaVersion: 1, kaynak: "ELLE", standartTlM: "77.0395", satirlar: [], uyarilar: [], kurlar: { tarih: "2026-10-25", kaynak: "ELLE", kurlar: { USD: "34" } } },
          markupPct: D(18),
          suggestedUnitPrice: D("2.6738"),
          unitPrice: D("2.50"),
          priceSource: "MANUAL" as const,
          lineTotal: D(250),
        })),
      },
    },
    select: { id: true },
  });
  f.quoteIds.push(q.id);
  return q.id;
}

export async function teklifFiksturSil(f: TeklifFikstur): Promise<void> {
  kapi("temizliği");
  const all = await prisma.salesQuote.findMany({ where: { customerId: f.customerId }, select: { id: true, convertedOrderId: true } });
  const ids = all.map((q) => q.id);
  const orderIds = all.map((q) => q.convertedOrderId).filter((x): x is string => !!x);
  if (ids.length) {
    await prisma.salesQuoteLine.deleteMany({ where: { quoteId: { in: ids } } });
    await prisma.$executeRaw`UPDATE "sales_quotes" SET "revisionOfId" = NULL, "status" = 'CANCELLED', "convertedOrderId" = NULL, "supersededAt" = NULL WHERE "id" = ANY(${ids}::uuid[])`;
    await prisma.salesQuote.deleteMany({ where: { id: { in: ids } } });
  }
  const orders = await prisma.order.findMany({ where: { OR: [{ id: { in: orderIds } }, { customerId: f.customerId }] }, select: { id: true } });
  const oids = orders.map((o) => o.id);
  if (oids.length) {
    await prisma.orderLine.deleteMany({ where: { orderId: { in: oids } } });
    await prisma.order.deleteMany({ where: { id: { in: oids } } });
  }
  // Gönderim/yayın geçişi belgeyi dondurur (eager) — fikstürün belge satırları da gider (yalnız test DB).
  const listIds = (await prisma.priceList.findMany({ where: { customerId: f.customerId }, select: { id: true } })).map((l) => l.id);
  await prisma.printedDocument.deleteMany({ where: { OR: [{ docType: "SALES_QUOTE", sourceId: { in: ids } }, { docType: "PRICE_LIST", sourceId: { in: listIds } }] } });
  await prisma.priceListLine.deleteMany({ where: { priceList: { customerId: f.customerId } } });
  await prisma.priceList.deleteMany({ where: { customerId: f.customerId } });
  await prisma.customer.delete({ where: { id: f.customerId } });
}
