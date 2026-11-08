// =============================================================================
// LEVENT SARIM BAĞI — fatura tx kapısı + emanet çıkış iptali ters yolu (genel fason F4)
// =============================================================================
// Kilit sırası (fatura tx): 8023 sevk kilitleri → okumalar → LEVENTLER (FOR UPDATE ORDER BY id) → fatura → bağ.
// F5 iptali leventi `SHIPPED_TO_OWNER → READY` claim'iyle aynı satırda kilitler ⇒ iki taraf levent satırında
// serileşir: iptal önce biterse fatura tx'i aktif olay görmez (409), fatura önce biterse iptal bağı görür.
// İptal tarafı bağın faturasını FOR UPDATE okur ⇒ onay (DRAFT→CONFIRMED claim) ile de serileşir.
// =============================================================================
import { InvoiceStatus, Prisma, ServiceBillingSubject } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { activeShipToOwnerWhere } from "./service-winding-work.helper";
import { reconcileServiceLinksWithLines } from "./service-billing.helper";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

/** Bağ damga sebebi — F5 iptali yazar, onay kapısı okur. */
export const CONSIGNMENT_CANCEL_REVOKE_REASON = "CONSIGNMENT_CANCEL";

function beamIdsOf(links: Array<{ warpBeamId?: string | null }>): string[] {
  return [...new Set(links.map((l) => l.warpBeamId).filter((v): v is string => !!v))].sort();
}

/** Kilit sırası ②: bağın dayandığı leventler (okumalardan sonra, fatura insert'inden önce). */
export async function lockWindingBeamsTx(tx: Tx, links: Array<{ warpBeamId?: string | null }>): Promise<void> {
  const ids = beamIdsOf(links);
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT id FROM warp_beams WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
}

/** Kilit ALTINDA: her levent bağının hâlâ aktif sahibine-çıkış olayı var (yoksa önizlemeden beri iptal edildi → 409). */
export async function assertWindingLinksLiveTx(tx: Tx, links: Array<{ warpBeamId?: string | null; serviceItemId: string }>): Promise<void> {
  const ids = beamIdsOf(links);
  if (ids.length === 0) return;
  const live = new Set((await tx.warpBeamEvent.findMany({ where: { beamId: { in: ids }, ...activeShipToOwnerWhere() }, select: { beamId: true } })).map((e) => e.beamId));
  const dead = links.find((l) => l.warpBeamId && !live.has(l.warpBeamId));
  if (dead) {
    throw AppError.conflict("Leventin sahibine çıkış belgesi taslak hazırlanırken iptal edildi — taslağı yeniden oluşturun.", { code: "SERVICE_PREVIEW_STALE", serviceItemId: dead.serviceItemId });
  }
}

export interface WindingBillingLinkRow {
  linkId: string;
  warpBeamId: string;
  invoiceId: string;
  invoiceNo: string | null;
  invoiceStatus: string;
}

/** F5 `cancel-preview.billingLinks`: leventlerin AKTİF sarım bağları (fatura no + durum). */
export async function listWindingLinksForBeams(db: Db, warpBeamIds: string[]): Promise<WindingBillingLinkRow[]> {
  if (warpBeamIds.length === 0) return [];
  const rows = await db.serviceBillingLink.findMany({
    where: { subjectKind: ServiceBillingSubject.WARP_BEAM, warpBeamId: { in: warpBeamIds }, revokedAt: null },
    select: { id: true, warpBeamId: true, invoiceId: true, invoice: { select: { docNo: true, status: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({ linkId: r.id, warpBeamId: r.warpBeamId!, invoiceId: r.invoiceId, invoiceNo: r.invoice.docNo, invoiceStatus: r.invoice.status }));
}

/**
 * F5 iptali (AYNI tx, levent claim'inden SONRA): leventlerin aktif sarım bağları damgalanır (silinmez). Bağın faturası
 * DRAFT değilse 409 `CONSIGNMENT_BEAM_INVOICED` (önce fatura iptal edilir). Dönen: damgalanan bağ sayısı.
 */
export async function revokeWindingLinksForConsignmentTx(tx: Tx, p: { warpBeamIds: string[]; userId: string | null }): Promise<number> {
  const links = await listWindingLinksForBeams(tx, p.warpBeamIds);
  if (links.length === 0) return 0;
  const invoiceIds = [...new Set(links.map((l) => l.invoiceId))].sort();
  const invoices = await tx.$queryRaw<Array<{ id: string; docNo: string; status: string }>>`
    SELECT id, "docNo", status::text AS status FROM invoices WHERE id = ANY(${invoiceIds}::uuid[]) ORDER BY id FOR UPDATE`;
  const locked = invoices.find((i) => i.status !== InvoiceStatus.DRAFT);
  if (locked) {
    throw AppError.conflict(`Leventin sarım işi ${locked.docNo} faturasında (${locked.status === InvoiceStatus.CONFIRMED ? "onaylı" : "iptal dışı"}) — önce faturayı iptal edin.`, { code: "CONSIGNMENT_BEAM_INVOICED", docNo: locked.docNo });
  }
  const res = await tx.serviceBillingLink.updateMany({
    where: { id: { in: links.map((l) => l.linkId) }, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: p.userId, revokeReason: CONSIGNMENT_CANCEL_REVOKE_REASON },
  });
  return res.count;
}

/**
 * Onay kapısı: emanet çıkış iptaliyle bağı düşen hizmet kartının satırı taslakta kaldıysa (Σ satır ≠ Σ aktif bağ,
 * ortak `reconcileServiceLinksWithLines` payıyla) 409 `SERVICE_LINES_MISMATCH` — iptal edilen çıkışın sarımı
 * müşteriye kesilmesin. Yalnız damgalı kartlar ölçülür.
 */
export async function assertNoConsignmentRevokedLinesTx(tx: Tx, invoiceId: string): Promise<void> {
  const revoked = await tx.serviceBillingLink.findMany({ where: { invoiceId, revokeReason: CONSIGNMENT_CANCEL_REVOKE_REASON }, select: { serviceItemId: true }, distinct: ["serviceItemId"] });
  if (revoked.length === 0) return;
  const itemIds = revoked.map((r) => r.serviceItemId);
  const lines = await tx.invoiceLine.findMany({ where: { invoiceId, serviceItemId: { in: itemIds } }, select: { serviceItemId: true, qty: true, description: true } });
  const active = await tx.serviceBillingLink.findMany({ where: { invoiceId, serviceItemId: { in: itemIds }, revokedAt: null }, select: { serviceItemId: true, billedMeters: true, billedQty: true } });
  // Kartın bütün bağları düştüyse satırı hiç kalmamalı (reconcile bağsız kartı ölçmez).
  const orphan = lines.find((l) => !active.some((a) => a.serviceItemId === l.serviceItemId) && new Prisma.Decimal(l.qty).gt(0));
  if (orphan) {
    throw AppError.conflict(
      `"${orphan.description ?? "Sarım"}" satırının işi emanet çıkış iptaliyle faturadan düştü ama satır taslakta duruyor — satırı çıkarın.`,
      { code: "SERVICE_LINES_MISMATCH", serviceItemId: orphan.serviceItemId },
    );
  }
  reconcileServiceLinksWithLines(lines, active);
}
