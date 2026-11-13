// =============================================================================
// TEKLİF OLAYLARI — S1 (geniş katalog 2026-11-14)
// =============================================================================
// `satis.ts`ten ayrı: teklif maliyet modülünün modelidir (`salesQuote`); sipariş/iş emri yollarının import
// zincirine girerse rejim kapısı bekçisi (`test_maliyet_regime_gate` §2) o router'ları kapısız sayar.
// Tek yayma noktası bu dosya; çağıranlar teklif tx'inin İÇİNDEN çağırır.
// =============================================================================
import type { Prisma } from "@prisma/client";
import { emitNotification, type EmitDb } from "../helpers/notification-emit.helper";
import { off, who, type Actor } from "./satis";

export type QuoteEvent = "olusturuldu" | "send" | "accept" | "reject";

/** `teklif.*` — teklif doğuşu (`createQuote`) ve geçişleri (`runTransition` claim'i sonrası, aynı tx). */
export async function emitQuoteEventTx(
  tx: EmitDb & Pick<Prisma.TransactionClient, "salesQuote">,
  quoteId: string,
  event: QuoteEvent,
  actor: Actor,
): Promise<void> {
  if (await off(tx)) return;
  const q = await tx.salesQuote.findUnique({
    where: { id: quoteId },
    select: { quoteNo: true, revisionNo: true, rejectReason: true, customer: { select: { name: true } } },
  });
  if (!q) return;
  const base = {
    teklifId: quoteId,
    teklifNo: q.revisionNo > 1 ? `${q.quoteNo}/${q.revisionNo}` : q.quoteNo,
    musteriAd: q.customer?.name ?? "—",
  };
  const subject = { type: "sales_quote", id: quoteId, key: quoteId };
  const opts = { actorUserId: who(actor) };
  if (event === "olusturuldu") await emitNotification(tx, "teklif.olusturuldu", subject, base, opts);
  else if (event === "send") await emitNotification(tx, "teklif.gonderildi", subject, base, opts);
  else if (event === "accept") await emitNotification(tx, "teklif.kabul", subject, base, opts);
  else await emitNotification(tx, "teklif.red", subject, { ...base, sebep: q.rejectReason ?? "—" }, opts);
}
