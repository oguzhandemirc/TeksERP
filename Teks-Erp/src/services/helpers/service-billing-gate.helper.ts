// =============================================================================
// HİZMET FATURASI KAPISI — salt-okuma (H7, karar belgesi §5)
// =============================================================================
// Kurşun düzeltme yolları ve sevk geri alma buradan sorar: "bu iş/sevk faturaya
// bağlı mı?" Yazmaz; ön muhasebe kapalı kurulumda tablo boştur (0 satır). Hafif
// tutulur (yalnız prisma) — üretim helper'larına ağır fiyat zinciri taşınmasın.
// =============================================================================
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";

type Db = Prisma.TransactionClient | typeof prisma;

/** Aktif bağın fatura numarası — 409 mesajı için (yoksa null). */
export async function findActiveBillingTx(
  db: Db,
  where: Prisma.ServiceBillingLinkWhereInput,
): Promise<{ docNo: string } | null> {
  const hit = await db.serviceBillingLink.findFirst({ where: { ...where, revokedAt: null }, select: { invoice: { select: { docNo: true } } } });
  return hit ? { docNo: hit.invoice.docNo } : null;
}

export function alreadyBilled(docNo: string | null): AppError {
  return AppError.conflict(
    docNo ? `Bu iş ${docNo} faturasına bağlı — önce faturayı iptal edin` : "Bu iş başka bir faturaya bağlandı — yenileyip tekrar deneyin",
    { code: "SERVICE_ALREADY_BILLED", ...(docNo ? { docNo } : {}) },
  );
}

/**
 * Düzeltme kapısı (salt-okuma): faturalı iş (top × adım) için okuma/gramaj düzeltmesi ve adım
 * yeniden açma 409 `SERVICE_ALREADY_BILLED` (fatura no ile). Ön muhasebe kapalı kurulumda tablo boştur.
 */
export async function assertWorkNotBilledTx(tx: Db, work: { rollIds: string[]; workOrderStepId: string }): Promise<void> {
  if (work.rollIds.length === 0) return;
  const prior = await findActiveBillingTx(tx, { rollId: { in: work.rollIds }, workOrderStepId: work.workOrderStepId });
  if (prior) throw alreadyBilled(prior.docNo);
}

/** Sevk geri alma kapısı (salt-okuma): bu sevkiyatın faturasına bağlı aktif hizmet bağlarının fatura numaraları. */
export async function listShipmentServiceBilledDocNos(db: Db, shipmentId: string): Promise<string[]> {
  const rows = await db.serviceBillingLink.findMany({
    where: { revokedAt: null, invoice: { shipmentId } },
    select: { invoice: { select: { docNo: true } } },
    distinct: ["invoiceId"],
  });
  return rows.map((r) => r.invoice.docNo);
}


/**
 * Bayrak geri alma kapısı (salt-okuma, H10): faturalı bayrak işinin kanıtı (topun aktif özelliği) geri
 * alınamaz — top ya da ataları o kalemle aktif bağ taşıyorsa 409 `SERVICE_ALREADY_BILLED`.
 */
export async function assertFlagWorkNotBilledTx(tx: Db, input: { rollId: string; propertyIds: string[] }): Promise<void> {
  if (input.propertyIds.length === 0) return;
  const props = await tx.fabricProperty.findMany({ where: { id: { in: input.propertyIds }, serviceItemId: { not: null } }, select: { serviceItemId: true } });
  if (props.length === 0) return;
  const lineage = [input.rollId];
  for (let cur: string | null = input.rollId, d = 0; cur && d < 32; d++) {
    const row: { parentRollId: string | null } | null = await tx.roll.findUnique({ where: { id: cur }, select: { parentRollId: true } });
    cur = row?.parentRollId ?? null;
    if (cur) lineage.push(cur);
  }
  const prior = await findActiveBillingTx(tx, { rollId: { in: lineage }, serviceItemId: { in: props.map((p) => p.serviceItemId!) } });
  if (prior) throw alreadyBilled(prior.docNo);
}
