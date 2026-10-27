// =============================================================================
// SATIŞ TEKLİFİ GEÇİŞLERİ — gönder · kabul · ret · iptal · kabulü geri al · revizyon (MAL-4; plan §3.3, §4.3)
// =============================================================================
// Her geçiş tek tx'te ATOMİK CLAIM (`claimQuoteTx`); `findUnique → if → update` yok. SENT teklif DEĞİŞMEZ:
// düzeltme revizyondur (eski SUPERSEDED + aynı numara revisionNo+1 DRAFT, kalemler snapshot'larıyla KOPYA —
// maliyet yeniden kurulmaz, kullanıcı "tazele" der). `statusChangedAt` DB trigger'ındadır. Audit tx DIŞINDA.
// Dönüştürme (ACCEPTED → CONVERTED) sipariş doğuşuyla aynı tx'tedir: `sales-quote-convert.service.ts`.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { AuditService } from "./audit.service";
import { claimQuoteTx, quoteToday, type QuoteTransition } from "./helpers/sales-quote-state.helper";
import { tokenReplay } from "./helpers/token-replay.helper";
import { freezeQuoteDocumentTx, voidQuoteDocumentTx } from "./quote-documents.service";
import { validate as isUuidString } from "uuid";

export const QUOTE_TABLE = "SALES_QUOTE";
export const QUOTE_INCLUDE = {
  lines: { orderBy: { lineNo: "asc" }, include: { item: { select: { id: true, code: true, name: true } }, color: { select: { id: true, code: true, name: true } } } },
  customer: { select: { id: true, code: true, name: true } },
  branch: { select: { id: true, name: true } },
  convertedOrder: { select: { id: true, orderNumber: true, status: true } },
  // Revizyon zinciri (R0 ← R1 …) panelde bağlantıdır (MAL-5).
  revisionOf: { select: { id: true, revisionNo: true, status: true } },
  revisedTo: { select: { id: true, revisionNo: true, status: true } },
} satisfies Prisma.SalesQuoteInclude;
export type QuoteRecord = Prisma.SalesQuoteGetPayload<{ include: typeof QUOTE_INCLUDE }>;

const MAX_REASON = 300;

function readReason(raw: unknown, required: boolean): string | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) {
    if (required) throw AppError.badRequest("Sebep zorunlu.");
    return null;
  }
  if (v.length > MAX_REASON) throw AppError.badRequest(`Sebep en fazla ${MAX_REASON} karakter olabilir.`);
  return v;
}

export function readQuoteToken(raw: unknown): string {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!isUuidString(t)) throw AppError.badRequest("İstemci anahtarı (clientToken) zorunlu ve UUID olmalı.");
  return t;
}

/** Durum geçişinin ayak izi — yük sır/para taşımaz (tutar iç bilgidir, audit herkesin ekranına düşer). */
export function auditQuoteStatus(id: string, change: { from: string; to: string; userId: string | undefined; extra?: Record<string, unknown> }): void {
  const { from, to, userId, extra = {} } = change;
  void AuditService.log({ userId, action: "UPDATE", tableName: QUOTE_TABLE, recordId: id, oldData: { status: from }, newData: { status: to, ...extra } });
}

/** Ortak koşucu: claim + (isteğe bağlı) aynı tx'te ek iş + kaydı oku; audit tx sonrası. */
async function runTransition(
  id: string,
  transition: QuoteTransition,
  data: Prisma.SalesQuoteUncheckedUpdateManyInput,
  opts: { userId?: string; extra?: Prisma.SalesQuoteWhereInput; after?: (tx: Prisma.TransactionClient) => Promise<void>; audit?: Record<string, unknown> },
): Promise<QuoteRecord> {
  const before = await prisma.salesQuote.findUnique({ where: { id }, select: { status: true } });
  const q = await prisma.$transaction(async (tx) => {
    await claimQuoteTx(tx, id, transition, { data: { ...data, updatedById: opts.userId ?? null }, extra: opts.extra });
    if (opts.after) await opts.after(tx);
    return tx.salesQuote.findUniqueOrThrow({ where: { id }, include: QUOTE_INCLUDE });
  });
  auditQuoteStatus(id, { from: before?.status ?? "?", to: q.status, userId: opts.userId, extra: opts.audit });
  return q;
}

/** DRAFT → SENT. Kalemsiz teklif 400 (claim ile aynı tx: arada kalem silinemez, DRAFT kilidi düştü). */
export function sendQuote(id: string, userId?: string): Promise<QuoteRecord> {
  return runTransition(id, "send", { sentAt: new Date(), sentById: userId ?? null }, {
    userId,
    after: async (tx) => {
      const n = await tx.salesQuoteLine.count({ where: { quoteId: id } });
      if (n === 0) throw AppError.badRequest("Kalemsiz teklif gönderilemez; önce kalem ekleyin.", { code: "QUOTE_EMPTY" });
      // Belge gönderim ANINDA donar (lazy "geriye dönük" değil); hata geçişi geri sarar (emsal: freezeForSource çağıranları).
      await freezeQuoteDocumentTx(tx, id, userId);
    },
  });
}

/** SENT → ACCEPTED; süresi dolmuşsa claim düşer ve 409 QUOTE_EXPIRED (çare: revizyon). */
export function acceptQuote(id: string, body: { customerReference?: unknown }, userId?: string): Promise<QuoteRecord> {
  const ref = typeof body.customerReference === "string" && body.customerReference.trim() ? body.customerReference.trim() : undefined;
  if (ref && ref.length > 100) throw AppError.badRequest("Müşteri referansı en fazla 100 karakter olabilir.");
  return runTransition(
    id,
    "accept",
    { acceptedAt: new Date(), acceptedById: userId ?? null, ...(ref ? { customerReference: ref } : {}) },
    { userId, extra: { validUntilDate: { gte: quoteToday() } } },
  );
}

