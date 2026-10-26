// =============================================================================
// Satış teklifi + fiyat listesi BASILI BELGESİ — kaynak çözücü (MAL-6)
// =============================================================================
// Payload YALNIZ müşteri alanlarını taşır: costPerMTry, markupPct, suggestedUnitPrice,
// costSnapshot, totalCostTry, internalNote, priceSource SEÇİLMEZ (select listesi = sızıntı
// sınırı; bekçi test_teklif_belgesi §4). Donma: teklif DRAFT'ta önizleme (kaydedilmez), SENT
// sonrası ilk basımda v1; fiyat listesi PUBLISHED'da. Donmuş belgenin yeniden basımı builder'a
// uğramaz (veri erişimi açık); yeni basım/önizleme modül kapalıyken 403 MODULE_DISABLED.
// =============================================================================
import { PrintedDocType, type Prisma } from "@prisma/client";
import { licenseModuleError } from "../lib/license/module-ceiling";
import { AppError } from "../utils/app-error";
import { renderPriceListHtml, renderPriceListTables, type PriceListDoc } from "./document-render/price-list.html";
import { renderSalesQuoteHtml, renderSalesQuoteTables, type SalesQuoteDoc } from "./document-render/sales-quote.html";
import { printedDocumentService, registerPrintedDocBuilder, type BuiltDocContent, type PrintedDocDb } from "./printed-document.service";
import { readMaliyetEnabled, readProductionEnabled, SETTING_KEYS } from "./system-setting.service";

const num = (v: Prisma.Decimal | number | null | undefined): number | null => (v == null ? null : Number(v));
const isoOf = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
export const revisionDocNo = (no: string, revisionNo: number): string => `${no}/R${revisionNo}`;

/** Belge uçlarının modül kapısı — `requireMaliyetEnabled` ile aynı iki koşul (Üretim + Maliyet). */
async function assertMaliyetOpen(): Promise<void> {
  if (!(await readProductionEnabled())) {
    throw licenseModuleError(SETTING_KEYS.PRODUCTION_ENABLED, "Üretim")
      ?? AppError.forbidden("Maliyet & Teklif modülü Üretim modülüne bağlıdır; Üretim modülü bu kurulumda kapalı.", { code: "MODULE_DISABLED", modul: "production", dependent: "maliyet" });
  }
  if (!(await readMaliyetEnabled())) {
    throw licenseModuleError(SETTING_KEYS.MALIYET_ENABLED, "Maliyet & Teklif")
      ?? AppError.forbidden("Maliyet & Teklif modülü bu kurulumda kapalı.", { code: "MODULE_DISABLED", modul: "maliyet" });
  }
}

// Sızıntı sınırı: yalnız müşteri alanları seçilir (iç kolonlar sorguya hiç girmez).
const QUOTE_DOC_SELECT = {
  quoteNo: true, revisionNo: true, status: true, quoteDate: true, validUntilDate: true, currency: true, fxRate: true,
  paymentTermDays: true, customerReference: true, notes: true, cancelReason: true, cancelledAt: true, supersededAt: true, totalAmount: true,
  customer: { select: { name: true, code: true, documentProfileId: true } },
  branch: { select: { name: true } },
  lines: {
    orderBy: { lineNo: "asc" },
    select: { lineNo: true, description: true, width: true, quantity: true, unit: true, unitPrice: true, lineTotal: true, item: { select: { code: true } }, color: { select: { name: true } } },
  },
} satisfies Prisma.SalesQuoteSelect;

async function collectQuote(db: PrintedDocDb, quoteId: string) {
  const q = await db.salesQuote.findUnique({ where: { id: quoteId }, select: QUOTE_DOC_SELECT });
  if (!q) throw AppError.notFound("Teklif bulunamadı.", { code: "QUOTE_NOT_FOUND" });
  const lines = q.lines.map((l) => ({
    lineNo: l.lineNo, description: l.description, itemCode: l.item?.code ?? null, colorName: l.color?.name ?? null,
    widthCm: num(l.width), quantity: Number(l.quantity), unit: l.unit, unitPrice: Number(l.unitPrice), lineTotal: Number(l.lineTotal),
  }));
  const doc: SalesQuoteDoc = {
    header: {
      documentNo: revisionDocNo(q.quoteNo, q.revisionNo), quoteNo: q.quoteNo, revisionNo: q.revisionNo,
      quoteDate: q.quoteDate.toISOString(), validUntilDate: q.validUntilDate.toISOString(), currency: q.currency,
      fxRate: q.currency === "TRY" ? null : Number(q.fxRate), paymentTermDays: q.paymentTermDays, customerReference: q.customerReference,
      customerName: q.customer.name, customerCode: q.customer.code ?? null, branchName: q.branch?.name ?? null,
    },
    lines,
    // Toplam satırı kalemlerden (kâğıttaki sütunun toplamı); tutar teklif kaydının toplamıdır.
    totals: { quantity: Math.round(lines.reduce((s, l) => s + l.quantity, 0) * 1000) / 1000, amount: Number(q.totalAmount) },
    notes: q.notes,
  };
  return { q, content: { documentNo: doc.header.documentNo, doc: doc as unknown as Record<string, unknown> } satisfies BuiltDocContent };
}

