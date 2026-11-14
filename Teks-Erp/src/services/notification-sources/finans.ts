// =============================================================================
// FİNANS OLAYLARI — S4 (geniş katalog 2026-11-14)
// =============================================================================
// Her OLAY türünün TEK yayma noktası bu dosyadaki fonksiyondur; çağıranlar belgeyi doğuran / durumunu geçiren tx'in
// İÇİNDEN, claim'den SONRA çağırır (rollback → bildirim yok; token replay yolu buraya gelmez). Bayrak kapalıyken no-op.
// Finans modellerine dokunur → yalnız finans kapılı zincirden import edilir (`test_finance_regime_gate`). Yük TUTAR
// taşımaz (belge tutarı, kur, bakiye yok) — yalnız belge no + cari adı + yöntem/tür etiketi.
// =============================================================================
import { InvoiceType, PaymentDirection, PaymentMethod, type Prisma } from "@prisma/client";
import { emitNotification, type EmitDb } from "../helpers/notification-emit.helper";
import { off, who, type Actor } from "./satis";

type Tx = EmitDb & Prisma.TransactionClient;
const subject = (type: string, id: string) => ({ type, id, key: id });
const txt = (s: string | null | undefined, max = 120): string => (s?.trim() ? s.trim().slice(0, max) : "—");

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "nakit", BANK_TRANSFER: "havale/EFT", CREDIT_CARD: "kredi kartı", OTHER: "diğer",
};
const INVOICE_TYPE_LABEL: Record<InvoiceType, string> = {
  SALES: "Satış", PURCHASE: "Alış", SALES_RETURN: "Satış iade", PURCHASE_RETURN: "Alış iade",
};

/** Cari hesabın görünen adı (kart ya da geçiş artığı fason profili). */
export async function cariDisplayName(tx: Tx, cariId: string): Promise<string> {
  const c = await tx.cariAccount.findUnique({
    where: { id: cariId },
    select: { customer: { select: { name: true } }, subcontractor: { select: { name: true } } },
  });
  return c?.customer?.name ?? c?.subcontractor?.name ?? "—";
}

/** `finans.tahsilat` / `finans.odeme` — tahsilat/ödeme belgesinin doğuş tx'i (`payment.service.ts#createFresh`). */
export async function emitPaymentCreatedTx(tx: Tx, paymentId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const p = await tx.payment.findUnique({ where: { id: paymentId }, select: { docNo: true, direction: true, method: true, cariId: true } });
  if (!p) return;
  const payload = { odemeId: paymentId, belgeNo: p.docNo, cariAd: await cariDisplayName(tx, p.cariId), yontem: METHOD_LABEL[p.method] };
  if (p.direction === PaymentDirection.IN) {
    await emitNotification(tx, "finans.tahsilat", subject("payment", paymentId), payload, { actorUserId: who(actor) });
  } else {
    await emitNotification(tx, "finans.odeme", subject("payment", paymentId), payload, { actorUserId: who(actor) });
  }
}

async function invoiceFacts(tx: Tx, invoiceId: string): Promise<{ faturaNo: string; faturaTuru: string; cariAd: string } | null> {
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { docNo: true, type: true, cariId: true } });
  return inv ? { faturaNo: inv.docNo, faturaTuru: INVOICE_TYPE_LABEL[inv.type], cariAd: await cariDisplayName(tx, inv.cariId) } : null;
}

/** `finans.fatura-kesildi` — DRAFT→CONFIRMED claim'i (`invoice.service.ts#confirm`). */
export async function emitInvoiceConfirmedTx(tx: Tx, invoiceId: string, actor: Actor): Promise<void> {
  if (await off(tx)) return;
  const f = await invoiceFacts(tx, invoiceId);
  if (!f) return;
  await emitNotification(tx, "finans.fatura-kesildi", subject("invoice", invoiceId), { faturaId: invoiceId, ...f }, { actorUserId: who(actor) });
}

/** `finans.fatura-iptal` — iptal claim'i (`invoice.service.ts#cancel`); yalnız deftere işlemiş (onaylı) belge. */
export async function emitInvoiceCancelledTx(tx: Tx, invoiceId: string, c: { posted: boolean; reason: string | null | undefined }, actor: Actor): Promise<void> {
  if (!c.posted) return;
  if (await off(tx)) return;
  const f = await invoiceFacts(tx, invoiceId);
  if (!f) return;
  await emitNotification(tx, "finans.fatura-iptal", subject("invoice", invoiceId), { faturaId: invoiceId, ...f, sebep: txt(c.reason) }, { actorUserId: who(actor) });
}