export function rejectQuote(id: string, body: { reason?: unknown }, userId?: string): Promise<QuoteRecord> {
  const reason = readReason(body.reason, true);
  return runTransition(id, "reject", { rejectedAt: new Date(), rejectedById: userId ?? null, rejectReason: reason }, { userId, audit: { rejectReason: reason } });
}

export function cancelQuote(id: string, body: { reason?: unknown }, userId?: string): Promise<QuoteRecord> {
  const reason = readReason(body.reason, false);
  return runTransition(id, "cancel", { cancelledAt: new Date(), cancelledById: userId ?? null, cancelReason: reason }, {
    userId,
    audit: { cancelReason: reason },
    // Gönderilmiş teklifin donmuş belgesi aynı tx'te İPTAL filigranına geçer (MAL-6).
    after: async (tx) => { await voidQuoteDocumentTx(tx, id, reason ?? "Teklif iptal edildi"); },
  });
}

/** ACCEPTED → SENT (dönüşmemişse): kabul damgası düşer; "ne oldu" audit'te kalır. */
export function unacceptQuote(id: string, userId?: string): Promise<QuoteRecord> {
  return runTransition(id, "unaccept", { acceptedAt: null, acceptedById: null }, { userId, extra: { convertedOrderId: null } });
}

/** Revizyon replay'i: aynı token → aynı yeni revizyon; başka teklifin revizyonu için kullanılmış token → 409. */
function reviseReplay(id: string) {
  return tokenReplay<QuoteRecord, QuoteRecord>({
    find: (db, clientToken) => db.salesQuote.findUnique({ where: { clientToken }, include: QUOTE_INCLUDE }),
    alive: { neverDies: "Revizyon taslağının iptali yeni deneme açmaz: aynı form aynı revizyonu gösterir (iptal edilmişse durumu görünür)." },
    identity: (p) => [{ ad: "revisionOfId", mevcut: p.revisionOfId, gelen: id }],
    collision: (p) => `Bu form daha önce başka bir teklif için kullanılmış (${p.quoteNo}/${p.revisionNo}). Formu yeniden açın.`,
    respond: (p) => p,
  });
}

const DAY_MS = 86_400_000;

/** SENT|REJECTED → eski SUPERSEDED + yeni DRAFT (aynı numara, revisionNo+1, geçerlilik süresi korunur). */
export async function reviseQuote(id: string, body: { clientToken?: unknown }, userId?: string): Promise<QuoteRecord> {
  const clientToken = readQuoteToken(body.clientToken);
  return reviseReplay(id).run(clientToken, async () => {
    const before = await prisma.salesQuote.findUnique({ where: { id }, select: { status: true } });
    const created = await prisma.$transaction(async (tx) => {
      await claimQuoteTx(tx, id, "revise", { data: { supersededAt: new Date(), updatedById: userId ?? null } });
      const old = await tx.salesQuote.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
      // Eski revizyonun belgesi geçersizleşir; snapshot'ı DEĞİŞMEZ (yeni revizyon yeni kaynaktır).
      await voidQuoteDocumentTx(tx, id, `Revizyon: R${old.revisionNo + 1} ile değiştirildi`);
      const today = quoteToday();
      const validDays = Math.max(0, Math.round((old.validUntilDate.getTime() - old.quoteDate.getTime()) / DAY_MS));
      return tx.salesQuote.create({
        data: {
          quoteNo: old.quoteNo,
          revisionNo: old.revisionNo + 1,
          clientToken,
          revisionOfId: old.id,
          customerId: old.customerId,
          branchId: old.branchId,
          quoteDate: today,
          validUntilDate: new Date(today.getTime() + validDays * DAY_MS),
          currency: old.currency,
          fxRate: old.fxRate,
          fxRateSource: old.fxRateSource,
          fxRateDate: old.fxRateDate,
          paymentTermDays: old.paymentTermDays,
          financeChargePct: old.financeChargePct,
          commissionPct: old.commissionPct,
          freightPerM: old.freightPerM,
          customerReference: old.customerReference,
          notes: old.notes,
          internalNote: old.internalNote,
          totalAmount: old.totalAmount,
          totalCostTry: old.totalCostTry,
          createdById: userId ?? null,
          updatedById: userId ?? null,
          lines: {
            create: old.lines.map((l) => ({
              lineNo: l.lineNo, itemId: l.itemId, colorId: l.colorId, description: l.description, width: l.width, quantity: l.quantity,
              unit: l.unit, standardCostVersionId: l.standardCostVersionId, costPerMTry: l.costPerMTry,
              costSnapshot: l.costSnapshot as Prisma.InputJsonValue, markupPct: l.markupPct, suggestedUnitPrice: l.suggestedUnitPrice,
              unitPrice: l.unitPrice, priceSource: l.priceSource, priceListLineId: l.priceListLineId, lineTotal: l.lineTotal, notes: l.notes,
            })),
          },
        },
        include: QUOTE_INCLUDE,
      });
    });
    auditQuoteStatus(id, { from: before?.status ?? "?", to: "SUPERSEDED", userId, extra: { revisedToId: created.id } });
    void AuditService.log({
      userId, action: "CREATE", tableName: QUOTE_TABLE, recordId: created.id, oldData: null,
      newData: { quoteNo: created.quoteNo, revisionNo: created.revisionNo, revisionOfId: id, status: created.status, lineCount: created.lines.length },
    });
    return created;
  });
}