registerPrintedDocBuilder(PrintedDocType.SALES_QUOTE, {
  // DRAFT donmaz (null → TASLAK önizlemesi); iptal/revizyon görmüş teklifin ilk basımı VOIDED doğar.
  fresh: async (db, quoteId) => {
    await assertMaliyetOpen();
    const { q, content } = await collectQuote(db, quoteId);
    if (q.status === "DRAFT") return null;
    if (q.status === "CANCELLED") return { ...content, voidInfo: { reason: q.cancelReason ?? "Teklif iptal edildi", at: q.cancelledAt ?? new Date() } };
    if (q.status === "SUPERSEDED") return { ...content, voidInfo: { reason: "Teklif revize edildi", at: q.supersededAt ?? new Date() } };
    return content;
  },
  buildPreview: async (db, quoteId) => {
    await assertMaliyetOpen();
    return (await collectQuote(db, quoteId)).content;
  },
  renderHtml: renderSalesQuoteHtml,
  renderTables: renderSalesQuoteTables,
  resolveProfileId: async (db, quoteId) =>
    (await db.salesQuote.findUnique({ where: { id: quoteId }, select: { customer: { select: { documentProfileId: true } } } }))?.customer.documentProfileId ?? null,
});

const PRICE_LIST_DOC_SELECT = {
  listNo: true, revisionNo: true, name: true, status: true, currency: true, publishedAt: true, validFromDate: true, validUntilDate: true, notes: true,
  customer: { select: { name: true, code: true } },
  lines: { orderBy: { lineNo: "asc" }, select: { lineNo: true, unitPrice: true, minQty: true, item: { select: { code: true, name: true } }, color: { select: { name: true } } } },
} satisfies Prisma.PriceListSelect;

async function collectPriceList(db: PrintedDocDb, listId: string) {
  const l = await db.priceList.findUnique({ where: { id: listId }, select: PRICE_LIST_DOC_SELECT });
  if (!l) throw AppError.notFound("Fiyat listesi bulunamadı.", { code: "PRICE_LIST_NOT_FOUND" });
  const doc: PriceListDoc = {
    header: {
      documentNo: revisionDocNo(l.listNo, l.revisionNo), listNo: l.listNo, revisionNo: l.revisionNo, name: l.name,
      customerName: l.customer?.name ?? null, customerCode: l.customer?.code ?? null, currency: l.currency,
      publishedAt: isoOf(l.publishedAt), validFromDate: isoOf(l.validFromDate), validUntilDate: isoOf(l.validUntilDate),
    },
    lines: l.lines.map((r) => ({ lineNo: r.lineNo, itemCode: r.item.code, itemName: r.item.name, colorName: r.color?.name ?? null, unitPrice: Number(r.unitPrice), minQty: num(r.minQty) })),
    notes: l.notes,
  };
  return { status: l.status, content: { documentNo: doc.header.documentNo, doc: doc as unknown as Record<string, unknown> } satisfies BuiltDocContent };
}

registerPrintedDocBuilder(PrintedDocType.PRICE_LIST, {
  // PUBLISHED (ve sonrası ARCHIVED) donar; arşiv belgeyi VOID etmez — "arşivde" bilgisi yalnız ekranda.
  fresh: async (db, listId) => {
    await assertMaliyetOpen();
    const { status, content } = await collectPriceList(db, listId);
    return status === "DRAFT" ? null : content;
  },
  buildPreview: async (db, listId) => {
    await assertMaliyetOpen();
    return (await collectPriceList(db, listId)).content;
  },
  renderHtml: renderPriceListHtml,
  renderTables: renderPriceListTables,
  resolveProfileId: async (db, listId) =>
    (await db.priceList.findUnique({ where: { id: listId }, select: { customer: { select: { documentProfileId: true } } } }))?.customer?.documentProfileId ?? null,
});

/** Teklif iptal/revizyonunda donmuş belgeyi VOIDED'e çeker — durum geçişinin tx'i İÇİNDE (birlikte ya da hiç). */
export function voidQuoteDocumentTx(tx: Prisma.TransactionClient, quoteId: string, reason: string): Promise<number> {
  return printedDocumentService.voidForSource(tx, PrintedDocType.SALES_QUOTE, quoteId, reason);
}
