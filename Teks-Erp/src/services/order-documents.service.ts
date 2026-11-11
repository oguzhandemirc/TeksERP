// =============================================================================
// Sipariş teyidi BASILI BELGESİ — kaynak çözücü (Seyitoğlu 3. bölüm L1)
// =============================================================================
// Payload YALNIZ müşteri alanlarını taşır: sevk edilen miktar, reçete, kesim notu, iptal sebebi,
// oluşturan kullanıcı SEÇİLMEZ (select = sızıntı sınırı; bekçi test_siparis_teyidi). Taslak yok:
// ilk açılışta (`/current`) donar; sipariş değişince yeni sürüm generic yeniden basımla; iptal
// edilen siparişin belgesi VOIDED (iptal tx'inde `voidOrderConfirmationTx`, belgesiz iptal VOIDED doğar).
// Fiyat sipariş detayıyla aynı kapıdadır (`order:read`); fiyatsız teyit `columns.kalemler.hidden`.
// =============================================================================
import { PrintedDocType, type Prisma } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { renderOrderConfirmationHtml, renderOrderConfirmationTables, type OrderConfirmationDoc } from "./document-render/order-confirmation.html";
import { printedDocumentService, registerPrintedDocBuilder, type BuiltDocContent, type PrintedDocDb } from "./printed-document.service";

const num = (v: Prisma.Decimal | null | undefined): number | null => (v == null ? null : Number(v));

const ORDER_DOC_SELECT = {
  orderNumber: true, status: true, orderDate: true, deadline: true, currency: true, totalAmount: true, cancelReason: true, cancelledAt: true,
  customer: { select: { name: true, code: true } },
  branch: { select: { name: true } },
  lines: {
    where: { cancelledAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      quantity: true, unit: true, unitPrice: true, width: true, tolerancePct: true, customerItemName: true, customerColorName: true,
      item: { select: { code: true, name: true } }, color: { select: { name: true } },
    },
  },
} satisfies Prisma.OrderSelect;

async function collectOrder(db: PrintedDocDb, orderId: string) {
  const o = await db.order.findUnique({ where: { id: orderId }, select: ORDER_DOC_SELECT });
  if (!o) throw AppError.notFound("Sipariş bulunamadı.", { code: "ORDER_NOT_FOUND" });
  const lines = o.lines.map((l, i) => {
    const quantity = Number(l.quantity);
    const unitPrice = num(l.unitPrice);
    return {
      lineNo: i + 1, itemCode: l.item.code, itemName: l.item.name, customerItemName: l.customerItemName, colorName: l.color?.name ?? null,
      customerColorName: l.customerColorName, widthCm: num(l.width), quantity, unit: l.unit, unitPrice,
      // Tutar = miktar × birim fiyat (kuruşa); fiyatsız satırda null — 0 basılmaz.
      lineTotal: unitPrice == null ? null : Math.round(quantity * unitPrice * 100) / 100,
      tolerancePct: num(l.tolerancePct),
    };
  });
  const doc: OrderConfirmationDoc = {
    header: {
      documentNo: o.orderNumber, orderNumber: o.orderNumber, orderDate: o.orderDate.toISOString(), deadline: o.deadline?.toISOString() ?? null,
      currency: o.currency, customerName: o.customer.name, customerCode: o.customer.code ?? null, branchName: o.branch?.name ?? null,
    },
    lines,
    totals: { quantity: Math.round(lines.reduce((s, l) => s + l.quantity, 0) * 1000) / 1000, amount: num(o.totalAmount) },
  };
  return { o, content: { documentNo: doc.header.documentNo, doc: doc as unknown as Record<string, unknown> } satisfies BuiltDocContent };
}

async function orderFresh(db: PrintedDocDb, orderId: string): Promise<BuiltDocContent> {
  const { o, content } = await collectOrder(db, orderId);
  if (o.status === "CANCELLED") return { ...content, voidInfo: { reason: o.cancelReason ?? "Sipariş iptal edildi", at: o.cancelledAt ?? new Date() } };
  return content;
}

registerPrintedDocBuilder(PrintedDocType.ORDER_CONFIRMATION, {
  fresh: orderFresh,
  freeze: orderFresh,
  buildPreview: async (db, orderId) => (await collectOrder(db, orderId)).content,
  renderHtml: renderOrderConfirmationHtml,
  renderTables: renderOrderConfirmationTables,
  resolveProfileId: async (db, orderId) =>
    (await db.order.findUnique({ where: { id: orderId }, select: { customer: { select: { documentProfileId: true } } } }))?.customer.documentProfileId ?? null,
});

/** Sipariş iptalinde donmuş teyidi VOIDED'e çeker — iptal claim'inin tx'i İÇİNDE (birlikte ya da hiç). */
export function voidOrderConfirmationTx(tx: Prisma.TransactionClient, orderId: string, reason: string): Promise<number> {
  return printedDocumentService.voidForSource(tx, PrintedDocType.ORDER_CONFIRMATION, orderId, reason);
}
