// =============================================================================
// LEVENT SARIM BAĞI — fatura onay kapısı (genel fason F4)
// =============================================================================
// Ayrı dosya: `service-billing.helper` bağ kapısını `service-winding-link`ten alır; bu kapı ortak
// `reconcileServiceLinksWithLines`i kullandığından aynı dosyada runtime import döngüsü doğardı (`test_import_cycles`).
// =============================================================================
import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { reconcileServiceLinksWithLines } from "./service-billing.helper";
import { CONSIGNMENT_CANCEL_REVOKE_REASON } from "./service-winding-link.helper";

type Tx = Prisma.TransactionClient;

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
