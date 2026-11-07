// =============================================================================
// FATURA SATIRI KONUSU — `lineType` + iki FK (ürün ↔ hizmet kartı ayrımı, D1a)
// =============================================================================
// Satır girdisinin `itemId`'si bugün konu kimliğidir (ürün ya da hizmet; UUID ortak uzay): hizmet faturası
// yolu satıra hizmet kartı id'sini koyar. Yazımda id `service_items`'ta ise SERVICE + `serviceItemId`, değilse
// PRODUCT + `itemId`, boşsa TEXT. DB CHECK (`invoice_lines` lineType↔FK) üç durumu ayrıca zorlar.
// =============================================================================
import { InvoiceLineType, Prisma } from "@prisma/client";

export interface InvoiceLineSubject {
  lineType: InvoiceLineType;
  itemId: string | null;
  serviceItemId: string | null;
}

/** Satır sırasıyla konu dizisi — tek sorgu (hizmet kartı kümesi). */
export async function resolveInvoiceLineSubjectsTx(
  tx: Prisma.TransactionClient,
  lines: ReadonlyArray<{ itemId?: string | null }>,
): Promise<InvoiceLineSubject[]> {
  const ids = [...new Set(lines.map((l) => l.itemId).filter((v): v is string => !!v))];
  const services = ids.length
    ? new Set((await tx.serviceItem.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((s) => s.id))
    : new Set<string>();
  return lines.map((l) => {
    if (!l.itemId) return { lineType: InvoiceLineType.TEXT, itemId: null, serviceItemId: null };
    if (services.has(l.itemId)) return { lineType: InvoiceLineType.SERVICE, itemId: null, serviceItemId: l.itemId };
    return { lineType: InvoiceLineType.PRODUCT, itemId: l.itemId, serviceItemId: null };
  });
}
